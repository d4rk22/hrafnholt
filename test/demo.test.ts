import assert from "node:assert/strict";
import { test } from "node:test";
import type { DemoState } from "../src/contracts/dashboard.js";
import { buildServer } from "../src/server.js";
import { dashboardSnapshotSchema } from "../src/contracts/dashboard.js";

const states: DemoState[] = [
  "healthy",
  "showcase",
  "empty",
  "stale",
  "degraded",
  "collector-failure",
  "privacy",
];

test("showcase serves populated, internally consistent synthetic data and local poster art", async () => {
  const { app } = await buildServer({}, { configurationText: demoConfiguration("healthy") });
  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/dashboard?demo=showcase" });
    assert.equal(response.statusCode, 200);
    const snapshot = dashboardSnapshotSchema.parse(response.json());
    const p = snapshot.panels;
    assert.equal(snapshot.mode, "fixture");
    assert.equal(snapshot.demoState, "showcase");
    assert.deepEqual(response.json(), (await app.inject({ method: "GET", url: "/api/v1/dashboard?demo=showcase" })).json());
    assert.ok(p.episodes.data!.episodes.length >= 16);
    assert.equal(p.movies.data!.movies.length, 16);
    assert.ok(p.arcane.data!.total >= 32);
    assert.equal(p.arcane.data!.total, p.arcane.data!.environments.flatMap(e => e.containers).length);
    const streams = p.streams.data!;
    assert.equal(streams.total, streams.streams.length);
    assert.equal(streams.transcodes, streams.streams.filter(s => s.playbackMode === "transcode").length);
    assert.equal(streams.totalBitrateMbps, streams.streams.reduce((sum, s) => sum + s.bitrateMbps, 0));
    const power = p.power.data!;
    assert.equal(power.totalWatts, power.serverWatts + power.acWatts);
    assert.equal(power.monthKwh, power.serverMonthKwh + power.acMonthKwh);
    assert.equal(power.monthCost, power.monthKwh * power.rate);
    assert.ok(power.topConsumers.reduce((sum, c) => sum + c.kwh, 0) <= power.houseTodayKwh);
    assert.equal(p.rackPower.data!.currentWatts, p.rackPower.data!.outlets.reduce((sum, o) => sum + o.watts, 0));
    for (const history of Object.values(p.plexHost.data!.history!.windows)) {
      assert.ok(history!.points.length >= 200);
      assert.equal(history!.points.at(0)!.sampledAt, history!.sampledFrom);
      assert.equal(history!.points.at(-1)!.sampledAt, history!.sampledTo);
      assert.ok(new Set(history!.points.map(point => point.cpuPercent)).size > 50);
      assert.equal(history!.summary.ramPeakPercent, Math.max(...history!.points.map(point => point.ramPercent)));
      assert.ok(history!.points.every(point => point.videoTranscodePeak! <= point.streamPeak!));
    }
    for (const movie of p.movies.data!.movies) {
      assert.match(movie.posterUrl!, /^\/assets\/demo-posters\/\d+\.svg$/);
      const poster = await app.inject({ method: "GET", url: movie.posterUrl! });
      assert.equal(poster.statusCode, 200);
      assert.match(poster.headers["content-type"]!, /image\/svg\+xml/);
      assert.ok(poster.body.includes(movie.title));
      assert.doesNotMatch(poster.body, /<(?:script|image|foreignObject)\b|(?:href|src)=/i);
    }
  } finally {
    await app.close();
  }
});

test("showcase configuration keeps the calendar and synthetic CPU association consistent", async () => {
  const { app } = await buildServer({}, { configurationText: demoConfiguration("showcase") });
  try {
    const snapshot = (await app.inject({ method: "GET", url: "/api/v1/dashboard" })).json();
    const calendar = (await app.inject({ method: "GET", url: "/api/v1/episodes?date=2030-01-15" })).json();
    const config = (await app.inject({ method: "GET", url: "/api/v1/configuration" })).json();
    assert.deepEqual(calendar, snapshot.panels.episodes.data);
    assert.ok(snapshot.panels.proxmox.data.nodes.some((node: { name: string }) => node.name === config.associations.plex_host_proxmox_node));
  } finally { await app.close(); }
});

test("query-selected showcase survives calendar navigation and stays unavailable in live mode", async () => {
  const { app } = await buildServer({}, { configurationText: demoConfiguration("healthy") });
  try {
    const snapshot = (await app.inject({ method: "GET", url: "/api/v1/dashboard?demo=showcase" })).json();
    const otherDay = await app.inject({ method: "GET", url: "/api/v1/episodes?date=2030-01-16&demo=showcase" });
    assert.equal(otherDay.statusCode, 200);
    assert.deepEqual(otherDay.json().episodes, []);
    const today = await app.inject({ method: "GET", url: "/api/v1/episodes?date=2030-01-15&demo=showcase" });
    assert.equal(today.statusCode, 200);
    assert.deepEqual(today.json(), snapshot.panels.episodes.data);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/episodes?date=2030-01-15&demo=invalid" })).statusCode, 400);
  } finally { await app.close(); }
  const live = await buildServer({}, { configurationText: "schema_version: 1\nmode: live\nserver:\n  log_level: silent\ncollectors: []\n" });
  try {
    assert.equal((await live.app.inject({ method: "GET", url: "/api/v1/episodes?date=2030-01-15&demo=showcase" })).statusCode, 400);
  } finally { await live.app.close(); }
});

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
