import { Agent, fetch as undiciFetch } from "undici";
import { boundedText, finiteNumber } from "./collector.js";
import type { PanelData } from "../contracts/dashboard.js";

export type QbittorrentInstance = {
  name: string;
  library: string;
  baseUrl: string;
  username: string;
  password: string;
  allowInsecureTls?: boolean;
};

type UnknownRecord = Record<string, unknown>;
export type QbittorrentRequest = (instance: QbittorrentInstance, signal: AbortSignal) => Promise<unknown>;

export function isSuccessfulQbittorrentLogin(status: number, body: string, cookie: string | undefined): boolean {
  return Boolean(cookie) && ((status === 200 && body.trim() === "Ok.") || status === 204);
}

export function qBittorrentSessionCookie(setCookie: string | null): string | undefined {
  const cookie = setCookie?.split(";", 1)[0]?.trim();
  return cookie?.includes("=") ? cookie : undefined;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function isDownload(item: UnknownRecord): boolean {
  const state = String(item.state ?? "");
  return finiteNumber(item.amount_left) > 0
    || finiteNumber(item.progress) < 1
    || /DL$|downloading|metaDL|queuedDL|stalledDL|pausedDL|stoppedDL|checkingDL/i.test(state);
}

function safeEta(value: unknown): number {
  const eta = Math.max(0, Math.trunc(finiteNumber(value)));
  return eta >= 8_640_000 ? 0 : eta;
}

export function normalizeQbittorrentQueue(input: unknown, instance: QbittorrentInstance): PanelData<"sabQueues">["instances"][number] {
  const torrents = Array.isArray(input) ? input.map(record).filter(isDownload).slice(0, 12) : [];
  const pausedStates = new Set(["pausedDL", "stoppedDL"]);
  return {
    name: instance.name,
    client: "qbittorrent",
    library: instance.library,
    paused: torrents.length > 0 && torrents.every((item) => pausedStates.has(String(item.state ?? ""))),
    speedBytesPerSecond: torrents.reduce((sum, item) => sum + Math.max(0, finiteNumber(item.dlspeed)), 0),
    timeLeftSeconds: Math.max(0, ...torrents.map((item) => safeEta(item.eta))),
    items: torrents.map((item) => ({
      name: boundedText(item.name ?? "Unnamed torrent", 160),
      remainingBytes: Math.max(0, finiteNumber(item.amount_left)),
      progressPercent: Math.min(100, Math.max(0, finiteNumber(item.progress) * 100)),
      status: boundedText(item.state ?? "unknown", 60),
    })),
  };
}

export function createQbittorrentRequest(): QbittorrentRequest {
  const sessions = new Map<string, string>();
  const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

  async function login(instance: QbittorrentInstance, signal: AbortSignal): Promise<string> {
    const loginUrl = new URL("/api/v2/auth/login", instance.baseUrl);
    const response = await undiciFetch(loginUrl, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: `${loginUrl.origin}/`,
      },
      body: new URLSearchParams({ username: instance.username, password: instance.password }).toString(),
      ...(instance.allowInsecureTls ? { dispatcher: insecureAgent } : {}),
    });
    const result = await response.text();
    const cookie = qBittorrentSessionCookie(response.headers.get("set-cookie"));
    if (!cookie || !isSuccessfulQbittorrentLogin(response.status, result, cookie)) throw new Error(`qBittorrent authentication failed with HTTP ${response.status}`);
    sessions.set(instance.baseUrl, cookie);
    return cookie;
  }

  async function torrents(instance: QbittorrentInstance, signal: AbortSignal, cookie: string) {
    const url = new URL("/api/v2/torrents/info", instance.baseUrl);
    url.searchParams.set("filter", "all");
    url.searchParams.set("sort", "priority");
    const response = await undiciFetch(url, {
      signal,
      headers: { accept: "application/json", cookie, referer: `${url.origin}/` },
      ...(instance.allowInsecureTls ? { dispatcher: insecureAgent } : {}),
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error(`qBittorrent request failed with HTTP ${response.status}`);
    return response.json();
  }

  return async (instance, signal) => {
    let cookie = sessions.get(instance.baseUrl) ?? await login(instance, signal);
    let result = await torrents(instance, signal, cookie);
    if (result === null) {
      sessions.delete(instance.baseUrl);
      cookie = await login(instance, signal);
      result = await torrents(instance, signal, cookie);
    }
    if (result === null) throw new Error("qBittorrent session was rejected after authentication");
    return result;
  };
}
