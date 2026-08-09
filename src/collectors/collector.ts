import type { z } from "zod";
import { Agent, fetch as undiciFetch } from "undici";
import type { PanelData, PanelKey } from "../contracts/dashboard.js";

export type CollectorContext = {
  signal: AbortSignal;
  now: Date;
};

export type Collector<K extends PanelKey = PanelKey> = {
  name: string;
  panel: K;
  source: string;
  intervalMs: number;
  timeoutMs: number;
  staleAfterMs: number;
  required: boolean;
  enabled: boolean;
  schema: z.ZodType<PanelData<K>>;
  collect: (context: CollectorContext) => Promise<PanelData<K>>;
};

export type HttpError = Error & { statusCode?: number };
const insecureInternalAgent = new Agent({ connect: { rejectUnauthorized: false } });

export type JsonRequest = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
  allowInsecureTls?: boolean,
) => Promise<unknown>;

export async function fetchJson(
  url: string,
  init: RequestInit & { signal: AbortSignal },
  allowInsecureTls = false,
): Promise<unknown> {
  const request = allowInsecureTls
    ? ({ ...init, dispatcher: insecureInternalAgent } as RequestInit)
    : init;
  const response = await undiciFetch(url, request as Parameters<typeof undiciFetch>[1]);
  if (!response.ok) {
    const error: HttpError = new Error(`Upstream request failed with HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}

export function boundedText(value: unknown, max = 160): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function finiteNumber(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? number : fallback;
}

export function integer(value: unknown, fallback = 0): number {
  return Math.max(0, Math.trunc(finiteNumber(value, fallback)));
}
