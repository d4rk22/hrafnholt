import { backupsDataSchema, type PanelData } from "../contracts/dashboard.js";
import { boundedText, fetchJson, type Collector, type JsonRequest } from "./collector.js";
import { collectPveBackupJobs } from "./proxmox.js";

type UnknownRecord = Record<string, unknown>;
type BackupJob = PanelData<"backups">["jobs"][number];
type PbsOverview = NonNullable<PanelData<"backups">["pbs"]>;
type PbsOverviewDraft = Omit<PbsOverview, "serverName">;
type PbsDatastore = PbsOverview["datastores"][number];
type PbsResult = PbsOverview["verificationResult"];
type PbsTaskCollection = { jobs: BackupJob[]; serverName: string };
const PBS_RUN_QUIET_GAP_SECONDS = 15 * 60;
const MERGED_RUN_START_TOLERANCE_MS = 15 * 60 * 1000;
const MAX_PBS_DATASTORES = 8;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function dataRecords(input: unknown): UnknownRecord[] | null {
  const data = record(input).data;
  return Array.isArray(data) ? data.map(record) : null;
}

function taskEpoch(task: UnknownRecord, field: "starttime" | "endtime"): number | null {
  const value = Number(task[field]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function safeBytes(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function isoFromEpoch(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > 8.64e15) return null;
  return new Date(seconds * 1000).toISOString();
}

function upidStartEpoch(value: unknown): number | null {
  const parts = String(value ?? "").split(":");
  if (parts[0] !== "UPID" || !/^[0-9a-f]+$/i.test(parts[4] ?? "")) return null;
  const seconds = Number.parseInt(parts[4]!, 16);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

function pbsServerName(input: unknown): string {
  let fallback = "PBS";
  for (const row of dataRecords(input) ?? []) {
    const parts = String(row.upid ?? "").split(":");
    const upidNode = parts[0] === "UPID" ? boundedText(parts[1], 80) : "";
    if (upidNode && upidNode.toLowerCase() !== "localhost") return upidNode;
    const node = boundedText(row.node, 80);
    if (node && node.toLowerCase() !== "localhost") return node;
    if (node) fallback = node;
  }
  return fallback.toLowerCase() === "localhost" ? "PBS" : fallback;
}

export function latestPbsBackupRun(input: unknown): UnknownRecord[] {
  const rows = Array.isArray(record(input).data) ? record(input).data as unknown[] : [];
  const tasks = rows
    .map(record)
    .filter((task) => String(task.worker_type ?? task.type ?? "").toLowerCase() === "backup" && taskEpoch(task, "starttime") !== null)
    .sort((left, right) => Number(right.starttime) - Number(left.starttime));
  if (!tasks.length) return [];

  const selected = [tasks[0]!];
  let earliestStart = Number(tasks[0]!.starttime);
  for (const task of tasks.slice(1)) {
    const previousEnd = taskEpoch(task, "endtime") ?? taskEpoch(task, "starttime");
    if (previousEnd === null || earliestStart - previousEnd > PBS_RUN_QUIET_GAP_SECONDS) break;
    selected.push(task);
    earliestStart = Math.min(earliestStart, Number(task.starttime));
  }
  return selected;
}

export function pbsIncrementalBytes(input: unknown): number | null {
  const rows = Array.isArray(record(input).data) ? record(input).data as unknown[] : [];
  let total = 0;
  let found = false;
  for (const row of rows) {
    const match = String(record(row).t ?? "").match(/\bUpload size:\s*(\d+)\b/i);
    if (!match) continue;
    const bytes = Number(match[1]);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(total + bytes)) continue;
    total += bytes;
    found = true;
  }
  return found ? total : null;
}

function normalizedRunResult(rows: UnknownRecord[]): PbsResult {
  const states = rows.map((row) => boundedText(row["last-run-state"], 200).toLowerCase()).filter(Boolean);
  if (states.some((state) => /\b(error|failed?|aborted?)\b/.test(state))) return "failure";
  if (rows.some((row) => boundedText(row.upid, 200))) return "running";
  if (states.some((state) => state.startsWith("warning"))) return "warning";
  if (states.some((state) => state === "ok" || state.startsWith("ok "))) return "success";
  return "unavailable";
}

function strongestResult(...results: PbsResult[]): PbsResult {
  const priority: Record<PbsResult, number> = {
    failure: 5,
    running: 4,
    warning: 3,
    success: 2,
    unavailable: 1,
  };
  return results.reduce((strongest, result) => priority[result] > priority[strongest] ? result : strongest, "unavailable");
}

function latestIso(values: Array<number | null>): string | null {
  const finite = values.filter((value): value is number => value !== null);
  return finite.length ? isoFromEpoch(Math.max(...finite)) : null;
}

function datastoreMaintenance(row: UnknownRecord): boolean {
  const value = row.maintenance;
  if (value === null || value === undefined || value === false) return false;
  const normalized = boundedText(value, 80).toLowerCase();
  return Boolean(normalized && !["none", "false", "off"].includes(normalized));
}

function datastoreState(row: UnknownRecord, snapshotsAvailable: boolean): PbsDatastore["status"] {
  if (datastoreMaintenance(row)) return "maintenance";
  const mountStatus = boundedText(row["mount-status"], 80).toLowerCase();
  if (mountStatus === "notmounted" || mountStatus === "not-mounted") return "unavailable";
  return snapshotsAvailable ? "online" : "degraded";
}

function snapshotVerificationResult(snapshots: UnknownRecord[] | null): PbsResult {
  if (snapshots === null || snapshots.length === 0) return "unavailable";
  const states = snapshots.map((snapshot) => boundedText(record(snapshot.verification).state, 80).toLowerCase());
  if (states.includes("failed")) return "failure";
  return states.every((state) => state === "ok") ? "success" : "warning";
}

function pbsDatastoreRows(input: unknown): Array<{ name: string; row: UnknownRecord }> {
  const rows = dataRecords(input);
  if (rows === null) throw new Error("PBS datastore list is invalid");
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const name = boundedText(row.store, 80);
    if (!name || seen.has(name)) return [];
    seen.add(name);
    return [{ name, row }];
  });
}

