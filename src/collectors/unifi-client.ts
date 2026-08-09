import { Agent, fetch as undiciFetch } from "undici";

export type UniFiOptions = {
  baseUrl: string;
  username: string;
  password: string;
  site?: string;
  tlsVerify?: boolean;
};

type UniFiResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};

type UniFiRequestInit = NonNullable<Parameters<typeof undiciFetch>[1]>;
export type UniFiFetch = (
  url: string,
  init: UniFiRequestInit,
) => Promise<UniFiResponse>;

export type UniFiRead = (path: string, signal: AbortSignal) => Promise<unknown>;

export type UniFiClientDependencies = {
  fetch?: UniFiFetch;
  now?: () => number;
};

type LoginAttempt = {
  controller: AbortController;
  promise: Promise<void>;
  waiters: number;
  cancelled: boolean;
  finished: boolean;
};

class LoginCancelledError extends Error {}

const BACKOFF_MS = [30_000, 60_000, 120_000, 240_000, 300_000] as const;
const MAX_RETRY_AFTER_MS = 60 * 60 * 1_000;
const IMF_FIXDATE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

function retryAfterMilliseconds(value: string | null, now: number): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Math.min(MAX_RETRY_AFTER_MS, seconds * 1_000);
  }
  if (!IMF_FIXDATE.test(trimmed)) return 0;
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return 0;
  if (new Date(timestamp).toUTCString() !== trimmed) return 0;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, timestamp - now));
}

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000));
}

export function createUniFiReadClient(
  options: UniFiOptions,
  dependencies: UniFiClientDependencies = {},
): UniFiRead {
  const dispatcher = new Agent({ connect: { rejectUnauthorized: options.tlsVerify !== false } });
  const fetch: UniFiFetch = dependencies.fetch
    ?? ((url, init) => undiciFetch(url, init));
  const now = dependencies.now ?? Date.now;
  const base = options.baseUrl.replace(/\/$/, "");
  const site = encodeURIComponent(options.site ?? "default");
  let cookie = "";
  let csrf = "";
  let loginAttempt: LoginAttempt | null = null;
  let failureCount = 0;
  let nextLoginAt = 0;
  let lastFailureStatus: number | null = null;
  let sessionGeneration = 0;

  const recordLoginFailure = (response?: UniFiResponse): number => {
    failureCount += 1;
    lastFailureStatus = response?.status ?? null;
    const backoff = BACKOFF_MS[Math.min(failureCount - 1, BACKOFF_MS.length - 1)]!;
    const timestamp = now();
    const retryAfter = retryAfterMilliseconds(
      response?.headers.get("retry-after") ?? null,
      timestamp,
    );
    const delay = Math.max(backoff, retryAfter);
    nextLoginAt = timestamp + delay;
    return delay;
  };

  const loginError = (delay: number): Error => new Error(
    `UniFi authentication failed${
      lastFailureStatus === null ? "" : ` with HTTP ${lastFailureStatus}`
    }; retry in ${retrySeconds(delay)} seconds`,
  );

  const performLogin = async (
    signal: AbortSignal,
    wasCancelled: () => boolean,
  ): Promise<void> => {
    let response: UniFiResponse;
    try {
      response = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          username: options.username,
          password: options.password,
          remember: false,
        }),
        signal,
        dispatcher,
      });
    } catch {
      if (wasCancelled()) throw new LoginCancelledError();
      throw loginError(recordLoginFailure());
    }
    if (wasCancelled()) throw new LoginCancelledError();
    if (!response.ok) throw loginError(recordLoginFailure(response));
    const nextCookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    if (!nextCookie) throw loginError(recordLoginFailure(response));
    cookie = nextCookie;
    csrf = response.headers.get("x-csrf-token") ?? "";
    sessionGeneration += 1;
    failureCount = 0;
    nextLoginAt = 0;
    lastFailureStatus = null;
  };

  const abandonLogin = (attempt: LoginAttempt): void => {
    if (attempt.cancelled || attempt.finished || attempt.waiters > 0) return;
    attempt.cancelled = true;
    attempt.controller.abort();
  };

  const waitForLogin = (attempt: LoginAttempt, signal: AbortSignal): Promise<void> => new Promise(
    (resolve, reject) => {
      let joined = false;
      let settled = false;
      const cleanup = (): boolean => {
        if (settled) return false;
        settled = true;
        if (!joined) return true;
        joined = false;
        signal.removeEventListener("abort", onAbort);
        attempt.waiters -= 1;
        abandonLogin(attempt);
        return true;
      };
      const onAbort = () => {
        if (!cleanup()) return;
        reject(new Error("UniFi authentication request cancelled"));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      joined = true;
      attempt.waiters += 1;
      signal.addEventListener("abort", onAbort, { once: true });
      void attempt.promise.then(
        () => {
          if (cleanup()) resolve();
        },
        (error: unknown) => {
          if (!cleanup()) return;
          if (error instanceof LoginCancelledError) {
            reject(error);
            return;
          }
          reject(error);
        },
      );
    },
  );

  const startLogin = (): LoginAttempt => {
    const controller = new AbortController();
    const attempt: LoginAttempt = {
      controller,
      promise: Promise.resolve(),
      waiters: 0,
      cancelled: false,
      finished: false,
    };
    attempt.promise = performLogin(controller.signal, () => attempt.cancelled);
    loginAttempt = attempt;
    void attempt.promise.then(
      () => {
        attempt.finished = true;
        if (loginAttempt === attempt) loginAttempt = null;
      },
      () => {
        attempt.finished = true;
        if (loginAttempt === attempt) loginAttempt = null;
      },
    );
    return attempt;
  };

  const ensureLogin = async (signal: AbortSignal): Promise<void> => {
    while (!cookie) {
      if (signal.aborted) throw new Error("UniFi authentication request cancelled");
      let attempt = loginAttempt;
      if (!attempt) {
        const remaining = nextLoginAt - now();
        if (remaining > 0) throw loginError(remaining);
        attempt = startLogin();
      }
      try {
        await waitForLogin(attempt, signal);
      } catch (error) {
        if (error instanceof LoginCancelledError) continue;
        throw error;
      }
    }
  };

  const read = async (
    path: string,
    signal: AbortSignal,
    allowRetry: boolean,
  ): Promise<unknown> => {
    await ensureLogin(signal);
    const requestCookie = cookie;
    const requestCsrf = csrf;
    const requestGeneration = sessionGeneration;
    let response: UniFiResponse;
    try {
      response = await fetch(
        `${base}/proxy/network/api/s/${site}${path}`,
        {
          signal,
          headers: {
            cookie: requestCookie,
            ...(requestCsrf ? { "x-csrf-token": requestCsrf } : {}),
            accept: "application/json",
          },
          dispatcher,
        },
      );
    } catch {
      throw new Error("UniFi read request failed");
    }
    if (response.status === 401) {
      if (sessionGeneration === requestGeneration) {
        cookie = "";
        csrf = "";
        if (!allowRetry) throw loginError(recordLoginFailure(response));
      }
      if (!allowRetry) throw new Error("UniFi read request failed with HTTP 401");
      await ensureLogin(signal);
      return read(path, signal, false);
    }
    if (!response.ok) {
      throw new Error(`UniFi read request failed with HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error("UniFi read response was not valid JSON");
    }
  };

  return (path, signal) => read(path, signal, true);
}
