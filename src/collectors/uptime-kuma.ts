import { servicePostureDataSchema, type PanelData } from "../contracts/dashboard.js";
import { boundedText, fetchJson, finiteNumber, type Collector, type JsonRequest } from "./collector.js";

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

export function normalizeUptimeKuma(configInput: unknown, heartbeatInput: unknown): PanelData<"servicePosture"> {
  const config = record(configInput);
  const heartbeat = record(heartbeatInput);
  const groups = Array.isArray(config.publicGroupList) ? config.publicGroupList : Array.isArray(config.public_group_list) ? config.public_group_list : [];
  const monitors = groups.flatMap((groupValue) => {
    const group = record(groupValue);
    return Array.isArray(group.monitorList) ? group.monitorList : [];
  }).map((value) => record(value));
  const heartbeatMap = record(heartbeat.heartbeatList);
  const normalized = monitors.slice(0, 100).map((monitor, index) => {
    const id = String(monitor.id ?? index);
    const beats = Array.isArray(heartbeatMap[id]) ? heartbeatMap[id] as unknown[] : [];
    const latest = record(beats.at(-1));
    const statusCode = Number(latest.status);
    return {
      id: boundedText(id, 100),
      name: boundedText(monitor.name ?? "Unknown monitor", 120),
      status: statusCode === 1 ? "up" as const : statusCode === 0 ? "down" as const : statusCode === 2 ? "pending" as const : statusCode === 3 ? "maintenance" as const : "unknown" as const,
      pingMs: latest.ping === null || latest.ping === undefined ? null : Math.max(0, finiteNumber(latest.ping)),
      observedAt: latest.time ? new Date(String(latest.time)).toISOString() : null,
    };
  });
  return servicePostureDataSchema.parse({
    healthy: normalized.filter((monitor) => monitor.status === "up").length,
    down: normalized.filter((monitor) => monitor.status === "down").length,
    monitors: normalized,
  });
}

export function createUptimeKumaCollector(
  baseUrl: string,
  slug: string,
  request: JsonRequest = fetchJson,
  allowInsecureTls = false,
): Collector<"servicePosture"> {
  return {
    name: "Uptime Kuma posture",
    panel: "servicePosture",
    source: "Uptime Kuma",
    intervalMs: 30_000,
    staleAfterMs: 120_000,
    timeoutMs: 5_000,
    required: true,
    enabled: true,
    schema: servicePostureDataSchema,
    collect: async ({ signal }) => {
      const base = baseUrl.replace(/\/$/, "");
      const [config, heartbeat] = await Promise.all([
        request(`${base}/api/status-page/${encodeURIComponent(slug)}`, { signal, headers: { accept: "application/json" } }, allowInsecureTls),
        request(`${base}/api/status-page/heartbeat/${encodeURIComponent(slug)}`, { signal, headers: { accept: "application/json" } }, allowInsecureTls),
      ]);
      return normalizeUptimeKuma(config, heartbeat);
    },
  };
}