async function collectPbsOverview(
  baseUrl: string,
  token: string,
  signal: AbortSignal,
  request: JsonRequest,
): Promise<PbsOverviewDraft | undefined> {
  if (!token) return undefined;
  const rootUrl = baseUrl.replace(/\/$/, "");
  const headers = { authorization: `PBSAPIToken=${token}`, accept: "application/json" };
  const listResponse = await request(`${rootUrl}/api2/json/admin/datastore`, { signal, headers });
  const allEntries = pbsDatastoreRows(listResponse);
  if (!allEntries.length) throw new Error("PBS returned no accessible datastore");
  const entries = allEntries.slice(0, MAX_PBS_DATASTORES);

  const [statusResults, snapshotResults, garbageCollection, verification] = await Promise.all([
    Promise.allSettled(entries.map(({ name }) => request(
      `${rootUrl}/api2/json/admin/datastore/${encodeURIComponent(name)}/status`,
      { signal, headers },
    ))),
    Promise.allSettled(entries.map(({ name }) => request(
      `${rootUrl}/api2/json/admin/datastore/${encodeURIComponent(name)}/snapshots`,
      { signal, headers },
    ))),
    request(`${rootUrl}/api2/json/admin/gc`, { signal, headers }).then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const, value: null }),
    ),
    request(`${rootUrl}/api2/json/admin/verify`, { signal, headers }).then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const, value: null }),
    ),
  ]);

  const snapshotSets = snapshotResults.map((result) => result.status === "fulfilled" ? dataRecords(result.value) : null);
  const datastores: PbsDatastore[] = [];
  let capacityComplete = allEntries.length <= MAX_PBS_DATASTORES;
  entries.forEach(({ name, row }, index) => {
    const statusResult = statusResults[index];
    if (statusResult?.status !== "fulfilled") {
      capacityComplete = false;
      return;
    }
    const status = record(record(statusResult.value).data);
    const usedBytes = safeBytes(status.used);
    const availableBytes = safeBytes(status.avail);
    const totalBytes = safeBytes(status.total);
    if (usedBytes === null || availableBytes === null || totalBytes === null || totalBytes <= 0) {
      capacityComplete = false;
      return;
    }
    const snapshots = snapshotSets[index] ?? null;
    datastores.push({
      name,
      status: datastoreState(row, snapshots !== null),
      usedBytes,
      availableBytes,
      totalBytes,
      restorePoints: snapshots?.length ?? null,
    });
  });
  if (!datastores.length) throw new Error("PBS datastore capacity is unavailable");

  const snapshotCoverageComplete = allEntries.length <= MAX_PBS_DATASTORES
    && snapshotSets.every((snapshots) => snapshots !== null);
  const availableSnapshots = snapshotSets.flatMap((snapshots) => snapshots ?? []);
  const completeSnapshots = snapshotCoverageComplete ? availableSnapshots : null;
  const protectedGuests = completeSnapshots === null
    ? null
    : new Set(completeSnapshots.flatMap((snapshot) => {
      const type = boundedText(snapshot["backup-type"], 20).toLowerCase();
      const id = boundedText(snapshot["backup-id"], 120);
      return ["vm", "ct"].includes(type) && id ? [`${type}/${id}`] : [];
    })).size;
  const verifiedSnapshots = completeSnapshots === null
    ? null
    : completeSnapshots.filter((snapshot) => boundedText(record(snapshot.verification).state, 80).toLowerCase() === "ok").length;
  const verificationTotal = completeSnapshots?.length ?? null;

  const verificationRows = verification.ok ? dataRecords(verification.value) : null;
  const verificationResult = strongestResult(
    snapshotVerificationResult(completeSnapshots),
    verificationRows === null ? "unavailable" : normalizedRunResult(verificationRows),
  );
  const lastVerificationAt = latestIso([
    ...(verificationRows ?? []).map((row) => {
      const value = Number(row["last-run-endtime"]);
      return Number.isFinite(value) && value > 0 ? value : null;
    }),
    ...availableSnapshots.map((snapshot) => upidStartEpoch(record(snapshot.verification).upid)),
  ]);

  const garbageCollectionRows = garbageCollection.ok ? dataRecords(garbageCollection.value) : null;
  const garbageCollectionResult = garbageCollectionRows === null ? "unavailable" : normalizedRunResult(garbageCollectionRows);
  const completedGarbageCollectionRows = (garbageCollectionRows ?? [])
    .map((row) => ({ row, endtime: Number(row["last-run-endtime"]) }))
    .filter((entry) => Number.isFinite(entry.endtime) && entry.endtime > 0)
    .sort((left, right) => right.endtime - left.endtime);
  const latestGarbageCollection = completedGarbageCollectionRows[0] ?? null;
  const lastGarbageCollectionAt = latestGarbageCollection ? isoFromEpoch(latestGarbageCollection.endtime) : null;
  const reclaimedBytes = latestGarbageCollection ? safeBytes(latestGarbageCollection.row["removed-bytes"]) : null;

  const detailSourcesComplete = snapshotCoverageComplete
    && verificationRows !== null
    && garbageCollectionRows !== null;
  const serverDegraded = !capacityComplete
    || !detailSourcesComplete
    || datastores.some((datastore) => ["degraded", "unavailable"].includes(datastore.status))
    || verificationResult === "failure"
    || ["warning", "failure"].includes(garbageCollectionResult);
  const status = datastores.some((datastore) => datastore.status === "maintenance")
    ? "maintenance"
    : serverDegraded
      ? "degraded"
      : "online";

  return {
    status,
    datastores: datastores.sort((left, right) => left.name.localeCompare(right.name)),
    protectedGuests,
    verifiedSnapshots,
    verificationTotal,
    lastVerificationAt,
    verificationResult,
    lastGarbageCollectionAt,
    garbageCollectionResult,
    reclaimedBytes,
  };
}

