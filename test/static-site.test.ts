import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { dashboardSnapshotSchema, demoStateSchema } from "../src/contracts/dashboard.js";
import { buildSite } from "../scripts/build-site.ts";

test("static export contains only public assets and deterministic, validated demo data", async () => {
  const output = await mkdtemp(join(tmpdir(), "hrafnholt-static-test-"));
  try {
    await buildSite(output);
    const bundle = JSON.parse(await readFile(join(output, "demo", "data.json"), "utf8"));
    assert.deepEqual(Object.keys(bundle.snapshots), demoStateSchema.options);
    for (const snapshot of Object.values(bundle.snapshots)) assert.equal(dashboardSnapshotSchema.parse(snapshot).mode, "fixture");
    assert.equal(bundle.configuration.branding.title, "Hrafnholt");
    assert.equal(bundle.snapshots.showcase.panels.movies.data.movies.length, 16);
    const html = await readFile(join(output, "demo", "index.html"), "utf8");
    assert.match(html, /data-static-demo="true"/);
    assert.doesNotMatch(html, /(?:src|href)="\/assets\//);
    assert.ok((await readdir(output)).includes("index.html"));
    assert.ok(!(await readdir(output)).includes("src"));
    assert.ok(!(await readdir(output)).includes("node_modules"));
    const first = await readFile(join(output, "demo", "data.json"), "utf8");
    await buildSite(output);
    assert.equal(await readFile(join(output, "demo", "data.json"), "utf8"), first);
  } finally { await rm(output, { recursive: true, force: true }); }
});
