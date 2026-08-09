import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createUniFiReadClient,
  type UniFiFetch,
} from "../../src/collectors/unifi-client.js";

type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
};

function response(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  };
}

function requestHeaders(init: Parameters<UniFiFetch>[1]): Record<string, string> {
  return Object.fromEntries(new Headers(init.headers).entries());
}

test("concurrent UniFi reads share one login, cookie, and CSRF token", async () => {
  const requests: RecordedRequest[] = [];
  let releaseLogin!: () => void;
  const loginReleased = new Promise<void>((resolve) => {
    releaseLogin = resolve;
  });
  const fetch: UniFiFetch = async (url, init) => {
    requests.push({
      url,
      method: init.method ?? "GET",
      headers: requestHeaders(init),
      body: typeof init.body === "string" ? init.body : "",
    });
    if (url.endsWith("/api/auth/login")) {
      await loginReleased;
      return response(200, {}, {
        "set-cookie": "TOKEN=session-one; Path=/; HttpOnly",
        "x-csrf-token": "csrf-one",
      });
    }
    return response(200, { data: [] });
  };
  const read = createUniFiReadClient({
    baseUrl: "https://unifi.test/",
    username: "dashboard-user",
    password: "dashboard-password",
  }, { fetch });

  const health = read("/stat/health", new AbortController().signal);
  const pdu = read("/stat/device/aa%3Abb", new AbortController().signal);
  await Promise.resolve();
  assert.equal(requests.filter(({ url }) => url.endsWith("/api/auth/login")).length, 1);

  releaseLogin();
  await Promise.all([health, pdu]);

  const reads = requests.filter(({ method }) => method === "GET");
  assert.equal(reads.length, 2);
  for (const request of reads) {
    assert.equal(request.headers.cookie, "TOKEN=session-one");
    assert.equal(request.headers["x-csrf-token"], "csrf-one");
  }
});

test("a 401 performs one shared reauthentication and one read retry", async () => {
  let loginCount = 0;
  let readCount = 0;
  const fetch: UniFiFetch = async (url) => {
    if (url.endsWith("/api/auth/login")) {
      loginCount += 1;
      return response(200, {}, { "set-cookie": `TOKEN=session-${loginCount}` });
    }
    readCount += 1;
    return response(readCount === 1 ? 401 : 200, { data: [] });
  };
  const read = createUniFiReadClient({
    baseUrl: "https://unifi.test",
    username: "user",
    password: "password",
  }, { fetch });

  await read("/stat/health", new AbortController().signal);
  assert.equal(loginCount, 2);
  assert.equal(readCount, 2);
});

test("a persistent 401 backs off before replacing the final rejected session", async () => {
  let timestamp = 1_000_000;
  let loginCount = 0;
  let readCount = 0;
  const fetch: UniFiFetch = async (url) => {
    if (url.endsWith("/api/auth/login")) {
      loginCount += 1;
      return response(200, {}, { "set-cookie": `TOKEN=session-${loginCount}` });
    }
    readCount += 1;
    return response(readCount <= 2 ? 401 : 200, { data: [] });
  };
  const read = createUniFiReadClient({
    baseUrl: "https://unifi.test",
    username: "user",
    password: "password",
  }, { fetch, now: () => timestamp });

  await assert.rejects(
    read("/stat/health", new AbortController().signal),
    /UniFi authentication failed with HTTP 401; retry in 30 seconds/,
  );
  assert.equal(readCount, 2);
  assert.equal(loginCount, 2);

  timestamp += 30_000 - 1;
  await assert.rejects(read("/stat/health", new AbortController().signal), /retry in 1 seconds/);
  assert.equal(readCount, 2);
  assert.equal(loginCount, 2);

  timestamp += 1;
  await read("/stat/health", new AbortController().signal);
  assert.equal(readCount, 3);
  assert.equal(loginCount, 3);
});

test("a persistent 401 honors a capped later Retry-After before another login", async () => {
  let timestamp = 1_000_000;
  let loginCount = 0;
  let readCount = 0;
  const fetch: UniFiFetch = async (url) => {
    if (url.endsWith("/api/auth/login")) {
      loginCount += 1;
      return response(200, {}, { "set-cookie": `TOKEN=session-${loginCount}` });
    }
    readCount += 1;
    return response(401, {}, { "retry-after": "7200" });
  };
  const read = createUniFiReadClient({
    baseUrl: "https://unifi.test",
    username: "user",
    password: "password",
  }, { fetch, now: () => timestamp });

  await assert.rejects(
    read("/stat/health", new AbortController().signal),
    /UniFi authentication failed with HTTP 401; retry in 3600 seconds/,
  );
  assert.equal(readCount, 2);
  assert.equal(loginCount, 2);

  timestamp += 3_600_000 - 1;
  await assert.rejects(read("/stat/health", new AbortController().signal), /retry in 1 seconds/);
  assert.equal(readCount, 2);
  assert.equal(loginCount, 2);
});

