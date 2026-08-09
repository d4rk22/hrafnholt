import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { CollectorScheduler } from "../../src/cache/scheduler.js";
import { SnapshotStore } from "../../src/cache/snapshot-store.js";
import { createTracearrCollector } from "../../src/collectors/tracearr.js";
import { dashboardSnapshotSchema } from "../../src/contracts/dashboard.js";

test("unauthorized collector failure cannot expose bearer token or erase other panels", async () => {
  const raw = JSON.parse(await readFile(new URL("../../fixtures/dashboard-snapshot.json", import.meta.url), "utf8"));
  const fixture = dashboardSnapshotSchema.parse(raw);
  fixture.panels.streams.data = null;
  fixture.panels.streams.lastSuccessAt = null;
  const store = new SnapshotStore(fixture.panels);
  const collector = createTracearrCollector({
    baseUrl: "https://tracearr.invalid",
    token: "super-secret-token",
    request: async () => { throw new Error("HTTP 401 Authorization: Bearer super-secret-token"); },
  });
  const scheduler = new CollectorScheduler([collector], store);
  assert.equal(await scheduler.runOnce(collector), false);
  const snapshot = store.snapshot("live");
  assert.equal(snapshot.panels.streams.status, "error");
  assert.doesNotMatch(snapshot.panels.streams.message ?? "", /super-secret-token/);
  assert.notEqual(snapshot.panels.bandwidth.status, "error");
  assert.notEqual(snapshot.panels.bandwidth.data, null);
});
