import assert from "node:assert/strict";
import { test } from "node:test";
import { createDashboardSource } from "../public/data-source.js";

test("static demo reads one bundled file, preserves scenarios, and filters the calendar locally", async () => {
  const requests: string[] = [];
  const data = { configuration: { branding: { title: "Demo" } }, snapshots: {
    showcase: { mode: "fixture", panels: { episodes: { data: { localDate: "2030-01-15", episodes: [{ id: "sample" }] } } } },
    empty: { mode: "fixture", panels: { episodes: { data: null } } },
  } };
  const source = createDashboardSource({ staticDataUrl: "https://demo.example/demo/data.json", fetcher: async (url: string) => {
    requests.push(url); return new Response(JSON.stringify(data));
  } });
  assert.equal(source.isStatic, true);
  assert.deepEqual(await source.configuration(), data.configuration);
  assert.deepEqual(await source.snapshot(), data.snapshots.showcase);
  assert.deepEqual(await source.episodes("2030-01-15"), data.snapshots.showcase.panels.episodes.data);
  assert.deepEqual(await source.episodes("2030-01-16"), { localDate: "2030-01-16", episodes: [] });
  assert.deepEqual(await source.episodes("2030-01-15", "empty"), { localDate: "2030-01-15", episodes: [] });
  await assert.rejects(source.snapshot("constructor"), /Unknown demo/);
  assert.deepEqual(requests, ["https://demo.example/demo/data.json"]);
});

test("normal dashboard keeps its API requests and propagates demo calendar selection", async () => {
  const requests: string[] = [];
  const source = createDashboardSource({ fetcher: async (url: string) => { requests.push(url); return new Response("{}"); } });
  assert.equal(source.isStatic, false);
  await source.configuration();
  await source.snapshot();
  await source.snapshot("showcase");
  await source.episodes("2030-01-15", "showcase");
  assert.deepEqual(requests, ["/api/v1/configuration", "/api/v1/dashboard", "/api/v1/dashboard?demo=showcase", "/api/v1/episodes?date=2030-01-15&demo=showcase"]);
});

test("a failed static download can be retried without keeping a rejected cache", async () => {
  let calls = 0;
  const source = createDashboardSource({ staticDataUrl: "data.json", fetcher: async () => {
    calls += 1;
    return calls === 1 ? new Response("", { status: 503 }) : new Response('{"configuration":{"ok":true}}');
  } });
  await assert.rejects(source.configuration(), /503/);
  assert.deepEqual(await source.configuration(), { ok: true });
});
