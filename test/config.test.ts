import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { loadConfig, parseConfigDocument, hrafnholtConfigSchema } from "../src/config.js";
import { createCollectorRuntime } from "../src/collectors/index.js";
import { publicConfiguration } from "../src/routes/configuration.js";

const demoConfiguration = `
schema_version: 1
mode: demo
collectors: []
`;

const liveConfiguration = `
schema_version: 1
mode: live
presentation:
  branding:
    title: Hrafnholt Test
    subtitle: Synthetic test dashboard
    home_label: Test Home
  locale: en-GB
  timezone: Europe/London
  home: null
  privacy:
    default_mode: public
    allow_private_toggle: false
collectors:
  - type: sonarr
    id: television
    name: Television
    url: https://television.example
    api_key_ref: SHARED_MEDIA_KEY
  - type: sonarr
    id: animation
    name: Animation
    url: https://animation.example
    api_key_ref: SHARED_MEDIA_KEY
  - type: radarr
    id: movies
    name: Movies
    url: https://movies.example
    api_key_ref: MOVIE_KEY
  - type: radarr
    id: documentaries
    name: Documentaries
    url: https://documentaries.example
    api_key_ref: DOCUMENTARY_KEY
  - type: sabnzbd
    id: primary-downloads
    name: Primary downloads
    url: https://sab.example
    api_key_ref: SAB_KEY
  - type: qbittorrent
    id: archive-downloads
    name: Archive downloads
    url: https://qbittorrent.example
    username_ref: QBITTORRENT_USER
    password_ref: QBITTORRENT_PASSWORD
`;

test("example configuration is versioned, typed, and safely defaults to demo mode", async () => {
  const example = await readFile(new URL("../hrafnholt.example.yml", import.meta.url), "utf8");
  const config = parseConfigDocument(example);
  const dashboardConfig = loadConfig({}, { configurationText: example });

  assert.equal(config.schema_version, 1);
  assert.equal(config.mode, "demo");
  assert.equal(config.demo.state, "healthy");
  assert.deepEqual(config.collectors, []);
  assert.equal(config.presentation.timezone, "UTC");
  assert.equal(config.presentation.home, null);
  assert.equal(config.presentation.privacy.default_mode, "public");
  assert.equal(config.presentation.privacy.allow_private_toggle, false);
  assert.deepEqual(config.presentation.privacy.aliases, []);
  assert.equal(config.presentation.units.temperature, "celsius");
  assert.equal(config.energy?.rates.seasons.flatMap(({ months }) => months).length, 12);
  assert.equal(dashboardConfig.secrets.size, 0);
});

test("privacy aliases accept a bounded unique roster and reject weak ones", () => {
  const withAliases = (aliases: string) => `
schema_version: 1
mode: demo
presentation:
  privacy:
    aliases: ${aliases}
collectors: []
`;

  const config = parseConfigDocument(withAliases("[Lyra, Orion, Vega]"));
  assert.deepEqual(config.presentation.privacy.aliases, ["Lyra", "Orion", "Vega"]);

  assert.throws(() => parseConfigDocument(withAliases("[Lonely]")), /at least two/);
  assert.throws(() => parseConfigDocument(withAliases("[Lyra, lyra]")), /unique ignoring case/);
  assert.throws(() => parseConfigDocument(withAliases(`[Lyra, "${"X".repeat(41)}"]`)));
});

test("demo mode refuses configured network collectors", () => {
  assert.throws(
    () => parseConfigDocument(`
schema_version: 1
mode: demo
collectors:
  - type: uptime_kuma
    id: status
    name: Status
    url: https://status.example
    status_page_slug: public
`),
    /collectors: must be empty in demo mode/,
  );
});

test("demo state selection is typed and rejects unknown scenarios", () => {
  assert.equal(parseConfigDocument(`
schema_version: 1
mode: demo
demo:
  state: collector-failure
collectors: []
`).demo.state, "collector-failure");
  assert.throws(() => parseConfigDocument(`
schema_version: 1
mode: demo
demo:
  state: production
collectors: []
`), /demo.state/);
});

