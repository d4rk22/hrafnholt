import { open } from "node:fs/promises";
import { z } from "zod";
import type { PanelData } from "../contracts/dashboard.js";
import { boundedText } from "./collector.js";

type BackupJob = PanelData<"backups">["jobs"][number];

export interface BackupStatusFileConfig {
  id: string;
  name: string;
  detail: string;
  path: string;
  maxAgeHours: number;
}

export const STATUS_FILE_MAX_BYTES = 64 * 1024;

const count = z.number().int().nonnegative().nullish();

// Unknown extra keys are ignored (zod objects strip by default).
export const backupStatusFileSchema = z.object({
  schema: z.literal(1),
  state: z.enum(["running", "success", "failed"]),
  started_at: z.iso.datetime({ offset: true }),
  finished_at: z.iso.datetime({ offset: true }).nullish(),
  duration_seconds: count,
  datasets: count,
  files: count,
  bytes: z.number().nonnegative().nullish(),
  deleted: count,
  monthly: z.boolean().nullish(),
  message: z.string().nullish(),
});

export type BackupStatusFile = z.infer<typeof backupStatusFileSchema>;

function placeholder(config: BackupStatusFileConfig, result: BackupJob["result"], message: string): BackupJob {
  return {
    id: `file:${config.id}`,
    name: config.name,
    detail: config.detail,
    source: "Status file",
    result,
    lastRunAt: null,
    durationSeconds: null,
    transferredBytes: null,
    message,
  };
}

/** Pure mapping from a parsed status file to a dashboard job row. */
export function statusFileJob(config: BackupStatusFileConfig, parsed: BackupStatusFile, now: Date): BackupJob {
  const startedMs = Date.parse(parsed.started_at);
  const reference = Date.parse(parsed.finished_at ?? parsed.started_at);
  const referenceMs = Number.isFinite(reference) ? reference : startedMs;
  const ageHours = (now.getTime() - referenceMs) / 3_600_000;
  const stale = ageHours > config.maxAgeHours;
  const hours = Math.floor(ageHours);

  let result: BackupJob["result"];
  let message: string | null;
  if (parsed.state === "failed") {
    result = "failure";
    message = boundedText(parsed.message, 200) || "Last run failed";
  } else if (parsed.state === "running") {
    result = stale ? "warning" : "running";
    message = stale ? `Stuck running for ${hours}h` : "Running";
  } else {
    result = stale ? "warning" : "success";
    message = stale ? `No successful run in ${hours}h` : null;
  }

  return {
    id: `file:${config.id}`,
    name: config.name,
    detail: typeof parsed.datasets === "number" ? `${parsed.datasets} datasets · ${config.detail}` : config.detail,
    source: "Status file",
    result,
    lastRunAt: new Date(startedMs).toISOString(),
    durationSeconds: parsed.duration_seconds ?? null,
    transferredBytes: parsed.bytes ?? null,
    message,
  };
}

/** Read one status file. Never throws; problems become a placeholder row without file contents. */
export async function collectStatusFileJob(config: BackupStatusFileConfig, signal: AbortSignal, now: Date): Promise<BackupJob> {
  try {
    signal.throwIfAborted();
    const handle = await open(config.path, "r");
    let text: string;
    try {
      const buffer = Buffer.alloc(STATUS_FILE_MAX_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      signal.throwIfAborted();
      if (bytesRead > STATUS_FILE_MAX_BYTES) return placeholder(config, "unavailable", "Status file too large");
      text = buffer.toString("utf8", 0, bytesRead);
    } finally {
      await handle.close();
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return placeholder(config, "unavailable", "Status file invalid");
    }
    const parsed = backupStatusFileSchema.safeParse(json);
    if (!parsed.success) return placeholder(config, "unavailable", "Status file invalid");
    return statusFileJob(config, parsed.data, now);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return placeholder(config, "not_configured", "Status file not found");
    return placeholder(config, "unavailable", "Status file unreadable");
  }
}

export async function collectStatusFileJobs(configs: readonly BackupStatusFileConfig[], signal: AbortSignal, now: Date): Promise<BackupJob[]> {
  return Promise.all(configs.map((config) => collectStatusFileJob(config, signal, now)));
}
