import { truenasStorageDataSchema, type PanelData } from "../contracts/dashboard.js";
import { boundedText, fetchJson, finiteNumber, type Collector, type JsonRequest } from "./collector.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const data = record(value).data;
  return Array.isArray(data) ? data : [];
}

function propertyBytes(value: unknown): number {
  const property = record(value);
  return Math.max(0, finiteNumber(property.parsed ?? property.rawvalue ?? value));
}

export function normalizeTrueNasStorage(
  systemValue: unknown,
  poolsValue: unknown,
  datasetsValue: unknown = [],
  fallbackName = "Storage",
): PanelData<"truenasStorage"> {
  const system = record(record(systemValue).data ?? systemValue);
  const pools = list(poolsValue).map(record);
  const datasets = list(datasetsValue).map(record);
  if (!pools.length) throw new Error("TrueNAS returned no storage pools");

  const capacity = pools.map((pool) => {
    const poolName = String(pool.name ?? "");
    const rootDataset = datasets.find((dataset) => String(dataset.id ?? dataset.name ?? "") === poolName);
    const allocated = propertyBytes(rootDataset?.used ?? pool.allocated ?? pool.used);
    const available = propertyBytes(rootDataset?.available ?? pool.free ?? pool.available);
    if (rootDataset) return { used: allocated, available };
    const reportedTotal = Math.max(0, finiteNumber(pool.size ?? pool.total));
    const total = Math.max(reportedTotal, allocated + available);
    return { used: Math.min(allocated, total), available: Math.max(0, total - Math.min(allocated, total)) };
  });
  const statuses = pools.map((pool) => String(pool.status ?? "").toUpperCase());
  const online = statuses.filter((status) => status === "ONLINE").length;
  const health = online === pools.length
    ? "online"
    : statuses.some((status) => status === "DEGRADED") || online > 0
      ? "degraded"
      : statuses.every((status) => status === "OFFLINE")
        ? "offline"
        : "unknown";
  const usedBytes = capacity.reduce((sum, pool) => sum + pool.used, 0);
  const availableBytes = capacity.reduce((sum, pool) => sum + pool.available, 0);

  return truenasStorageDataSchema.parse({
    serverName: boundedText(system.hostname ?? system.host_name ?? fallbackName, 80) || fallbackName,
    health,
    usedBytes,
    availableBytes,
    totalBytes: usedBytes + availableBytes,
    poolsOnline: online,
    poolsTotal: pools.length,
  });
}

export function createTrueNasStorageCollector(
  baseUrl: string,
  apiKey: string,
  request: JsonRequest = fetchJson,
  options: { fallbackName?: string; allowInsecureTls?: boolean } = {},
): Collector<"truenasStorage"> {
  const base = baseUrl.replace(/\/$/, "");
  const headers = { authorization: `Bearer ${apiKey}`, accept: "application/json" };
  return {
    name: "TrueNAS storage capacity",
    panel: "truenasStorage",
    source: "TrueNAS",
    intervalMs: 60_000,
    staleAfterMs: 300_000,
    timeoutMs: 5_000,
    required: true,
    enabled: Boolean(baseUrl && apiKey),
    schema: truenasStorageDataSchema,
    collect: async ({ signal }) => {
      const [system, pools, datasets] = await Promise.all([
        request(`${base}/api/v2.0/system/info`, { signal, headers }, options.allowInsecureTls),
        request(`${base}/api/v2.0/pool`, { signal, headers }, options.allowInsecureTls),
        request(`${base}/api/v2.0/pool/dataset`, { signal, headers }, options.allowInsecureTls),
      ]);
      return normalizeTrueNasStorage(system, pools, datasets, options.fallbackName);
    },
  };
}