function pbsRunResult(tasks: UnknownRecord[]) {
  const statuses = tasks.map((task) => String(task.status ?? "running"));
  const failures = tasks.filter((task, index) => taskEpoch(task, "endtime") !== null && statuses[index] !== "OK" && !statuses[index]!.startsWith("WARNINGS")).length;
  const warnings = statuses.filter((status) => status.startsWith("WARNINGS")).length;
  const running = tasks.some((task) => taskEpoch(task, "endtime") === null);
  if (failures) return { result: "failure" as const, message: `${failures} of ${tasks.length} guest backups failed` };
  if (warnings) return { result: "warning" as const, message: `${warnings} of ${tasks.length} guest backups completed with warnings` };
  if (running) return { result: "running" as const, message: null };
  return { result: "success" as const, message: null };
}

function jobStartMs(job: BackupJob | undefined): number | null {
  if (!job?.lastRunAt) return null;
  const value = Date.parse(job.lastRunAt);
  return Number.isFinite(value) ? value : null;
}

function jobEndMs(job: BackupJob | undefined): number | null {
  const start = jobStartMs(job);
  return start !== null && job && job.durationSeconds !== null ? start + job.durationSeconds * 1000 : null;
}

function guestCount(job: BackupJob | undefined): number | null {
  const match = job?.detail.match(/^(\d+) guests?\b/i);
  return match ? Number(match[1]) : null;
}

