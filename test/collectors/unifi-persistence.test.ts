import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadPersistedPowerSamples, persistPowerSamples, type PowerSample } from "../../src/collectors/unifi.js";

test("UniFi PDU sample state survives reload with bounded non-secret content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ravenhill-demo-rack-power-"));
  const statePath = join(directory, "rack-power-samples.json");
  const now = new Date("2030-01-10T12:00:00.000Z");
  const samples: PowerSample[] = [
    { sampledAt: Date.parse("2030-01-10T10:00:00.000Z"), watts: 600 },
    { sampledAt: Date.parse("2030-01-10T11:00:00.000Z"), watts: 640 },
  ];

  await persistPowerSamples(statePath, samples);
  assert.deepEqual(await loadPersistedPowerSamples(statePath, now), samples);
  assert.equal((await stat(statePath)).mode & 0o777, 0o600);
  const raw = await readFile(statePath, "utf8");
  assert.match(raw, /^\{"version":1,"samples":\[/);
  assert.doesNotMatch(raw, /password|token|outlet|mac/i);

  await writeFile(statePath, "not-json", "utf8");
  assert.deepEqual(await loadPersistedPowerSamples(statePath, now), []);
});

test("UniFi PDU persistence drops stale, future, invalid, and excess samples", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ravenhill-demo-rack-power-bounds-"));
  const statePath = join(directory, "rack-power-samples.json");
  const now = new Date("2030-01-10T12:00:00.000Z");
  const recent = Array.from({ length: 3_010 }, (_, index) => ({
    sampledAt: now.getTime() - (3_010 - index) * 1_000,
    watts: 900 + index / 10,
  }));
  await writeFile(statePath, JSON.stringify({ version: 1, samples: [
    { sampledAt: now.getTime() - 25 * 60 * 60 * 1_000, watts: 800 },
    ...recent,
    { sampledAt: now.getTime() + 1, watts: 1_000 },
    { sampledAt: now.getTime(), watts: -1 },
  ] }), "utf8");

  const loaded = await loadPersistedPowerSamples(statePath, now);
  assert.equal(loaded.length, 3_000);
  assert.ok(loaded.every((sample) => sample.sampledAt <= now.getTime() && sample.watts >= 0));
});
