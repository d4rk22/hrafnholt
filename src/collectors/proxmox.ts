import { proxmoxDataSchema, type PanelData } from "../contracts/dashboard.js";
import { boundedText, fetchJson, finiteNumber, type Collector, type JsonRequest } from "./collector.js";

type UnknownRecord = Record<string, unknown>;
const PVE_RUN_QUIET_GAP_SECONDS = 15 * 60;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}
function dataList(value: unknown): unknown[] {
  const data = record(value).data;
  return Array.isArray(data) ? data : [];
}

function taskEpoch(task: UnknownRecord, field: "starttime" | "endtime"): number | null {
  const value = Number(task[field]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function latestPveBackupRun(input: unknown): UnknownRecord[] {
  const tasks = dataList(input)
    .map(record)
    .filter((task) => String(task.type ?? "").toLowerCase() === "vzdump" && taskEpoch(task, "starttime") !== null)
    .sort((left, right) => Number(right.starttime) - Number(left.starttime));
  if (!tasks.length) return [];

  const selected = [tasks[0]!];
  let earliestStart = Number(tasks[0]!.starttime);
  for (const task of tasks.slice(1)) {
    const start = taskEpoch(task, "starttime");
    if (start === null || earliestStart - start > PVE_RUN_QUIET_GAP_SECONDS) break;
    selected.push(task);
    earliestStart = start;
  }
  return selected;
}

export function pveBackupGuestIds(input: unknown): string[] {
  const ids = new Set<string>();
  for (const row of dataList(input)) {
    const match = String(record(row).t ?? "").match(/\bStarting Backup of VM (\d+)\b/i);
    if (match?.[1]) ids.add(match[1]);
  }
  return [...ids];
}

function pveRunResult(tasks: UnknownRecord[]) {
  const statuses = tasks.map((task) => String(task.status ?? "running"));
  const failures = tasks.filter((task, index) => taskEpoch(task, "endtime") !== null && statuses[index] !== "OK" && !statuses[index]!.startsWith("WARNINGS")).length;
  const warnings = statuses.reduce((sum, status) => {
    const match = status.match(/^WARNINGS:\s*(\d+)/i);
    return sum + (match ? Number(match[1]) : status.startsWith("WARNINGS") ? 1 : 0);
  }, 0);
  const running = tasks.some((task) => taskEpoch(task, "endtime") === null);
  if (failures) return { result: "failure" as const, message: `${failures} ${failures === 1 ? "task" : "tasks"} failed` };
  if (warnings) return { result: "warning" as const, message: `${warnings} ${warnings === 1 ? "warning" : "warnings"}` };
  if (running) return { result: "running" as const, message: null };
  return { result: "success" as const, message: null };
}

export function normalizeCpuModel(value: unknown): string | null {
  const model = boundedText(value ?? "", 160)
    .replace(/\((?:R|TM)\)/gi, "")
    .replace(/\s+CPU(?:\s+@\s+.+)?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return model ? boundedText(model, 120) : null;
}

export function includeProxmoxNode(nodeValue: unknown, excludedNodes: ReadonlySet<string> = new Set()): boolean {
  return !excludedNodes.has(String(record(nodeValue).node ?? ""));
}

export function normalizeProxmoxNode(
  nodeValue: unknown,
  statusValue: unknown,
  guests: unknown[],
  storageValue: unknown = {},
  configuredRole = "cluster node",
): PanelData<"proxmox">["nodes"][number] {
  const node = record(nodeValue);
  const status = record(record(statusValue).data ?? statusValue);
  const storage = record(record(storageValue).data ?? storageValue);
  const memory = record(status.memory);
  const cpuinfo = record(status.cpuinfo);
  const name = boundedText(node.node ?? status.node ?? "unknown", 80);
  const nodeGuests = guests.map(record).filter((guest) => guest.node === name);
  const statusText = String(status.status ?? node.status ?? "unknown").toLowerCase();
  return {
    name,
    role: boundedText(configuredRole, 80) || "cluster node",
    cpuModel: normalizeCpuModel(cpuinfo.model),
    status: statusText === "online" ? "online" : statusText === "offline" ? "down" : "unknown",
    cpuPercent: Math.min(100, Math.max(0, finiteNumber(status.cpu ?? node.cpu) * 100)),
    memoryUsedBytes: Math.max(0, finiteNumber(memory.used ?? status.mem ?? node.mem)),
    memoryTotalBytes: Math.max(0, finiteNumber(memory.total ?? status.maxmem ?? node.maxmem)),
    storageUsedBytes: Math.max(0, finiteNumber(storage.used)),
    storageTotalBytes: Math.max(0, finiteNumber(storage.total)),
    guests: nodeGuests.length,
  };
}

export function createProxmoxCollector(
  baseUrl: string,
  token: string,
  request: JsonRequest = fetchJson,
  options: {
    storageId: string;
    allowInsecureTls?: boolean;
    excludedNodes?: readonly string[];
    nodeRoles?: Readonly<Record<string, string>>;
  },
): Collector<"proxmox"> {
  const base = baseUrl.replace(/\/$/, "");
  const storageId = options.storageId;
  const excludedNodes = new Set(options.excludedNodes ?? []);
  const nodeRoles = new Map(Object.entries(options.nodeRoles ?? {}));
  const headers = { authorization: `PVEAPIToken=${token}`, accept: "application/json" };
  return {
    name: "Proxmox cluster resources",
    panel: "proxmox",
    source: "Proxmox VE",
    intervalMs: 30_000,
    staleAfterMs: 120_000,
    timeoutMs: 5_000,
    required: true,
    enabled: Boolean(baseUrl && token),
    schema: proxmoxDataSchema,
    collect: async ({ signal }) => {
      const [nodesResponse, guestsResponse] = await Promise.all([
        request(`${base}/api2/json/nodes`, { signal, headers }, options.allowInsecureTls),
        request(`${base}/api2/json/cluster/resources?type=vm`, { signal, headers }, options.allowInsecureTls),
      ]);
      const guests = dataList(guestsResponse);
      const nodes = await Promise.all(dataList(nodesResponse).filter(
        (nodeValue) => includeProxmoxNode(nodeValue, excludedNodes),
      ).map(async (nodeValue) => {
        const node = record(nodeValue);
        const nodeName = String(node.node ?? "");
        try {
          const encodedNodeName = encodeURIComponent(nodeName);
          const [status, storage] = await Promise.all([
            request(`${base}/api2/json/nodes/${encodedNodeName}/status`, { signal, headers }, options.allowInsecureTls),
            request(`${base}/api2/json/nodes/${encodedNodeName}/storage/${encodeURIComponent(storageId)}/status`, { signal, headers }, options.allowInsecureTls),
          ]);
          return normalizeProxmoxNode(node, status, guests, storage, nodeRoles.get(nodeName));
        } catch {
          return normalizeProxmoxNode({ ...node, status: "unknown" }, {}, guests, {}, nodeRoles.get(nodeName));
        }
      }));
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      return proxmoxDataSchema.parse({ totalMemoryBytes: nodes.reduce((sum, node) => sum + node.memoryTotalBytes, 0), nodes });
    },
  };
}

export async function collectPveBackupJobs(baseUrl: string, token: string, signal: AbortSignal, request: JsonRequest = fetchJson) {
  const base = baseUrl.replace(/\/$/, "");
  const headers = { authorization: `PVEAPIToken=${token}`, accept: "application/json" };
  const response = await request(
    `${base}/api2/json/cluster/tasks`,
    { signal, headers },
  );
  const tasks = latestPveBackupRun(response);
  if (!tasks.length) return [];

  const starts = tasks.map((task) => taskEpoch(task, "starttime")).filter((value): value is number => value !== null);
  const ends = tasks.map((task) => taskEpoch(task, "endtime"));
  const startedAt = Math.min(...starts);
  const completedAt = ends.every((value): value is number => value !== null) ? Math.max(...ends) : null;
  const status = pveRunResult(tasks);
  const logTargets = tasks.map((task) => ({ node: String(task.node ?? ""), upid: String(task.upid ?? "") }));
  let guestCount: number | null = null;
  if (logTargets.every(({ node, upid }) => node && upid)) {
    const logs = await Promise.allSettled(logTargets.map(({ node, upid }) => request(
      `${base}/api2/json/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/log?start=0&limit=10000`,
      { signal, headers },
    )));
    if (logs.every((log) => log.status === "fulfilled")) {
      guestCount = new Set(logs.flatMap((log) => pveBackupGuestIds(log.status === "fulfilled" ? log.value : {}))).size;
    }
  }
  const guestLabel = guestCount === null ? "guest count unavailable" : `${guestCount} ${guestCount === 1 ? "guest" : "guests"}`;
  return [{
    id: boundedText(`pve-run-${startedAt}`, 120),
    name: "Proxmox guest backup run",
    detail: `${guestLabel} · ${completedAt === null ? "run in progress" : "latest completed run"}`,
    source: "Proxmox VE",
    result: status.result,
    lastRunAt: new Date(startedAt * 1000).toISOString(),
    durationSeconds: completedAt === null ? null : Math.max(0, completedAt - startedAt),
    transferredBytes: null,
    message: status.message === null ? null : boundedText(status.message, 200),
  }];
}