function mergedResult(pve: BackupJob, pbs: BackupJob): BackupJob["result"] {
  const priority: Record<BackupJob["result"], number> = { failure: 6, warning: 5, running: 4, unavailable: 3, success: 2, not_configured: 1 };
  return priority[pve.result] >= priority[pbs.result] ? pve.result : pbs.result;
}

function pveSourceMessage(job: BackupJob): string | null {
  if (!job.message) return null;
  const warnings = job.message.match(/^(\d+) warnings?$/i);
  if (warnings?.[1]) return `${warnings[1]} source ${warnings[1] === "1" ? "warning" : "warnings"}`;
  const failures = job.message.match(/^(\d+) tasks? failed$/i);
  return failures?.[1] ? `${failures[1]} PVE ${failures[1] === "1" ? "task" : "tasks"} failed` : job.message;
}

export function mergeGuestBackupJobs(pveJobs: BackupJob[], pbsJobs: BackupJob[]): BackupJob[] {
  const pve = pveJobs[0];
  const pbs = pbsJobs[0];
  const pveStart = jobStartMs(pve);
  const pbsStart = jobStartMs(pbs);
  if (pve && pbs && pveStart !== null && pbsStart !== null
    && Math.abs(pveStart - pbsStart) <= MERGED_RUN_START_TOLERANCE_MS
    && pve.result !== "unavailable" && pbs.result !== "unavailable") {
    const pveGuests = guestCount(pve);
    const pbsGuests = guestCount(pbs);
    const countsMatch = pveGuests !== null && pveGuests === pbsGuests;
    const startedAt = Math.min(pveStart, pbsStart);
    const completed = [jobEndMs(pve), jobEndMs(pbs)].filter((value): value is number => value !== null);
    const completedAt = completed.length === 2 ? Math.max(...completed) : null;
    const result = mergedResult(pve, pbs);
    const mismatchMessage = completedAt !== null && pveGuests !== null && pbsGuests !== null && !countsMatch ? `${pbsGuests} of ${pveGuests} guests stored in PBS` : null;
    const message = mismatchMessage ?? pveSourceMessage(pve) ?? (pbs.result === "success" ? null : pbs.message);
    const visibleGuests = Math.max(pveGuests ?? 0, pbsGuests ?? 0);
    const detail = mismatchMessage
      ? "PVE and PBS guest counts differ"
      : result === "running"
        ? `${visibleGuests} ${visibleGuests === 1 ? "guest" : "guests"} · backup in progress`
        : countsMatch
          ? `${pveGuests} ${pveGuests === 1 ? "guest" : "guests"} · stored in PBS`
          : "Guest count unavailable · stored in PBS";
    return [{
      id: boundedText(`guest-backup-run-${Math.floor(startedAt / 1000)}`, 120),
      name: "Proxmox guest backups",
      detail,
      source: "Proxmox VE + PBS",
      result: mismatchMessage && result === "success" ? "warning" : result,
      lastRunAt: new Date(startedAt).toISOString(),
      durationSeconds: completedAt === null ? null : Math.max(0, Math.round((completedAt - startedAt) / 1000)),
      transferredBytes: pbs.transferredBytes,
      message: message === null ? null : boundedText(message, 200),
    }];
  }

  const primary = pbs && pbs.result !== "unavailable" ? pbs : pve;
  const missingMessage = !pve || pve.result === "unavailable"
    ? "PVE status unavailable"
    : !pbs || pbs.result === "unavailable"
      ? "PBS status unavailable"
      : "PVE and PBS runs do not align";
  const primaryGuests = guestCount(primary);
  return [{
    id: boundedText(primary?.id ?? "guest-backup-run", 120),
    name: "Proxmox guest backups",
    detail: primaryGuests === null ? "Guest count unavailable · source coverage incomplete" : `${primaryGuests} ${primaryGuests === 1 ? "guest" : "guests"} · source coverage incomplete`,
    source: "Proxmox VE + PBS",
    result: "unavailable",
    lastRunAt: primary?.lastRunAt ?? null,
    durationSeconds: primary?.durationSeconds ?? null,
    transferredBytes: pbs?.transferredBytes ?? null,
    message: missingMessage,
  }];
}

