import { sabQueuesDataSchema, type PanelData } from "../contracts/dashboard.js";
import { boundedText, fetchJson, finiteNumber, type Collector, type JsonRequest } from "./collector.js";

export type SabInstance = { name: string; library: string; baseUrl: string; apiKey: string; allowInsecureTls?: boolean };
type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function parseDuration(value: unknown): number {
  const pieces = String(value ?? "0").split(":").map(Number);
  if (pieces.some((part) => !Number.isFinite(part))) return 0;
  return pieces.reduce((total, part) => total * 60 + part, 0);
}

function parseSpeed(value: unknown): number {
  const text = String(value ?? "0").trim();
  const number = finiteNumber(text.replaceAll(",", ""));
  if (/GB/i.test(text)) return number * 1_000_000_000;
  if (/MB/i.test(text)) return number * 1_000_000;
  if (/KB/i.test(text)) return number * 1_000;
  return number;
}

export function normalizeSabQueue(input: unknown, instance: SabInstance): PanelData<"sabQueues">["instances"][number] {
  const queue = record(record(input).queue);
  const slots = Array.isArray(queue.slots) ? queue.slots : [];
  return {
    name: instance.name,
    client: "sabnzbd",
    library: instance.library,
    paused: String(queue.status ?? "").toLowerCase() === "paused" || Boolean(queue.paused),
    speedBytesPerSecond: parseSpeed(queue.speed),
    timeLeftSeconds: parseDuration(queue.timeleft),
    items: slots.slice(0, 12).map((value) => {
      const item = record(value);
      return {
        name: boundedText(item.filename ?? item.name ?? "Unnamed item", 160),
        remainingBytes: Math.max(0, finiteNumber(item.mbleft) * 1_000_000),
        progressPercent: Math.min(100, Math.max(0, finiteNumber(item.percentage))),
        status: boundedText(item.status ?? "unknown", 60),
      };
    }),
  };
}

export function createSabnzbdCollector(instances: SabInstance[], request: JsonRequest = fetchJson): Collector<"sabQueues"> {
  return {
    name: "SABnzbd queues",
    panel: "sabQueues",
    source: instances.map(({ name }) => name).join(" + ").slice(0, 120) || "SABnzbd",
    intervalMs: 5_000,
    staleAfterMs: 20_000,
    timeoutMs: 3_000,
    required: true,
    enabled: instances.length > 0 && instances.every((instance) => Boolean(instance.apiKey)),
    schema: sabQueuesDataSchema,
    collect: async ({ signal }) => ({
      instances: await Promise.all(instances.map(async (instance) => {
        const url = new URL("/sabnzbd/api", instance.baseUrl);
        url.searchParams.set("mode", "queue");
        url.searchParams.set("output", "json");
        url.searchParams.set("apikey", instance.apiKey);
        return normalizeSabQueue(await request(
          url.toString(),
          { signal, headers: { accept: "application/json" } },
          instance.allowInsecureTls,
        ), instance);
      })),
    }),
  };
}