test("collector base URLs reject embedded credential material", () => {
  for (const url of [
    "https://user:password@status.example",
    "https://status.example?token=synthetic",
    "https://status.example#token",
  ]) {
    assert.throws(() => parseConfigDocument(`
schema_version: 1
mode: live
collectors:
  - type: uptime_kuma
    id: status
    name: Status
    url: ${url}
    status_page_slug: public
`), /base URL without credentials, query, or fragment/);
  }
});

test("partial presentation settings retain neutral safe defaults", () => {
  const config = parseConfigDocument(`
schema_version: 1
mode: live
presentation:
  timezone: Pacific/Auckland
collectors: []
`);

  assert.equal(config.presentation.branding.title, "Hrafnholt");
  assert.equal(config.presentation.home, null);
  assert.equal(config.presentation.privacy.default_mode, "public");
  assert.equal(config.presentation.privacy.allow_private_toggle, false);
  assert.equal(config.presentation.units.temperature, "celsius");
});

test("energy device and channel selectors are strict in the shared schema", () => {
  const configuration = `
schema_version: 1
mode: demo
collectors: []
energy:
  provider: emporia
  username_ref: ENERGY_USERNAME
  password_ref: ENERGY_PASSWORD
  device_id: 12345
  channels:
    server: shared
    mains: shared
  rates:
    currency: USD
    tax_rate: 0
    fixed_monthly: 0
    seasons:
      - name: all year
        months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        price_per_kwh: 0.1
`;
  assert.throws(() => parseConfigDocument(configuration), /channel selectors must be unique/);
  assert.throws(
    () => parseConfigDocument(configuration.replace("device_id: 12345", "device_id: true").replace("mains: shared", "mains: mains")),
    /energy.device_id/,
  );
});

test("deployment selectors are explicit typed fields rather than compiled defaults", () => {
  const config = parseConfigDocument(`
schema_version: 1
mode: live
collectors:
  - type: proxmox
    id: compute
    name: Compute
    url: https://compute.example
    api_token_ref: COMPUTE_TOKEN
    storage_id: fast-storage
    exclude_nodes: [quorum-only]
    node_roles:
      compute-a: cluster anchor
`);
  const proxmox = config.collectors[0];
  assert.equal(proxmox?.type, "proxmox");
  if (proxmox?.type !== "proxmox") throw new Error("Expected Proxmox configuration");
  assert.deepEqual(proxmox.exclude_nodes, ["quorum-only"]);
  assert.deepEqual(proxmox.node_roles, { "compute-a": "cluster anchor" });

  assert.throws(() => parseConfigDocument(`
schema_version: 1
mode: live
collectors:
  - type: netdata
    id: telemetry
    name: Telemetry
    url: https://telemetry.example
`), /metrics/);
});

test("public presentation exposes configured units and only the safe host association", () => {
  const metricKeys = [
    "gpu_utilization", "encoder_utilization", "decoder_utilization", "vram_used",
    "vram_free", "temperature", "power", "cpu", "ram_used", "ram_free",
    "ram_cached", "ram_buffers",
  ];
  const document = hrafnholtConfigSchema.parse({
    schema_version: 1,
    mode: "live",
    presentation: { units: { temperature: "fahrenheit" } },
    collectors: [{
      type: "netdata",
      id: "telemetry",
      name: "Telemetry",
      url: "https://telemetry.example",
      proxmox_node: "compute-a",
      metrics: Object.fromEntries(metricKeys.map((key) => [key, { chart: `synthetic.${key}`, dimension: "value" }])),
    }],
  });

  const configuration = publicConfiguration(document);
  assert.deepEqual(configuration.units, { temperature: "fahrenheit" });
  assert.deepEqual(configuration.associations, { plex_host_proxmox_node: "compute-a" });
  assert.equal("collectors" in configuration, false);
});