async function collectPbsTasks(
  baseUrl: string,
  token: string,
  signal: AbortSignal,
  request: JsonRequest,
): Promise<PbsTaskCollection> {
  if (!token) {
    return {
      serverName: "PBS",
      jobs: [{ id: "pbs", name: "PBS guest backup run", detail: "audit token required", source: "Proxmox Backup Server", result: "unavailable", lastRunAt: null, durationSeconds: null, transferredBytes: null, message: "Read-only token not configured" }],
    };
  }
  const rootUrl = baseUrl.replace(/\/$/, "");
  const headers = { authorization: `PBSAPIToken=${token}`, accept: "application/json" };
  const response = await request(`${rootUrl}/api2/json/nodes/localhost/tasks?limit=100`, { signal, headers });
  const serverName = pbsServerName(response);
  const tasks = latestPbsBackupRun(response);
  if (!tasks.length) {
    return {
      serverName,
      jobs: [{ id: "pbs", name: "PBS guest backup run", detail: "guest backup tasks", source: "Proxmox Backup Server", result: "unavailable", lastRunAt: null, durationSeconds: null, transferredBytes: null, message: "No guest backup task found" }],
    };
  }

  const starts = tasks.map((task) => taskEpoch(task, "starttime")).filter((value): value is number => value !== null);
  const ends = tasks.map((task) => taskEpoch(task, "endtime"));
  const startedAt = Math.min(...starts);
  const completedAt = ends.every((value): value is number => value !== null) ? Math.max(...ends) : null;
  const status = pbsRunResult(tasks);
  let transferredBytes: number | null = null;
  const upids = tasks.map((task) => String(task.upid ?? "")).filter(Boolean);
  if (upids.length === tasks.length) {
    const logs = await Promise.allSettled(upids.map((upid) => request(`${rootUrl}/api2/json/nodes/localhost/tasks/${encodeURIComponent(upid)}/log?start=0&limit=10000`, { signal, headers })));
    const sizes = logs.map((log) => log.status === "fulfilled" ? pbsIncrementalBytes(log.value) : null);
    if (sizes.every((value): value is number => value !== null)) {
      const total = sizes.reduce((sum, value) => sum + value, 0);
      transferredBytes = Number.isSafeInteger(total) ? total : null;
    }
  }
  const guestLabel = `${tasks.length} ${tasks.length === 1 ? "guest" : "guests"}`;
  return {
    serverName,
    jobs: [{
      id: boundedText(`pbs-run-${startedAt}`, 120), name: "PBS guest backup run", detail: `${guestLabel} · ${completedAt === null ? "run in progress" : "latest completed run"}`, source: "Proxmox Backup Server",
      result: status.result,
      lastRunAt: new Date(startedAt * 1000).toISOString(),
      durationSeconds: completedAt === null ? null : Math.max(0, completedAt - startedAt),
      transferredBytes,
      message: status.message === null ? null : boundedText(status.message, 200),
    }],
  };
}