test("one aborted caller does not abort a shared login awaited by another caller", async () => {
  let loginCount = 0;
  let releaseLogin!: () => void;
  let signalLoginStarted!: () => void;
  const loginStarted = new Promise<void>((resolve) => {
    signalLoginStarted = resolve;
  });
  const fetch: UniFiFetch = async (url, init) => {
    if (url.endsWith("/api/auth/login")) {
      loginCount += 1;
      signalLoginStarted();
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new Error("transport aborted"));
        init.signal.addEventListener("abort", abort, { once: true });
        releaseLogin = () => {
          init.signal.removeEventListener("abort", abort);
          resolve();
        };
      });
      return response(200, {}, { "set-cookie": "TOKEN=session-one" });
    }
    return response(200, { data: [] });
  };
  const read = createUniFiReadClient({
    baseUrl: "https://unifi.test",
    username: "user",
    password: "password",
  }, { fetch });
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = read("/stat/health", firstController.signal);
  const second = read("/stat/health", secondController.signal);
  const secondOutcome = second.then(() => "resolved", () => "rejected");

  await loginStarted;
  firstController.abort();
  await assert.rejects(first, /UniFi authentication request cancelled/);
  assert.equal(loginCount, 1);

  releaseLogin();
  assert.equal(await secondOutcome, "resolved");
  assert.equal(loginCount, 1);
});

test("a new caller waits for an abandoned login to settle before replacing it", async () => {
  let loginCount = 0;
  let releaseFirstTransport!: () => void;
  let signalAbortObserved!: () => void;
  const abortObserved = new Promise<void>((resolve) => {
    signalAbortObserved = resolve;
  });
  const fetch: UniFiFetch = async (url, init) => {
    if (!url.endsWith("/api/auth/login")) return response(200, { data: [] });
    loginCount += 1;
    if (loginCount === 1) {
      await new Promise<void>((resolve) => {
        init.signal.addEventListener("abort", signalAbortObserved, { once: true });
        releaseFirstTransport = resolve;
      });
    }
    return response(200, {}, { "set-cookie": `TOKEN=session-${loginCount}` });
  };
  const read = createUniFiReadClient({
    baseUrl: "https://unifi.test",
    username: "user",
    password: "password",
  }, { fetch });
  const firstController = new AbortController();
  const first = read("/stat/health", firstController.signal);

  firstController.abort();
  await assert.rejects(first, /UniFi authentication request cancelled/);
  await abortObserved;

  const second = read("/stat/health", new AbortController().signal);
  assert.equal(loginCount, 1);
  releaseFirstTransport();
  await second;
  assert.equal(loginCount, 2);
});

test("a stale 401 does not erase or penalize a newer shared session", async () => {
  let loginCount = 0;
  let releaseFirstRead!: () => void;
  const firstReadReleased = new Promise<void>((resolve) => {
    releaseFirstRead = resolve;
  });
  let signalFirstRead!: () => void;
  const firstReadStarted = new Promise<void>((resolve) => {
    signalFirstRead = resolve;
  });
  let readCount = 0;
  const fetch: UniFiFetch = async (url) => {
    if (url.endsWith("/api/auth/login")) {
      loginCount += 1;
      return response(200, {}, { "set-cookie": `TOKEN=session-${loginCount}` });
    }
    readCount += 1;
    if (readCount === 1) {
      signalFirstRead();
      await firstReadReleased;
      return response(401);
    }
    if (readCount === 2) return response(401);
    return response(200, { data: [] });
  };
  const read = createUniFiReadClient({
    baseUrl: "https://unifi.test",
    username: "user",
    password: "password",
  }, { fetch });

  const stale = read("/stat/health", new AbortController().signal);
  await firstReadStarted;
  await read("/stat/health", new AbortController().signal);
  releaseFirstRead();
  await stale;

  await read("/stat/health", new AbortController().signal);

  assert.equal(loginCount, 2);
  assert.equal(readCount, 5);
});

test("login failures use 30, 60, 120, 240, and 300 second backoff", async () => {
  let timestamp = 1_000_000;
  let loginCount = 0;
  const fetch: UniFiFetch = async () => {
    loginCount += 1;
    return response(429);
  };
  const read = createUniFiReadClient({
    baseUrl: "https://unifi.test",
    username: "user",
    password: "password",
  }, { fetch, now: () => timestamp });
  const signal = new AbortController().signal;

  for (const seconds of [30, 60, 120, 240, 300, 300]) {
    await assert.rejects(read("/stat/health", signal), new RegExp(`retry in ${seconds} seconds`));
    const callsAfterFailure = loginCount;
    timestamp += seconds * 1_000 - 1;
    await assert.rejects(read("/stat/health", signal), /retry in 1 seconds/);
    assert.equal(loginCount, callsAfterFailure);
    timestamp += 1;
  }
});

