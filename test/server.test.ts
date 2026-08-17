import assert from "node:assert/strict";
import { test } from "node:test";
import { buildServer } from "../src/server.js";

const demoConfiguration = `
schema_version: 1
mode: demo
server:
  log_level: silent
presentation:
  branding:
    title: Test Ravenhill
    subtitle: Synthetic dashboard
    home_label: Test Home
  locale: en-GB
  timezone: Europe/London
  home: null
  privacy:
    default_mode: public
    allow_private_toggle: false
collectors: []
`;

test("fixture mode serves health and the versioned snapshot", async () => {
  const { app } = await buildServer({}, { configurationText: demoConfiguration });
  const live = await app.inject({ method: "GET", url: "/health/live" });
  const ready = await app.inject({ method: "GET", url: "/health/ready" });
  const dashboard = await app.inject({ method: "GET", url: "/api/v1/dashboard" });
  const episodes = await app.inject({ method: "GET", url: "/api/v1/episodes?date=2030-01-15" });
  const invalidEpisodes = await app.inject({ method: "GET", url: "/api/v1/episodes?date=not-a-date" });
  const index = await app.inject({ method: "GET", url: "/" });
  const styles = await app.inject({ method: "GET", url: "/styles.css" });
  const client = await app.inject({ method: "GET", url: "/app.js" });
  const privacyMode = await app.inject({ method: "GET", url: "/privacy-mode.js" });
  const configuration = await app.inject({ method: "GET", url: "/api/v1/configuration" });
  assert.equal(live.statusCode, 200);
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.json(), {
    ready: true,
    attemptedCollectors: 0,
    requiredCollectors: 0,
    mode: "fixture",
    configurationErrors: [],
  });
  assert.equal(dashboard.statusCode, 200);
  assert.equal(dashboard.json().schemaVersion, "1.0.0");
  assert.equal(dashboard.json().mode, "fixture");
  assert.equal(dashboard.json().demoState, "healthy");
  assert.equal(episodes.statusCode, 200);
  assert.equal(episodes.json().localDate, "2030-01-15");
  assert.equal(episodes.json().episodes.length, 2);
  assert.equal(invalidEpisodes.statusCode, 400);
  assert.equal(index.statusCode, 200);
  assert.match(index.body, /id="brand-name">Ravenhill/);
  assert.match(index.body, /Energy ledger/);
  assert.match(index.body, /Rack energy ledger/);
  assert.match(index.body, /Today’s episodes/);
  assert.match(index.body, /id="episodes-previous-day"/);
  assert.match(index.body, /id="episodes-next-day"/);
  assert.match(index.body, /id="privacy-mode-status"/);
  assert.match(index.body, /aria-keyshortcuts="Shift\+P"/);
  assert.match(index.body, /id="privacy-mode-announcement"[^>]+aria-live="polite"/);
  assert.match(index.body, /RADARR INSTANCES/);
  assert.match(index.body, /Recently added movies/);
  assert.doesNotMatch(index.body, /both libraries/i);
  assert.match(index.body, /direct-play-count/);
  assert.doesNotMatch(index.body, /map-home-tag/);
  assert.doesNotMatch(index.body, /<g class="map-city-label">.*?<circle/);
  assert.doesNotMatch(index.body, /TRACEARR PRIMARY/);
  assert.match(index.body, /gpu-tensor-cores/);
  assert.match(index.body, /Capacity headroom/);
  assert.match(index.body, /id="capacity-chart"/);
  assert.match(index.body, /id="capacity-encode-p95"/);
  assert.match(index.body, /Protection status/);
  assert.match(index.body, /id="pbs-vault"/);
  assert.equal(styles.statusCode, 200);
  assert.doesNotMatch(styles.body, /font-size:\s*[678]px/);
  assert.equal(client.statusCode, 200);
  assert.equal(privacyMode.statusCode, 200);
  assert.equal(configuration.statusCode, 200);
  assert.deepEqual(configuration.json(), {
    schemaVersion: "1.0.0",
    branding: { title: "Test Ravenhill", subtitle: "Synthetic dashboard", home_label: "Test Home" },
    locale: "en-GB",
    timezone: "Europe/London",
    currency: "USD",
    home: null,
    privacy: { default_mode: "public", allow_private_toggle: false, aliases: [] },
    units: { temperature: "celsius" },
    associations: { plex_host_proxmox_node: null },
  });
  assert.match(privacyMode.body, /export const PRIVACY_ALIASES/);
  assert.match(client.body, /from "\.\/privacy-mode\.js"/);
  assert.match(client.body, /displayedPlexUsername\(stream\.user, privacyMode, privacyAliasRegistry\)/);
  assert.match(client.body, /privacyModeKeyAction\(event\)/);
  assert.match(client.body, /let privacyMode = "public"/);
  assert.match(client.body, /fetch\("\/api\/v1\/configuration"/);
  assert.match(client.body, /presentation\.timezone/);
  assert.match(client.body, /class="stream-meta"/);
  assert.match(client.body, /stream\.platform\s*\?/);
  assert.match(client.body, /class="stream-platform"[^\n]+escapeHtml\(stream\.platform\)/);
  assert.doesNotMatch(client.body, /stream\.(?:device|player|product)/);
  assert.match(styles.body, /\.stream-meta\s*\{[^}]*align-items:\s*flex-end/);
  assert.match(styles.body, /\.stream-platform\s*\{[^}]*font-size:\s*9px/);
  assert.match(styles.body, /\.privacy-mode-status\s*\{/);
  assert.match(styles.body, /\.privacy-mode-status\[data-mode="private"\]/);
  assert.doesNotMatch(client.body, /label\.innerHTML\s*=\s*"[^"]*<circle/);
  assert.match(client.body, /new URLSearchParams\(window\.location\.search\)\.get\("demo"\)/);
  assert.match(client.body, /fetch\(dashboardUrl/);
  assert.match(client.body, /SYNTHETIC DEMO/);
  assert.match(client.body, /syntheticClock = snapshot\.mode === "fixture"[^\n]+\n\s+updateClock\(\)/);
  assert.match(client.body, /setText\("#rack-draw", power\.data \? number\(power\.data\.serverWatts \/ 1000, 2\) : "—"\)/);
  assert.match(client.body, /setText\("#rack-today", power\.data \? number\(power\.data\.serverTodayKwh, 1\) : "—"\)/);
  assert.doesNotMatch(client.body, /setText\("#rack-(?:draw|today)"[^\n]+power\.data\.(?:totalWatts|todayKwh)/);
  assert.match(index.body, /Rack draw<\/span><span class="data-source" id="power-source">Not configured<\/span>/);
  assert.match(client.body, /setText\("#power-source", power\.source\)/);
  assert.match(client.body, /\/api\/v1\/episodes\?date=/);
  assert.match(client.body, /function navigateEpisodes\(days\)/);
  assert.match(styles.body, /\.calendar-navigation\s*\{/);
  assert.match(client.body, /panel\.data\.movies\.map/);
  assert.doesNotMatch(client.body, /panel\.data\.movies\.slice\(0,\s*4\)/);
  assert.match(client.body, /environments\.flatMap\(\(environment\) => environment\.containers\)\.map/);
  assert.doesNotMatch(client.body, /environments\.flatMap\([^\n]+\.slice\(/);
  assert.doesNotMatch(client.body, /movie\.library\.toUpperCase/);
  assert.match(client.body, /movie-info[^\n]+movie\.year[^\n]+<strong>\$\{escapeHtml\(movie\.title\)\}/);
  assert.match(styles.body, /\.movie-card:nth-child\(n \+ 5\)\s*\{\s*display:\s*none/);
  assert.match(styles.body, /\.movie-format[^}]*backdrop-filter:\s*blur\(7px\)/);
  assert.match(client.body, /2 \*\* 40/);
  assert.match(client.body, /2 \*\* 30/);
  assert.match(client.body, /Remaining \$\{remainder\.length\} outlets/);
  assert.match(client.body, /labelNode\.toggleAttribute\("hidden", Boolean\(!group \|\| position\?\.hidden\)\)/);
  assert.doesNotMatch(client.body, /labelNode\.hidden =/);
  assert.match(index.body, /class="route-pulse"/);
  assert.match(client.body, /querySelectorAll\("\.route-pulse"\)/);
  assert.match(client.body, /pulse\?\.setAttribute\("d", path\)/);
  assert.match(styles.body, /\.route\s*\{[^}]*stroke-dasharray:\s*none/);
  assert.match(styles.body, /\.route-pulse\s*\{[^}]*stroke-dasharray:\s*2\.2 32/);
  assert.doesNotMatch(styles.body, /@keyframes route-flow/);
  assert.doesNotMatch(client.body, /Other metered outlets/);
  assert.match(client.body, /data\.rolling24hAverageWatts \/ 1_000 \* 24 \* 30/);
  assert.doesNotMatch(client.body, /data\.currentWatts \/ 1_000 \* 24 \* 30/);
  assert.match(client.body, /<span>Share<\/span><span>Est<\/span><span>Now<\/span>/);
  assert.match(client.body, /estimatedCost \* share \/ 100/);
  assert.match(styles.body, /\.rack-load-row > \.rack-load-est[^}]*color:\s*var\(--amber\)/);
  assert.match(client.body, /<span>Incremental size<\/span>/);
  assert.match(client.body, /backupDuration\(job\.durationSeconds\)/);
  assert.match(client.body, /dataSize\(job\.transferredBytes\)/);
  assert.match(client.body, /function renderPbsVault\(pbs, mode\)/);
  assert.match(client.body, /datastore\.availableBytes/);
  assert.match(client.body, /\$\{escapeHtml\(tebibytes\(datastore\.availableBytes\)\)\} free/);
  assert.doesNotMatch(client.body, /datastore\.totalBytes - datastore\.usedBytes/);
  assert.match(client.body, /renderPlexCapacity\(panel\)/);
  assert.match(client.body, /history\.analysisSamples/);
  assert.match(index.body, /capacity-chart__line--decode/);
  assert.match(index.body, /Peak 30-min GPU temp/);
  assert.match(client.body, /summary\.decodeP95Percent/);
  assert.match(index.body, /id="capacity-workload-chart"/);
  assert.match(index.body, /capacity-workload__line--streams/);
  assert.match(index.body, /capacity-workload__line--video-transcodes/);
  assert.doesNotMatch(index.body, /capacity-workload-state/);
  assert.match(index.body, /id="capacity-updated"/);
  assert.match(client.body, /Streams avg/);
  assert.match(client.body, /Video transcodes avg/);
  assert.match(client.body, /point\.sample\.streamPeak/);
  assert.match(client.body, /point\.sample\.videoTranscodePeak/);
  assert.match(client.body, /removeAttribute\("title"\)/);
  assert.match(client.body, /half-hour samples/);
  assert.doesNotMatch(client.body, /source buckets/);
  assert.match(client.body, /function restoreCapacityFocusAfterRender\(\)/);
  assert.match(client.body, /capacityPointerRatio !== null/);
  assert.match(client.body, /restoreCapacityFocusAfterRender\(\);/);
  assert.match(index.body, /id="rack-power-method"/);
  assert.match(styles.body, /\.rack-load-bar i[^}]*background:\s*var\(--blue\)/);
  assert.doesNotMatch(styles.body, /\.rack-load-row:nth-child\([^)]*\) \.rack-load-bar i/);
  assert.match(styles.body, /\.capacity-chart__pressure-zone/);
  assert.match(styles.body, /\.dashboard-grid\[data-view="compute"\] \.panel--plex-capacity/);
  await app.close();
});

test("live mode with no configured collectors is ready and exposes disabled panels", async () => {
  const { app } = await buildServer({}, { configurationText: `
schema_version: 1
mode: live
server:
  log_level: silent
collectors: []
` });
  const ready = await app.inject({ method: "GET", url: "/health/ready" });
  const dashboard = await app.inject({ method: "GET", url: "/api/v1/dashboard" });
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.json(), {
    ready: true,
    attemptedCollectors: 0,
    requiredCollectors: 0,
    mode: "live",
    configurationErrors: [],
  });
  assert.equal(dashboard.json().panels.streams.status, "disabled");
  assert.equal(dashboard.json().demoState, null);
  assert.equal(dashboard.json().panels.streams.source, "Not configured");
  assert.equal(dashboard.json().panels.streams.data, null);
  await app.close();
});

test("an explicitly configured live collector fails startup when its secret is absent", async () => {
  await assert.rejects(() => buildServer({}, { configurationText: `
schema_version: 1
mode: live
collectors:
  - type: radarr
    id: movies
    name: Movies
    url: https://movies.example
    api_key_ref: MOVIE_KEY
` }), /Secret MOVIE_KEY is required but is not configured/);
});