test("live configuration builds arbitrary named media and download instances", () => {
  const config = loadConfig({
    SHARED_MEDIA_KEY: "synthetic-shared",
    MOVIE_KEY: "synthetic-movie",
    DOCUMENTARY_KEY: "synthetic-documentary",
    SAB_KEY: "synthetic-sab",
    QBITTORRENT_USER: "synthetic-user",
    QBITTORRENT_PASSWORD: "synthetic-password",
  }, { configurationText: liveConfiguration });
  const runtime = createCollectorRuntime(config);

  assert.deepEqual(runtime.sonarrInstances.map(({ library }) => library), ["Television", "Animation"]);
  assert.deepEqual(Object.keys(runtime.radarrPosterSources), ["movies", "documentaries"]);
  assert.equal(runtime.collectors.filter(({ panel }) => panel === "episodes").length, 1);
  assert.equal(runtime.collectors.filter(({ panel }) => panel === "movies").length, 1);
  assert.equal(runtime.collectors.filter(({ panel }) => panel === "sabQueues").length, 1);
  assert.equal(runtime.collectors.find(({ panel }) => panel === "episodes")?.source, "Television + Animation");
});

test("a shared secret file is read once and has one trailing line ending removed", () => {
  let reads = 0;
  const config = loadConfig({ SHARED_MEDIA_KEY_FILE: "/run/secrets/shared" }, {
    configurationText: `
schema_version: 1
mode: live
collectors:
  - type: sonarr
    id: first
    name: First
    url: https://first.example
    api_key_ref: SHARED_MEDIA_KEY
  - type: sonarr
    id: second
    name: Second
    url: https://second.example
    api_key_ref: SHARED_MEDIA_KEY
`,
    readSecretFile: () => {
      reads += 1;
      return "synthetic-file-value\r\n";
    },
  });

  assert.equal(config.secrets.get("SHARED_MEDIA_KEY"), "synthetic-file-value");
  assert.equal(reads, 1);
});

test("secret ambiguity fails with a value- and path-suppressed error", () => {
  let reads = 0;
  assert.throws(() => loadConfig({
    SHARED_MEDIA_KEY: "do-not-print-direct",
    SHARED_MEDIA_KEY_FILE: "/private/do-not-print-path",
  }, {
    configurationText: `
schema_version: 1
mode: live
collectors:
  - type: sonarr
    id: media
    name: Media
    url: https://media.example
    api_key_ref: SHARED_MEDIA_KEY
`,
    readSecretFile: () => {
      reads += 1;
      return "do-not-print-file-value";
    },
  }), (error: unknown) => {
    const message = String(error);
    assert.match(message, /both SHARED_MEDIA_KEY and SHARED_MEDIA_KEY_FILE/);
    assert.doesNotMatch(message, /do-not-print/);
    return true;
  });
  assert.equal(reads, 0);
});

test("unreadable secret files suppress both the configured path and reader failure", () => {
  assert.throws(() => loadConfig({
    SHARED_MEDIA_KEY_FILE: "/private/do-not-print-path",
  }, {
    configurationText: `
schema_version: 1
mode: live
collectors:
  - type: sonarr
    id: media
    name: Media
    url: https://media.example
    api_key_ref: SHARED_MEDIA_KEY
`,
    readSecretFile: () => {
      throw new Error("do-not-print-reader-detail");
    },
  }), (error: unknown) => {
    const message = String(error);
    assert.match(message, /could not be read from SHARED_MEDIA_KEY_FILE/);
    assert.doesNotMatch(message, /do-not-print/);
    return true;
  });
});

test("missing secrets fail startup only for explicitly configured collectors", () => {
  assert.doesNotThrow(() => loadConfig({}, { configurationText: demoConfiguration }));
  assert.throws(() => loadConfig({}, {
    configurationText: `
schema_version: 1
mode: live
collectors:
  - type: radarr
    id: movies
    name: Movies
    url: https://movies.example
    api_key_ref: MOVIE_KEY
`,
  }), /Secret MOVIE_KEY is required but is not configured/);
});

test("unknown fields and duplicate singleton collectors fail closed", () => {
  assert.throws(() => parseConfigDocument(`
schema_version: 1
mode: live
collectors:
  - type: uptime_kuma
    id: first
    name: First
    url: https://first.example
    status_page_slug: public
    arbitrary_command: echo unsafe
`), /Unrecognized key/);
  assert.throws(() => parseConfigDocument(`
schema_version: 1
mode: live
collectors:
  - type: uptime_kuma
    id: first
    name: First
    url: https://first.example
    status_page_slug: public
  - type: uptime_kuma
    id: second
    name: Second
    url: https://second.example
    status_page_slug: public
`), /currently supports one named instance/);
});