export function createBackupCollector(
  options: {
    pveUrl: string;
    pveToken: string;
    pbs?: {
      url: string;
      token: string;
    };
    allowInsecureTls?: boolean;
  },
  request: JsonRequest = fetchJson,
): Collector<"backups"> {
  const configuredRequest: JsonRequest = (url, init) => request(url, init, options.allowInsecureTls);
  return {
    name: "Backup task ledger",
    panel: "backups",
    source: options.pbs ? "Proxmox VE + PBS" : "Proxmox VE",
    intervalMs: 300_000,
    staleAfterMs: 1_200_000,
    timeoutMs: 8_000,
    required: true,
    enabled: Boolean(options.pveUrl && options.pveToken),
    schema: backupsDataSchema,
    collect: async ({ signal }) => {
      const pvePromise = collectPveBackupJobs(options.pveUrl, options.pveToken, signal, configuredRequest);
      if (!options.pbs) {
        const [pve] = await Promise.allSettled([pvePromise]);
        return backupsDataSchema.parse({
          jobs: pve.status === "fulfilled" ? pve.value : [{
            id: "pve-backups",
            name: "Proxmox guest backup run",
            detail: "scheduled backup tasks",
            source: "Proxmox VE",
            result: "unavailable",
            lastRunAt: null,
            durationSeconds: null,
            transferredBytes: null,
            message: "PVE backup task history unavailable",
          }],
        });
      }

      const [pve, pbsTasks, pbsOverview] = await Promise.allSettled([
        pvePromise,
        collectPbsTasks(options.pbs.url, options.pbs.token, signal, configuredRequest),
        collectPbsOverview(options.pbs.url, options.pbs.token, signal, configuredRequest),
      ]);
      const pveJobs = pve.status === "fulfilled" ? pve.value : [{ id: "pve-backups", name: "Proxmox guest backup run", detail: "scheduled backup tasks", source: "Proxmox VE", result: "unavailable" as const, lastRunAt: null, durationSeconds: null, transferredBytes: null, message: "PVE backup task history unavailable" }];
      const pbsJobs = pbsTasks.status === "fulfilled"
        ? pbsTasks.value.jobs
        : [{ id: "pbs", name: "PBS guest backup run", detail: "guest backup tasks", source: "Proxmox Backup Server", result: "unavailable" as const, lastRunAt: null, durationSeconds: null, transferredBytes: null, message: "PBS task history unavailable" }];
      const pbs = pbsOverview.status === "fulfilled" && pbsOverview.value
        ? { ...pbsOverview.value, serverName: pbsTasks.status === "fulfilled" ? pbsTasks.value.serverName : "PBS" }
        : undefined;
      return backupsDataSchema.parse({
        ...(pbs ? { pbs } : {}),
        jobs: mergeGuestBackupJobs(pveJobs, pbsJobs),
      });
    },
  };
}
