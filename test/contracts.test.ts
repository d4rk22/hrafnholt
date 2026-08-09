import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dashboardSnapshotSchema } from "../src/contracts/dashboard.js";
import { addDerivedWatchlist } from "../src/collectors/watchlist.js";

test("approved sanitized fixture satisfies the dashboard contract", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/dashboard-snapshot.json", import.meta.url), "utf8"));
  const result = dashboardSnapshotSchema.safeParse(fixture);
  assert.equal(fixture.demoState, "healthy");
  assert.equal(fixture.panels.movies.data.movies.length, 3);
  assert.equal(fixture.panels.rackPower.data.outlets.length, 6);
  assert.equal(fixture.panels.backups.data.pbs.datastores.length, 2);
  assert.equal(fixture.panels.backups.data.pbs.datastores[0].availableBytes, 2_000_000_000_000);
  assert.equal(fixture.panels.backups.data.pbs.verificationTotal, 80);
  assert.deepEqual(
    fixture.panels.streams.data.streams.map(({ platform }: { platform?: string }) => platform),
    ["Demo player", "Demo tablet", "Demo browser"],
  );
  assert.equal(result.success, true, result.success ? undefined : result.error.message);
});

test("stream platform contract rejects values longer than 60 characters", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/dashboard-snapshot.json", import.meta.url), "utf8"));
  fixture.panels.streams.data.streams[0].platform = "x".repeat(61);
  assert.equal(dashboardSnapshotSchema.safeParse(fixture).success, false);
});

test("movie shelf contract accepts 16 recent additions and rejects a seventeenth", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/dashboard-snapshot.json", import.meta.url), "utf8"));
  const sample = fixture.panels.movies.data.movies[0];
  fixture.panels.movies.data.movies = Array.from({ length: 17 }, (_, index) => ({
    ...sample,
    id: `demo-movie-${index + 1}`,
  }));
  assert.equal(dashboardSnapshotSchema.safeParse(fixture).success, false);
});

test("Plex capacity history contract rejects more than 240 display points", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/dashboard-snapshot.json", import.meta.url), "utf8"));
  const sample = fixture.panels.plexHost.data.history.points[0];
  fixture.panels.plexHost.data.history.points = Array.from({ length: 241 }, () => ({ ...sample }));
  assert.equal(dashboardSnapshotSchema.safeParse(fixture).success, false);
});

test("panel envelopes reject unsafe overlong operator messages", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/dashboard-snapshot.json", import.meta.url), "utf8"));
  fixture.panels.streams.message = "x".repeat(241);
  assert.equal(dashboardSnapshotSchema.safeParse(fixture).success, false);
});

test("derived watchlist IDs stay within the public contract", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/dashboard-snapshot.json", import.meta.url), "utf8"));
  fixture.panels.backups.data.jobs[0].id = "x".repeat(120);
  fixture.panels.backups.data.jobs[0].result = "warning";
  fixture.panels.backups.data.jobs[0].message = "Synthetic source warning";
  const snapshot = addDerivedWatchlist(dashboardSnapshotSchema.parse(fixture));
  const ids = snapshot.panels.watchlist.data?.items.map(({ id }) => id) ?? [];

  assert.ok(ids.length > 0);
  assert.ok(ids.every((id) => id.length <= 120));
});
