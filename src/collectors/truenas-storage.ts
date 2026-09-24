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

type PoolScan = NonNullable<PanelData<"truenasStorage">["scan"]>;
const SCAN_KINDS: Record<string, PoolScan["kind"]> = { SCRUB: "scrub", RESILVER: "resilver" };
const SCAN_STATES: Record<string, PoolScan["state"]> = { SCANNING: "running", FINISHED: "finished", CANCELED: "canceled" };

function poolScan(value: unknown): PoolScan | null {
  const scan = record(value);
  const kind = SCAN_KINDS[String(scan.function ?? "").toUpperCase()];
  const state = SCAN_STATES[String(scan.state ?? "").toUpperCase()];
  if (!kind || !state) return null;
  const endedMs = finiteNumber(record(scan.end_time).$date, Number.NaN);
  return {
    kind,
    state,
    percent: Math.min(100, Math.max(0, finiteNumber(scan.percentage))),
    endedAt: Number.isFinite(endedMs) ? new Date(endedMs).toISOString() : null,
    errors: Math.max(0, Math.trunc(finiteNumber(scan.errors))),
  };
}

// A running scan wins (resilver before scrub); otherwise the most recently ended one.
function headlineScan(pools: UnknownRecord[]): PoolScan | null {
  const scans = pools.map((pool) => poolScan(pool.scan)).filter((scan): scan is PoolScan => scan !== null);
  const running = scans.filter((scan) => scan.state === "running");
  if (running.length) return running.find((scan) => scan.kind === "resilver") ?? running[0]!;
  return scans.sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""))[0] ?? null;
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
    scan: headlineScan(pools),
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
