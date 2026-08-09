import { arcaneDataSchema, type PanelData } from "../contracts/dashboard.js";
import { boundedText, fetchJson, integer, type Collector, type JsonRequest } from "./collector.js";

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}
function list(value: unknown): unknown[] {
  const body = record(value);
  if (Array.isArray(value)) return value;
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.containers)) return body.containers;
  if (Array.isArray(body.environments)) return body.environments;
  if (Array.isArray(record(body.data).items)) return record(body.data).items as unknown[];
  if (Array.isArray(record(body.data).containers)) return record(body.data).containers as unknown[];
  if (Array.isArray(record(body.data).environments)) return record(body.data).environments as unknown[];
  return [];
}

export function normalizeArcaneEnvironment(environmentValue: unknown, containersValue: unknown): PanelData<"arcane">["environments"][number] {
  const environment = record(environmentValue);
  const rawStatus = String(environment.status ?? "unknown").toLowerCase();
  // Polling Edge Agents report standby between check-ins; that is a healthy,
  // reachable state rather than an unavailable environment.
  const connected = rawStatus === "standby" || (environment.connected !== false && rawStatus !== "offline");
  return {
    id: boundedText(environment.id ?? "unknown", 100),
    name: boundedText(environment.name ?? "Unnamed environment", 80),
    status: rawStatus.includes("online") || rawStatus === "active" ? "online" : rawStatus.includes("standby") ? "standby" : rawStatus.includes("offline") ? "offline" : "unknown",
    connected,
    containers: list(containersValue).slice(0, 100).map((value) => {
      const container = record(value);
      const rawState = String(container.state ?? "unknown").toLowerCase();
      return {
        name: boundedText(Array.isArray(container.names) ? container.names[0] : container.name ?? "unknown", 120).replace(/^\//, ""),
        state: rawState === "running" ? "running" : rawState === "exited" || rawState === "stopped" ? "exited" : rawState === "paused" ? "paused" : "unknown",
        status: boundedText(container.status ?? rawState, 160),
      };
    }),
  };
}

export function createArcaneCollector(
  baseUrl: string,
  apiKey: string,
  request: JsonRequest = fetchJson,
  allowInsecureTls = false,
): Collector<"arcane"> {
  const headers = { "x-api-key": apiKey, accept: "application/json" };
  const lastKnownContainers = new Map<string, unknown[]>();
  return {
    name: "Arcane environments",
    panel: "arcane",
    source: "Arcane Manager",
    intervalMs: 15_000,
    staleAfterMs: 60_000,
    timeoutMs: 5_000,
    required: true,
    enabled: apiKey.length > 0,
    schema: arcaneDataSchema,
    collect: async ({ signal }) => {
      const environmentsResponse = await request(`${baseUrl.replace(/\/$/, "")}/environments?limit=50`, { signal, headers }, allowInsecureTls);
      const environments = await Promise.all(list(environmentsResponse).map(async (value) => {
        const environment = record(value);
        const id = String(environment.id);
        const rawStatus = String(environment.status).toLowerCase();
        if (environment.connected === false && rawStatus !== "standby") {
          return normalizeArcaneEnvironment(environment, []);
        }
        try {
          const containers = await request(`${baseUrl.replace(/\/$/, "")}/environments/${encodeURIComponent(String(environment.id))}/containers?limit=100&includeInternal=false`, { signal, headers }, allowInsecureTls);
          const currentContainers = list(containers);
          lastKnownContainers.set(id, currentContainers);
          return normalizeArcaneEnvironment(environment, currentContainers);
        } catch {
          if (rawStatus === "standby") return normalizeArcaneEnvironment(environment, lastKnownContainers.get(id) ?? []);
          return normalizeArcaneEnvironment({ ...environment, connected: false, status: "unknown" }, []);
        }
      }));
      const allContainers = environments.flatMap((environment) => environment.containers);
      return arcaneDataSchema.parse({
        total: integer(allContainers.length),
        running: allContainers.filter((container) => container.state === "running").length,
        environments,
      });
    },
  };
}
