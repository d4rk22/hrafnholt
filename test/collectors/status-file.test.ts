import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseConfigDocument } from "../../src/config.js";
import { createBackupCollector } from "../../src/collectors/pbs.js";
import { collectStatusFileJob, statusFileJob, STATUS_FILE_MAX_BYTES, type BackupStatusFileConfig } from "../../src/collectors/status-file.js";

const now = new Date("2026-03-02T12:00:00Z");
const config = (path = "/nonexistent/status.json"): BackupStatusFileConfig => ({ id: "mirror", name: "Nightly mirror", detail: "File mirror", path, maxAgeHours: 26 });
const base = { schema: 1 as const, state: "success" as const, started_at: "2026-03-02T05:00:00-06:00", finished_at: "2026-03-02T05:14:00-06:00", duration_seconds: 840, datasets: 12, files: 10, bytes: 1_000, deleted: 0, monthly: false, message: null };

function liveConfig(extra: string): string {
  return `
schema_version: 1
mode: live
collectors:
  - type: backups
    id: backups
    name: Backups
    pve: {url: "https://pve.example", api_token_ref: PVE_TOKEN}
${extra}`;
}

test("status_files config accepts a valid entry and defaults max_age_hours", () => {
  const parsed = parseConfigDocument(liveConfig(`    status_files:
      - {id: mirror, name: Mirror, detail: Detail, path: /srv/a.json}
`));
  const backups = parsed.collectors[0];
  assert.equal(backups?.type === "backups" && backups.status_files[0]?.max_age_hours, 26);
});

test("status_files config rejects relative paths, bad ids, bad ages, duplicates, and excess entries", () => {
  const entry = (fields: string) => liveConfig(`    status_files:\n      - {${fields}}\n`);
  assert.throws(() => parseConfigDocument(entry("id: mirror, name: M, detail: D, path: relative.json")), /absolute path/);
  assert.throws(() => parseConfigDocument(entry("id: Bad_Id, name: M, detail: D, path: /a.json")), /lowercase/);
  assert.throws(() => parseConfigDocument(entry("id: m, name: M, detail: D, path: /a.json, max_age_hours: 0")), /max_age_hours/);
  assert.throws(() => parseConfigDocument(liveConfig(`    status_files:
      - {id: m, name: M, detail: D, path: /a.json}
      - {id: m, name: N, detail: D, path: /b.json}
`)), /unique/);
  const nine = Array.from({ length: 9 }, (_, i) => `      - {id: m${String.fromCharCode(97 + i)}, name: M, detail: D, path: /a${i}.json}`).join("\n");
  assert.throws(() => parseConfigDocument(liveConfig(`    status_files:\n${nine}\n`)), /status_files/);
});

test("statusFileJob maps each state", () => {
  const ok = statusFileJob(config(), base, now);
  assert.deepEqual(ok, {
    id: "file:mirror", name: "Nightly mirror", detail: "12 datasets · File mirror", source: "Status file",
    result: "success", lastRunAt: "2026-03-02T11:00:00.000Z", durationSeconds: 840, transferredBytes: 1_000, message: null,
  });
  assert.equal(statusFileJob(config(), { ...base, datasets: null }, now).detail, "File mirror");

  const failed = statusFileJob(config(), { ...base, state: "failed", message: "x".repeat(300) }, now);
  assert.equal(failed.result, "failure");
  assert.equal(failed.message?.length, 200);
  assert.equal(statusFileJob(config(), { ...base, state: "failed", message: null }, now).message, "Last run failed");

  const running = statusFileJob(config(), { ...base, state: "running", finished_at: null, duration_seconds: null }, now);
  assert.equal(running.result, "running");
  assert.equal(running.message, "Running");
});

test("statusFileJob warns on stale success or stuck running", () => {
  const later = new Date("2026-03-03T17:30:00Z");
  const stale = statusFileJob(config(), base, later);
  assert.equal(stale.result, "warning");
  assert.equal(stale.message, "No successful run in 30h");
  const stuck = statusFileJob(config(), { ...base, state: "running", finished_at: null }, later);
  assert.equal(stuck.result, "warning");
  assert.equal(stuck.message, "Stuck running for 30h");
  assert.equal(statusFileJob(config(), { ...base, state: "failed" }, later).result, "failure");
});

test("collectStatusFileJob handles missing, invalid, oversized, and unreadable files without leaking contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hrafnholt-status-"));
  try {
    const signal = new AbortController().signal;
    const missing = await collectStatusFileJob(config(join(dir, "none.json")), signal, now);
    assert.equal(missing.result, "not_configured");
    assert.equal(missing.message, "Status file not found");
    assert.equal(missing.lastRunAt, null);

    const good = join(dir, "good.json");
    await writeFile(good, JSON.stringify({ ...base, extra_key: true }));
    assert.equal((await collectStatusFileJob(config(good), signal, now)).result, "success");

    const bad = join(dir, "bad.json");
    await writeFile(bad, "{secret-not-json");
    const invalid = await collectStatusFileJob(config(bad), signal, now);
    assert.equal(invalid.result, "unavailable");
    assert.equal(invalid.message, "Status file invalid");
    assert.doesNotMatch(JSON.stringify(invalid), /secret/);

    const wrong = join(dir, "wrong.json");
    await writeFile(wrong, JSON.stringify({ ...base, schema: 2 }));
    assert.equal((await collectStatusFileJob(config(wrong), signal, now)).message, "Status file invalid");

    const big = join(dir, "big.json");
    await writeFile(big, JSON.stringify({ ...base, message: "x".repeat(STATUS_FILE_MAX_BYTES) }));
    const oversized = await collectStatusFileJob(config(big), signal, now);
    assert.equal(oversized.result, "unavailable");
    assert.equal(oversized.message, "Status file too large");

    const unreadable = await collectStatusFileJob(config(dir), signal, now);
    assert.equal(unreadable.result, "unavailable");
    assert.equal(unreadable.message, "Status file unreadable");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a broken status file never removes PVE or PBS rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hrafnholt-status-"));
  try {
    const bad = join(dir, "bad.json");
    await writeFile(bad, "nope");
    const pveUpid = "UPID:node-a:vzdump:root@pam:";
    const request = async (url: string) => {
      if (url.endsWith("/cluster/tasks")) return { data: [{ type: "vzdump", node: "node-a", upid: pveUpid, starttime: 2_000, endtime: 2_100, status: "OK" }] };
      if (url.includes(encodeURIComponent(pveUpid))) return { data: [{ t: "INFO: Starting Backup of VM 101 (qemu)" }] };
      throw new Error(`Unexpected request: ${url}`);
    };
    const statusFiles = [config(bad), { ...config(join(dir, "none.json")), id: "other", name: "Other" }];
    for (const pbs of [undefined, { url: "https://pbs.example", token: "t" }]) {
      const collector = createBackupCollector({ pveUrl: "https://pve.example", pveToken: "t", ...(pbs ? { pbs } : {}), statusFiles }, request);
      const data = await collector.collect({ signal: new AbortController().signal, now });
      const ids = data.jobs.map(({ id }) => id);
      assert.deepEqual(ids.slice(-2), ["file:mirror", "file:other"]);
      assert.equal(ids.length >= 3, true);
      assert.deepEqual(data.jobs.slice(-2).map(({ result }) => result), ["unavailable", "not_configured"]);
      assert.notEqual(data.jobs[0]?.source, "Status file");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
