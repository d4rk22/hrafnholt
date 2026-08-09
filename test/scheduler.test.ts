import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { CollectorScheduler, type SchedulerClock } from "../src/cache/scheduler.js";
import { SnapshotStore } from "../src/cache/snapshot-store.js";
import type { Collector } from "../src/collectors/collector.js";
import { bandwidthDataSchema, dashboardSnapshotSchema } from "../src/contracts/dashboard.js";

async function setup() {
  const raw = JSON.parse(await readFile(new URL("../fixtures/dashboard-snapshot.json", import.meta.url), "utf8"));
  const snapshot = dashboardSnapshotSchema.parse(raw);
  let now = Date.parse("2030-01-15T12:00:00.000Z");
  let nextTimer = 1;
  const callbacks = new Map<number, () => void>();
  const clock: SchedulerClock = {
    now: () => now,
    setTimeout: (callback) => {
      const id = nextTimer++;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout: (timer) => callbacks.delete(timer as number),
    random: () => 0,
  };
  const store = new SnapshotStore(snapshot.panels, { now: () => now });
  return {
    snapshot,
    store,
    clock,
    callbacks,
    advance: (milliseconds: number) => { now += milliseconds; },
  };
}

function bandwidthCollector(collect: Collector<"bandwidth">["collect"]): Collector<"bandwidth"> {
  return {
    name: "test bandwidth",
    panel: "bandwidth",
    source: "test",
    intervalMs: 5_000,
    timeoutMs: 3_000,
    staleAfterMs: 20_000,
    required: true,
    enabled: true,
    schema: bandwidthDataSchema,
    collect,
  };
}

test("scheduler prevents overlapping runs", async () => {
  const { snapshot, store, clock } = await setup();
  let resolve!: (value: NonNullable<typeof snapshot.panels.bandwidth.data>) => void;
  const collector = bandwidthCollector(() => new Promise((done) => { resolve = done; }));
  const scheduler = new CollectorScheduler([collector], store, clock);
  const first = scheduler.runOnce(collector);
  const second = await scheduler.runOnce(collector);
  assert.equal(second, false);
  resolve(snapshot.panels.bandwidth.data!);
  assert.equal(await first, true);
});

test("scheduler aborts a bounded timeout and preserves last good data", async () => {
  const { store, clock, callbacks, advance } = await setup();
  const collector = bandwidthCollector(({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const scheduler = new CollectorScheduler([collector], store, clock);
  const run = scheduler.runOnce(collector);
  advance(3_000);
  for (const callback of [...callbacks.values()]) callback();
  assert.equal(await run, false);
  assert.notEqual(store.snapshot("live").panels.bandwidth.data, null);
});

test("disabled collector is attempted without calling collect", async () => {
  const { store, clock } = await setup();
  let calls = 0;
  const collector = { ...bandwidthCollector(async () => { calls += 1; throw new Error("unexpected"); }), enabled: false, required: false };
  const scheduler = new CollectorScheduler([collector], store, clock);
  assert.equal(await scheduler.runOnce(collector), false);
  assert.equal(calls, 0);
  assert.equal(store.snapshot("live").panels.bandwidth.status, "disabled");
});

test("three simultaneous source failures leave unrelated panels usable", async () => {
  const { snapshot, store, clock } = await setup();
  const failed = ["bandwidth", "streams", "ups"] as const;
  const collectors = failed.map((panel) => ({
    name: `failed ${panel}`,
    panel,
    source: `test ${panel}`,
    intervalMs: 5_000,
    timeoutMs: 3_000,
    staleAfterMs: 20_000,
    required: true,
    enabled: true,
    schema: panel === "bandwidth" ? bandwidthDataSchema : ({ parse: (value: unknown) => value } as typeof bandwidthDataSchema),
    collect: async () => { throw new Error(`${panel} unavailable`); },
  })) as Collector[];
  snapshot.panels.streams.data = null;
  snapshot.panels.streams.lastSuccessAt = null;
  snapshot.panels.ups.data = null;
  snapshot.panels.ups.lastSuccessAt = null;
  const isolatedStore = new SnapshotStore(snapshot.panels, { now: clock.now });
  const scheduler = new CollectorScheduler(collectors, isolatedStore, clock);
  await Promise.all(collectors.map((collector) => scheduler.runOnce(collector)));
  const result = isolatedStore.snapshot("live");
  assert.equal(result.panels.streams.status, "error");
  assert.equal(result.panels.ups.status, "error");
  assert.notEqual(result.panels.movies.data, null);
  assert.notEqual(result.panels.arcane.data, null);
  assert.notEqual(result.panels.proxmox.data, null);
});
