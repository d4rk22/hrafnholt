import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { SnapshotStore } from "../src/cache/snapshot-store.js";
import { dashboardSnapshotSchema } from "../src/contracts/dashboard.js";

async function fixture() {
  const raw = JSON.parse(await readFile(new URL("../fixtures/dashboard-snapshot.json", import.meta.url), "utf8"));
  return dashboardSnapshotSchema.parse(raw);
}

test("success followed by success replaces cached data", async () => {
  let now = Date.parse("2030-01-15T12:00:00.000Z");
  const snapshot = await fixture();
  const store = new SnapshotStore(snapshot.panels, { now: () => now });
  const first = { ...snapshot.panels.bandwidth.data!, downloadMbps: 100 };
  const second = { ...snapshot.panels.bandwidth.data!, downloadMbps: 200 };
  store.recordSuccess("bandwidth", first, now);
  now += 5_000;
  store.recordSuccess("bandwidth", second, now);
  assert.equal(store.snapshot("live").panels.bandwidth.data?.downloadMbps, 200);
  assert.equal(store.snapshot("live").panels.bandwidth.status, "ok");
});

test("last good data becomes stale only after its threshold", async () => {
  let now = Date.parse("2030-01-15T12:00:00.000Z");
  const snapshot = await fixture();
  const store = new SnapshotStore(snapshot.panels, { now: () => now });
  store.recordSuccess("bandwidth", snapshot.panels.bandwidth.data!, now);
  now += 10_000;
  store.recordFailure("bandwidth", new Error("timeout"), now);
  assert.equal(store.snapshot("live").panels.bandwidth.status, "ok");
  now += 21_000;
  const stale = store.snapshot("live").panels.bandwidth;
  assert.equal(stale.status, "stale");
  assert.notEqual(stale.data, null);
});

test("initial failure has no cached value", async () => {
  const snapshot = await fixture();
  snapshot.panels.streams.data = null;
  snapshot.panels.streams.lastSuccessAt = null;
  const store = new SnapshotStore(snapshot.panels);
  store.recordFailure("streams", new Error("upstream unavailable"));
  const panel = store.snapshot("live").panels.streams;
  assert.equal(panel.status, "error");
  assert.equal(panel.data, null);
});

test("optional source can be disabled", async () => {
  const snapshot = await fixture();
  const store = new SnapshotStore(snapshot.panels);
  store.recordDisabled("backups", "Synthetic backup source is not configured");
  const panel = store.snapshot("live").panels.backups;
  assert.equal(panel.status, "disabled");
  assert.equal(panel.data, null);
});

test("secret-bearing failures are redacted", async () => {
  const snapshot = await fixture();
  snapshot.panels.streams.data = null;
  snapshot.panels.streams.lastSuccessAt = null;
  const store = new SnapshotStore(snapshot.panels);
  store.recordFailure("streams", new Error("Authorization=Bearer demo123 token=synthetic-secret from 198.51.100.42"));
  const message = store.snapshot("live").panels.streams.message ?? "";
  assert.doesNotMatch(message, /demo123|synthetic-secret|198\.51\.100\.42/);
  assert.match(message, /REDACTED/);
});
