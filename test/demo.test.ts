import assert from "node:assert/strict";
import { test } from "node:test";
import type { DemoState } from "../src/contracts/dashboard.js";
import { buildServer } from "../src/server.js";

const states: DemoState[] = [
  "healthy",
  "empty",
  "stale",
  "degraded",
  "collector-failure",
  "privacy",
];

function demoConfiguration(state: DemoState, allowPrivateToggle = false): string {
  return `
schema_version: 1
mode: demo
demo:
  state: ${state}
server:
  log_level: silent
presentation:
  privacy:
    default_mode: public
    allow_private_toggle: ${allowPrivateToggle}
collectors: []
`;
}

for (const state of states) {
  test(`demo state ${state} serves a deterministic normalized snapshot and healthy process`, async () => {
    const environment = new Proxy<Record<string, string>>({}, {
      get: () => { throw new Error("Demo mode attempted to read the credential environment"); },
      has: () => { throw new Error("Demo mode attempted to inspect the credential environment"); },
    });
    const { app, config } = await buildServer(environment, { configurationText: demoConfiguration(state, state === "privacy") });
    const live = await app.inject({ method: "GET", url: "/health/live" });
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    const first = await app.inject({ method: "GET", url: "/api/v1/dashboard" });
    const second = await app.inject({ method: "GET", url: "/api/v1/dashboard" });
    const snapshot = first.json();

    assert.equal(config.secrets.size, 0);
    assert.equal(live.statusCode, 200);
    assert.deepEqual(live.json(), { status: "ok" });
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), {
      ready: true,
      attemptedCollectors: 0,
      requiredCollectors: 0,
      mode: "fixture",
      configurationErrors: [],
    });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), second.json());
    assert.equal(snapshot.generatedAt, "2030-01-15T12:00:00.000Z");
    assert.equal(snapshot.demoState, state);
    await app.close();
  });
}

test("demo state matrix has directly responsible healthy, empty, stale, degraded, failure, and privacy semantics", async () => {
  const snapshots = new Map<DemoState, any>();
  for (const state of states) {
    const { app } = await buildServer({}, { configurationText: demoConfiguration(state, state === "privacy") });
    snapshots.set(state, (await app.inject({ method: "GET", url: "/api/v1/dashboard" })).json());
    await app.close();
  }

  assert.ok(Object.values(snapshots.get("healthy").panels).every((panel: any) => panel.status === "ok"));
  assert.ok(Object.values(snapshots.get("empty").panels).every((panel: any) => panel.status === "disabled" && panel.data === null));
  assert.ok(Object.values(snapshots.get("stale").panels).every((panel: any) => panel.status === "stale" && panel.data !== null));
  assert.equal(snapshots.get("degraded").panels.power.status, "stale");
  assert.equal(snapshots.get("degraded").panels.backups.data.pbs.status, "degraded");
  assert.equal(snapshots.get("degraded").panels.servicePosture.data.down, 1);
  assert.equal(snapshots.get("collector-failure").panels.sabQueues.status, "error");
  assert.equal(snapshots.get("collector-failure").panels.sabQueues.data, null);
  assert.equal(snapshots.get("collector-failure").panels.streams.status, "ok");
  assert.deepEqual(
    snapshots.get("privacy").panels.streams.data.streams.map(({ user }: { user: string }) => user),
    ["demo-viewer-alpha", "demo-viewer-beta", "demo-viewer-gamma"],
  );
});

test("one demo runtime can select every bounded scenario while live mode rejects overrides", async () => {
  const { app } = await buildServer({}, { configurationText: demoConfiguration("healthy") });
  for (const state of states) {
    const response = await app.inject({ method: "GET", url: `/api/v1/dashboard?demo=${state}` });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().demoState, state);
  }
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/dashboard?demo=production" })).statusCode, 400);
  await app.close();

  const live = await buildServer({}, { configurationText: `
schema_version: 1
mode: live
server:
  log_level: silent
collectors: []
` });
  assert.equal((await live.app.inject({ method: "GET", url: "/api/v1/dashboard?demo=healthy" })).statusCode, 400);
  await live.app.close();
});