test("a later Retry-After is honored and capped at one hour", async () => {
  for (const [retryAfter, expectedSeconds] of [
    ["90", 90],
    ["7200", 3600],
    [new Date(1_000_000 + 45_000).toUTCString(), 45],
  ] as const) {
    let timestamp = 1_000_000;
    let calls = 0;
    const read = createUniFiReadClient({
      baseUrl: "https://unifi.test",
      username: "user",
      password: "password",
    }, {
      now: () => timestamp,
      fetch: async () => {
        calls += 1;
        return response(429, {}, { "retry-after": retryAfter });
      },
    });
    await assert.rejects(
      read("/stat/health", new AbortController().signal),
      new RegExp(`retry in ${expectedSeconds} seconds`),
    );
    timestamp += expectedSeconds * 1_000 - 1;
    await assert.rejects(read("/stat/health", new AbortController().signal));
    assert.equal(calls, 1);
  }
});

test("non-digit Retry-After values fall back to exponential backoff", async () => {
  for (const retryAfter of ["1e2", "1.5", "-1", "invalid"]) {
    const read = createUniFiReadClient({
      baseUrl: "https://unifi.test",
      username: "user",
      password: "password",
    }, {
      fetch: async () => response(429, {}, { "retry-after": retryAfter }),
    });

    await assert.rejects(
      read("/stat/health", new AbortController().signal),
      /retry in 30 seconds/,
    );
  }
});

test("an ISO Retry-After date falls back to exponential backoff", async () => {
  const timestamp = 1_000_000;
  const read = createUniFiReadClient({
    baseUrl: "https://unifi.test",
    username: "user",
    password: "password",
  }, {
    now: () => timestamp,
    fetch: async () => response(429, {}, {
      "retry-after": new Date(timestamp + 90_000).toISOString(),
    }),
  });

  await assert.rejects(
    read("/stat/health", new AbortController().signal),
    /retry in 30 seconds/,
  );
});

test("invalid IMF-fixdate Retry-After values fall back to exponential backoff", async () => {
  for (const retryAfter of [
    "Mon, 31 Feb 2099 00:00:00 GMT",
    "Mon, 01 Jan 1970 00:00:00 GMT",
  ]) {
    const read = createUniFiReadClient({
      baseUrl: "https://unifi.test",
      username: "user",
      password: "password",
    }, {
      now: () => 1_000_000,
      fetch: async () => response(429, {}, { "retry-after": retryAfter }),
    });

    await assert.rejects(
      read("/stat/health", new AbortController().signal),
      /retry in 30 seconds/,
    );
  }
});

test("successful authentication resets the failure backoff", async () => {
  let timestamp = 1_000_000;
  let loginAttempt = 0;
  let readAttempt = 0;
  const read = createUniFiReadClient({
    baseUrl: "https://unifi.test",
    username: "user",
    password: "password",
  }, {
    now: () => timestamp,
    fetch: async (url) => {
      if (url.endsWith("/api/auth/login")) {
        loginAttempt += 1;
        if (loginAttempt === 1 || loginAttempt === 3) return response(429);
        return response(200, {}, { "set-cookie": `TOKEN=session-${loginAttempt}` });
      }
      readAttempt += 1;
      return response(readAttempt === 2 ? 401 : 200, { data: [] });
    },
  });
  const signal = new AbortController().signal;

  await assert.rejects(read("/stat/health", signal), /retry in 30 seconds/);
  timestamp += 30_000;
  await read("/stat/health", signal);
  await assert.rejects(read("/stat/health", signal), /retry in 30 seconds/);
});

test("persistent UniFi 401 errors exclude credentials, session material, and response bodies", async () => {
  const forbidden = [
    "dashboard-user",
    "dashboard-password",
    "session-secret",
    "csrf-secret",
    "controller-body",
  ];
  const read = createUniFiReadClient({
    baseUrl: "https://unifi.test",
    username: forbidden[0]!,
    password: forbidden[1]!,
  }, {
    fetch: async (url) => {
      if (url.endsWith("/api/auth/login")) {
        return response(200, {}, {
          "set-cookie": `TOKEN=${forbidden[2]}`,
          "x-csrf-token": forbidden[3]!,
        });
      }
      return response(401, { detail: forbidden[4] }, {
        "set-cookie": `TOKEN=${forbidden[2]}`,
        "x-csrf-token": forbidden[3]!,
      });
    },
  });

  const error = await read("/stat/health", new AbortController().signal)
    .then(() => "", (caught: unknown) => String(caught));
  for (const value of forbidden) assert.doesNotMatch(error, new RegExp(value));
  assert.match(error, /HTTP 401/);
});
