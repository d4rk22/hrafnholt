import assert from "node:assert/strict";
import { test } from "node:test";
import { createArcaneCollector, normalizeArcaneEnvironment } from "../../src/collectors/arcane.js";
import { normalizeEmporia } from "../../src/collectors/emporia.js";
import { createNetdataCollector, normalizeNetdata, normalizeNetdataHistory } from "../../src/collectors/netdata.js";
import { createBackupCollector, pbsIncrementalBytes } from "../../src/collectors/pbs.js";
import { collectPveBackupJobs, createProxmoxCollector, normalizeCpuModel, normalizeProxmoxNode } from "../../src/collectors/proxmox.js";
import { isSuccessfulQbittorrentLogin, normalizeQbittorrentQueue, qBittorrentSessionCookie } from "../../src/collectors/qbittorrent.js";
import { normalizeRadarr } from "../../src/collectors/radarr.js";
import { normalizeSabQueue } from "../../src/collectors/sabnzbd.js";
import { collectSonarrDate, normalizeSonarr } from "../../src/collectors/sonarr.js";
import { createTracearrCollector, normalizeTracearr } from "../../src/collectors/tracearr.js";
import { createTrueNasStorageCollector, normalizeTrueNasStorage } from "../../src/collectors/truenas-storage.js";
import {
  createUniFiCollectors,
  normalizeUniFiHealth,
  normalizeUniFiPdu,
  updateRollingPowerAverage,
  type PowerSample,
} from "../../src/collectors/unifi.js";
import type { UniFiRead } from "../../src/collectors/unifi-client.js";
import { normalizeUptimeKuma } from "../../src/collectors/uptime-kuma.js";
import { normalizeUpsValues, UPS_OIDS } from "../../src/collectors/ups.js";

const WORKLOAD_CONTEXT_START_SECONDS = Date.parse("2030-01-01T00:00:00.000Z") / 1_000;
const NETDATA_METRICS = {
  gpuPercent: { chart: "nvidia_smi_test.gpu_utilization", dimension: "utilization" },
  encodePercent: { chart: "nvidia_smi_test.encoder_utilization", dimension: "encoder" },
  decodePercent: { chart: "nvidia_smi_test.encoder_utilization", dimension: "decoder" },
  vramUsedBytes: { chart: "nvidia_smi_test.mem_usage", dimension: "used" },
  vramFreeBytes: { chart: "nvidia_smi_test.mem_usage", dimension: "free" },
  temperatureC: { chart: "nvidia_smi_test.temperature", dimension: "temp" },
  powerWatts: { chart: "nvidia_power.watts", dimension: "power draw" },
  cpuPercent: { chart: "system.cpu", dimension: "__total__" },
  ramUsedMiB: { chart: "system.ram", dimension: "used" },
  ramFreeMiB: { chart: "system.ram", dimension: "free" },
  ramCachedMiB: { chart: "system.ram", dimension: "cached" },
  ramBuffersMiB: { chart: "system.ram", dimension: "buffers" },
};
const NETDATA_COLLECTOR_OPTIONS = {
  metrics: NETDATA_METRICS,
  gpuName: "Synthetic GPU",
  gpuTensorCores: 96,
  workload: {
    chart: "test_workload.concurrent",
    startAt: "2030-01-01T00:00:00.000Z",
  },
};

test("Tracearr include-location data renders a coarse map, card location, and platform without IP addresses", () => {
  const normalized = normalizeTracearr({
    data: [{ id: "demo-1", username: "demo-viewer", mediaTitle: "Test Episode", durationMs: 1000, progressMs: 500, isTranscode: true, bitrate: 8000, ipAddress: "198.51.100.22", geoCity: "Teston", geoRegion: "QA", geoCountry: "US", geoLat: 39.1234, geoLon: -100.2345, platform: "Demo player" }],
    summary: { total: 1, transcodes: 1, totalBitrate: 8000 },
  });
  assert.equal(normalized.streams[0]?.location.label, "Teston · QA · US");
  assert.equal(normalized.streams[0]?.location.countryCode, "US");
  assert.equal(normalized.streams[0]?.location.latitude, 39.1);
  assert.equal(normalized.streams[0]?.location.longitude, -100.2);
  assert.equal(normalized.streams[0]?.platform, "Demo player");
  assert.doesNotMatch(JSON.stringify(normalized), /ipAddress|198\.51\.100\.22/);
  assert.equal(normalized.transcodes, 1);
});

test("Tracearr default response without location fields renders safely", () => {
  const normalized = normalizeTracearr({
    data: [{ id: "1", username: "viewer", mediaTitle: "Episode", ipAddress: "203.0.113.42" }],
    summary: { total: 1 },
  });
  assert.deepEqual(normalized.streams[0]?.location, {
    label: "Location unavailable",
    countryCode: null,
    latitude: null,
    longitude: null,
  });
  assert.doesNotMatch(JSON.stringify(normalized), /ipAddress|203\.0\.113\.42/);
});

test("Tracearr maps a local-network city sentinel to the configured home location", () => {
  const normalized = normalizeTracearr({
    data: [{ id: "local", mediaTitle: "Local", geoCity: "Local Network", geoLat: 0, geoLon: 0 }],
    summary: { total: 1 },
  }, {
    label: "Example City · CO · US",
    countryCode: "US",
    latitude: 39.7,
    longitude: -105,
  });
  assert.deepEqual(normalized.streams[0]?.location, {
    label: "Example City · CO · US",
    countryCode: "US",
    latitude: 39.7,
    longitude: -105,
  });
});

test("Tracearr keeps a local-network sentinel location-free when home is not configured", () => {
  const normalized = normalizeTracearr({
    data: [{
      id: "local-country",
      mediaTitle: "Local",
      geoCountry: " local network ",
      device: "Living Room Television",
      player: "Plex for Roku",
      product: "Plex",
    }],
    summary: { total: 1 },
  });
  assert.deepEqual(normalized.streams[0]?.location, {
    label: "Local network",
    countryCode: null,
    latitude: null,
    longitude: null,
  });
  assert.equal(normalized.streams[0]?.platform, null);
});

test("Tracearr normalizes international country codes without parsing the display label", () => {
  const normalized = normalizeTracearr({
    data: [
      { id: "valid", mediaTitle: "Demo Program", geoCity: "North Harbor", geoRegion: "Example Region", geoCountry: " zz ", geoLat: 46.1234, geoLon: 3.2345 },
      { id: "invalid", mediaTitle: "Unknown", geoCity: "Somewhere", geoCountry: "Example Country", geoLat: 46.8, geoLon: 3.4 },
    ],
    summary: { total: 2 },
  });
  assert.deepEqual(normalized.streams.map(({ location }) => location.countryCode), ["ZZ", null]);
  assert.equal(normalized.streams[0]?.location.label, "North Harbor · Example Region · zz");
});

test("Tracearr collector opts into sanitized public locations", async () => {
  let requestedUrl = "";
  const collector = createTracearrCollector({
    baseUrl: "https://tracearr.example/",
    token: "concealed",
    request: async (url) => {
      requestedUrl = url;
      return { data: [], summary: { total: 0 } };
    },
  });
  await collector.collect({ signal: new AbortController().signal, now: new Date() });
  assert.equal(requestedUrl, "https://tracearr.example/api/v1/public/streams?includeLocation=true");
});

test("Tracearr empty response is a healthy empty stream set", () => {
  assert.deepEqual(normalizeTracearr({ streams: [], summary: { total: 0 } }).streams, []);
});

test("Tracearr normalizes the current public data array including paused sessions", () => {
  const normalized = normalizeTracearr({
    data: [
      { id: "demo-a", username: "demo-viewer-a", mediaTitle: "Bounded Input", mediaType: "episode", showTitle: "The Quiet Circuit", seasonNumber: 1, episodeNumber: 6, durationMs: 3_000_000, progressMs: 2_700_000, state: "paused", isTranscode: false, videoDecision: "directplay", audioDecision: "directplay", bitrate: 9_000, resolution: "1080p" },
      { id: "demo-b", username: "demo-viewer-b", mediaTitle: "Harbor Lights", mediaType: "movie", year: 2030, durationMs: 5_500_000, progressMs: 2_200_000, state: "paused", isTranscode: true, videoDecision: "transcode", audioDecision: "transcode", bitrate: 11_600, resolution: "1080p" },
    ],
    summary: { total: 2, transcodes: 1, totalBitrate: "20.6 Mbps" },
  });
  assert.equal(normalized.total, 2);
  assert.equal(normalized.transcodes, 1);
  assert.equal(normalized.totalBitrateMbps, 20.6);
  assert.equal(normalized.streams[0]?.title, "The Quiet Circuit");
  assert.equal(normalized.streams[0]?.context, "S01E06 · Bounded Input");
  assert.equal(normalized.streams[0]?.playbackLabel, "Paused · Direct play · 1080p");
  assert.equal(normalized.streams[1]?.playbackLabel, "Paused · Software transcode · 1080p");
  assert.equal(normalized.streams[1]?.transcodeMode, "software");
  assert.equal(normalized.streams[0]?.location.label, "Location unavailable");
});

test("Tracearr distinguishes software, partial, and full hardware transcodes", () => {
  const normalized = normalizeTracearr({
    data: [
      { id: "software", mediaTitle: "Software", isTranscode: true },
      { id: "decode", mediaTitle: "Decode", isTranscode: true, transcodeInfo: { hwDecoding: "nvdec" } },
      { id: "encode", mediaTitle: "Encode", isTranscode: true, transcodeInfo: { hwEncoding: "nvenc" } },
      { id: "hardware", mediaTitle: "Hardware", isTranscode: true, transcodeInfo: { hwDecoding: "nvdec", hwEncoding: "nvenc" } },
    ],
    summary: { total: 4, transcodes: 4 },
  });
  assert.deepEqual(normalized.streams.map(({ transcodeMode }) => transcodeMode), ["software", "partial", "partial", "hardware"]);
  assert.deepEqual(normalized.streams.map(({ playbackLabel }) => playbackLabel), [
    "Software transcode",
    "HW decode · SW encode",
    "SW decode · HW encode",
    "HW transcode",
  ]);
});

test("UniFi normalizes bytes per second to true WAN Mbps", () => {
  const sampledAt = new Date("2030-01-15T12:00:00.000Z");
  const data = normalizeUniFiHealth({ data: [{ subsystem: "wan", "rx_bytes-r": 125000000, "tx_bytes-r": 12500000 }] }, [], sampledAt);
  assert.equal(data.downloadMbps, 1000);
  assert.equal(data.uploadMbps, 100);
  assert.deepEqual(data.samples, [{ sampledAt: sampledAt.toISOString(), downloadMbps: 1000, uploadMbps: 100 }]);
  assert.throws(() => normalizeUniFiHealth({ data: [] }, []), /WAN subsystem/);
});

test("UniFi PDU normalizes and ranks only metered AC outlets", () => {
  const data = normalizeUniFiPdu({ data: [{
    name: "PDU",
    outlet_ac_power_budget: "1600.000",
    outlet_ac_power_consumption: "300.000",
    outlet_table: [
      { index: 1, name: "USB outlet", outlet_caps: 1, relay_state: true },
      { index: 5, name: "Network unit", outlet_power: "20.000", outlet_current: "0.200", outlet_voltage: "120.000", outlet_power_factor: "0.833", relay_state: true },
      { index: 6, name: "Compute unit", outlet_power: "280.000", outlet_current: "2.350", outlet_voltage: "120.000", outlet_power_factor: "0.995", relay_state: true },
      { index: 7, name: "", outlet_power: "0.000", outlet_current: "0.000", outlet_voltage: "120.000", outlet_power_factor: "0.000", relay_state: false },
    ],
  }] });
  assert.equal(data.currentWatts, 300);
  assert.equal(data.rolling24hAverageWatts, 300);
  assert.equal(data.rolling24hSampleMinutes, 0);
  assert.equal(data.capacityWatts, 1600);
  assert.equal(data.voltage, 120);
  assert.equal(data.meteredOutlets, 3);
  assert.deepEqual(data.outlets.map(({ index, name, watts }) => ({ index, name, watts })), [
    { index: 6, name: "Compute unit", watts: 280 },
    { index: 5, name: "Network unit", watts: 20 },
    { index: 7, name: "Outlet 7", watts: 0 },
  ]);
  assert.throws(() => normalizeUniFiPdu({ data: [{ outlet_table: [{ index: 1, relay_state: true }] }] }), /metered outlets/);
});

test("UniFi PDU maintains a bounded time-weighted rolling 24-hour average", () => {
  const samples: PowerSample[] = [];
  const at = (hours: number) => new Date(Date.parse("2030-01-10T00:00:00.000Z") + hours * 60 * 60 * 1_000);

  assert.deepEqual(updateRollingPowerAverage(samples, 100, at(0)), { watts: 100, sampleMinutes: 0 });
  assert.deepEqual(updateRollingPowerAverage(samples, 200, at(6)), { watts: 100, sampleMinutes: 360 });
  assert.deepEqual(updateRollingPowerAverage(samples, 300, at(12)), { watts: 150, sampleMinutes: 720 });
  assert.deepEqual(updateRollingPowerAverage(samples, 500, at(30)), { watts: 275, sampleMinutes: 1_440 });
  assert.equal(samples.length, 3);
  assert.equal(samples[0]?.sampledAt, at(6).getTime());
});

test("paired UniFi collectors share one injected reader without changing cadence", async () => {
  const paths: string[] = [];
  const read: UniFiRead = async (path) => {
    paths.push(path);
    if (path === "/stat/health") {
      return { data: [{ subsystem: "wan", "rx_bytes-r": 125_000, "tx_bytes-r": 62_500 }] };
    }
    return { data: [{
      name: "Rack PDU",
      outlet_ac_power_consumption: 100,
      outlet_table: [{
        index: 1,
        name: "Server",
        outlet_power: 100,
        outlet_current: 1,
        outlet_voltage: 120,
        outlet_power_factor: 0.8,
        relay_state: true,
      }],
    }] };
  };
  const [wan, pdu] = createUniFiCollectors({
    baseUrl: "https://unifi.test",
    username: "dashboard",
    password: "concealed",
    macAddress: "AA:BB",
  }, read);
  const context = {
    signal: new AbortController().signal,
    now: new Date("2030-01-20T12:00:00.000Z"),
  };

  await Promise.all([wan.collect(context), pdu.collect(context)]);

  assert.deepEqual(paths.sort(), ["/stat/device/aa%3Abb", "/stat/health"]);
  assert.deepEqual(
    {
      wan: [wan.intervalMs, wan.timeoutMs, wan.staleAfterMs],
      pdu: [pdu.intervalMs, pdu.timeoutMs, pdu.staleAfterMs],
    },
    {
      wan: [5_000, 3_000, 20_000],
      pdu: [30_000, 5_000, 120_000],
    },
  );
});

test("SAB queue keeps an arbitrary instance identity with bounded names", () => {
  const data = normalizeSabQueue({ queue: { status: "Downloading", speed: "12.5 MB/s", timeleft: "0:10:00", slots: [{ filename: "x".repeat(300), mbleft: "10", percentage: "50", status: "Downloading" }] } }, { name: "Archive downloads", library: "Archive downloads", baseUrl: "http://example", apiKey: "concealed" });
  assert.equal(data.library, "Archive downloads");
  assert.equal(data.items[0]?.name.length, 160);
  assert.equal(data.speedBytesPerSecond, 12_500_000);
});

test("qBittorrent queue includes incomplete downloads and excludes completed seeds", () => {
  const data = normalizeQbittorrentQueue([
    { name: "active", amount_left: 1_000, progress: 0.5, dlspeed: 2_000, eta: 30, state: "downloading" },
    { name: "queued", amount_left: 2_000, progress: 0.25, dlspeed: 0, eta: 8_640_000, state: "queuedDL" },
    { name: "complete", amount_left: 0, progress: 1, dlspeed: 0, eta: 0, state: "uploading" },
  ], { name: "Documentary downloads", library: "Documentary downloads", baseUrl: "http://example", username: "user", password: "concealed" });
  assert.equal(data.client, "qbittorrent");
  assert.equal(data.library, "Documentary downloads");
  assert.equal(data.items.length, 2);
  assert.equal(data.speedBytesPerSecond, 2_000);
  assert.equal(data.timeLeftSeconds, 30);
  assert.equal(data.items[0]?.progressPercent, 50);
});

test("qBittorrent login accepts current 204 and legacy 200 success responses only with a session cookie", () => {
  assert.equal(isSuccessfulQbittorrentLogin(204, "", "session"), true);
  assert.equal(isSuccessfulQbittorrentLogin(200, "Ok.", "session"), true);
  assert.equal(isSuccessfulQbittorrentLogin(204, "", undefined), false);
  assert.equal(isSuccessfulQbittorrentLogin(403, "Fails.", "session"), false);
});

test("qBittorrent preserves current and legacy session cookie names", () => {
  assert.equal(qBittorrentSessionCookie("QBT_SID_8080=opaque; HttpOnly; Path=/"), "QBT_SID_8080=opaque");
  assert.equal(qBittorrentSessionCookie("SID=opaque; HttpOnly; Path=/"), "SID=opaque");
  assert.equal(qBittorrentSessionCookie(null), undefined);
});

test("Sonarr never infers grabbed solely from air time", () => {
  const now = new Date("2030-01-15T01:30:00.000Z");
  const episodes = normalizeSonarr([{ id: 1, title: "Test Episode", seasonNumber: 1, episodeNumber: 2, airDateUtc: "2030-01-15T01:00:00.000Z", hasFile: false, monitored: true, series: { title: "Demo Show" } }], { library: "Demo television", baseUrl: "http://example", apiKey: "concealed" }, now);
  assert.equal(episodes[0]?.state, "airing");
  assert.notEqual(episodes[0]?.state, "grabbed");
  assert.throws(() => normalizeSonarr({ malformed: true }, { library: "Sonarr", baseUrl: "http://example", apiKey: "concealed" }, now), /malformed/);
});

test("Sonarr calendar collection requests the selected local day from both libraries", async () => {
  const urls: string[] = [];
  const data = await collectSonarrDate([
    { library: "Television", baseUrl: "http://television.example", apiKey: "concealed" },
    { library: "Animation", baseUrl: "http://animation.example", apiKey: "concealed" },
  ], "2030-01-22", new Date("2030-01-22T17:00:00.000Z"), new AbortController().signal, async (url) => {
    urls.push(url);
    return [];
  });
  assert.deepEqual(data, { localDate: "2030-01-22", episodes: [] });
  assert.equal(urls.length, 2);
  for (const value of urls) {
    const url = new URL(value);
    assert.equal(url.pathname, "/api/v3/calendar");
    assert.equal(url.searchParams.get("start"), "2030-01-22");
    assert.equal(url.searchParams.get("end"), "2030-01-23");
    assert.equal(url.searchParams.get("includeSeries"), "true");
    assert.equal(url.searchParams.get("includeEpisodeFile"), "true");
  }
});

test("Radarr sorts against source added timestamps without paths", () => {
  const movies = normalizeRadarr([{ id: 1, title: "Demo Movie", year: 2030, added: "2030-01-15T01:00:00.000Z", hasFile: true, path: "/synthetic/private/path" }], { id: "demo-films", library: "Demo films", baseUrl: "http://example", apiKey: "concealed" });
  assert.equal(movies[0]?.title, "Demo Movie");
  assert.equal(movies[0]?.posterUrl, "/api/posters/radarr/demo-films/1");
  assert.doesNotMatch(JSON.stringify(movies), /synthetic\/private/);
});

test("energy normalization preserves every synthetic ledger field", () => {
  const energy = normalizeEmporia({ server_w: 400, ac_w: 100, house_w: 900, total_w: 500, server_today: 7.4, ac_today: 1.2, total_today: 8.6, house_today: 21, server_month: 100, ac_month: 25, total_month: 125, house_month: 300, projected_kwh: 360, house_projected_kwh: 900, month_cost: 10, projected_cost: 30, house_projected_cost: 75, rate: 0.15, rate_label: "synthetic flat rate", days_in_month: 31, pct_of_house: 42 });
  assert.equal(energy.totalWatts, 500);
  assert.equal(energy.rateLabel, "synthetic flat rate");
  assert.equal(energy.serverTodayKwh, 7.4);
  assert.equal(energy.acMonthKwh, 25);
  assert.equal(energy.houseMonthKwh, 300);
  assert.equal(energy.projectedHouseKwh, 900);
  assert.equal(energy.projectedHouseCost, 75);
  assert.equal(energy.daysInMonth, 31);
});

test("standard UPS OIDs normalize battery status, charge, runtime, and load", () => {
  assert.equal(UPS_OIDS.some((oid) => oid.startsWith(".")), false);
  const ups = normalizeUpsValues([2, 0, 17, 100, 52]);
  assert.deepEqual(ups, { batteryStatus: "normal", secondsOnBattery: 0, runtimeMinutes: 17, chargePercent: 100, loadPercent: 52 });
  assert.throws(() => normalizeUpsValues([2]), /incomplete/);
});

test("Netdata v1 chart dimensions normalize idle GPU values", () => {
  const response = (id: string, value: number) => ({ labels: ["time", id], data: [[1710000000, value]] });
  const ram = { labels: ["time", "free", "used", "cached", "buffers"], data: [[1710000000, 6_000, 4_000, 5_000, 1_000]] };
  const data = normalizeNetdata({ gpuPercent: response("utilization", 0), encodePercent: response("encoder", 0), decodePercent: response("decoder", 0), vramUsedBytes: response("used", 100), vramFreeBytes: response("free", 5900), temperatureC: response("temp", 40), powerWatts: response("power draw", 12), cpuPercent: { labels: ["time", "guest", "guest_nice", "user", "system"], data: [[1710000000, 2, 1, 5, 3]] }, ramUsedMiB: ram, ramFreeMiB: ram, ramCachedMiB: ram, ramBuffersMiB: ram }, "Linux target", { architecture: "x86_64", virtualization: "kvm", cores_total: "8" }, null, { gpuName: "Synthetic GPU", gpuTensorCores: 96 });
  assert.equal(data.gpuPercent, 0);
  assert.equal(data.cpuPercent, 8);
  assert.equal(data.cpuCores, 8);
  assert.equal(data.gpuName, "Synthetic GPU");
  assert.equal(data.gpuTensorCores, 96);
  assert.equal(data.vramTotalBytes, 6_000 * 1024 * 1024);
  assert.equal(data.ramUsedBytes, 4_000 * 1024 * 1024);
  assert.equal(data.ramTotalBytes, 16_000 * 1024 * 1024);
  assert.equal(data.history, null);
});

test("Netdata history derives bounded capacity pressure from aligned source-owned samples", () => {
  const series = (dimension: string, values: number[]) => ({
    labels: ["time", dimension],
    data: values.map((value, index) => [WORKLOAD_CONTEXT_START_SECONDS + index * 1_800, value]).reverse(),
  });
  const cpu = {
    labels: ["time", "guest", "guest_nice", "user", "system"],
    data: [[WORKLOAD_CONTEXT_START_SECONDS + 3_600, 4, 2, 32, 18], [WORKLOAD_CONTEXT_START_SECONDS + 1_800, 3, 1, 20, 15], [WORKLOAD_CONTEXT_START_SECONDS, 2, 1, 8, 7]],
  };
  const metrics = {
    encodePercent: series("encoder", [10, 40, 90]),
    decodePercent: series("decoder", [5, 20, 70]),
    vramUsedBytes: series("used", [100, 200, 300]),
    vramFreeBytes: series("free", [900, 800, 700]),
    temperatureC: series("temp", [50, 55, 65]),
    cpuPercent: cpu,
    ramUsedMiB: series("used", [1_000, 2_000, 3_000]),
    ramFreeMiB: series("free", [4_000, 3_000, 2_000]),
    ramCachedMiB: series("cached", [4_000, 4_000, 4_000]),
    ramBuffersMiB: series("buffers", [1_000, 1_000, 1_000]),
    workloadAverage: {
      labels: ["time", "all streams", "video transcodes"],
      data: [[WORKLOAD_CONTEXT_START_SECONDS + 3_600, 4.5, 2.5], [WORKLOAD_CONTEXT_START_SECONDS + 1_800, 2.5, 1.5], [WORKLOAD_CONTEXT_START_SECONDS, 1.5, 0.5]],
    },
    workloadPeak: {
      labels: ["time", "all streams", "video transcodes"],
      data: [[WORKLOAD_CONTEXT_START_SECONDS + 3_600, 7, 4], [WORKLOAD_CONTEXT_START_SECONDS + 1_800, 5, 3], [WORKLOAD_CONTEXT_START_SECONDS, 3, 1]],
    },
  };
  const history = normalizeNetdataHistory(metrics);
  assert.ok(history);
  assert.equal(history.analysisSamples, 3);
  assert.equal(history.bucketSeconds, 1_800);
  assert.deepEqual(history.points.map((point) => point.encodePercent), [10, 40, 90]);
  assert.deepEqual(history.points.map((point) => point.decodePercent), [5, 20, 70]);
  assert.deepEqual(history.points.map((point) => point.cpuPercent), [15, 35, 50]);
  assert.deepEqual(history.points.map((point) => point.streamAverage), [1.5, 2.5, 4.5]);
  assert.deepEqual(history.points.map((point) => point.streamPeak), [3, 5, 7]);
  assert.deepEqual(history.points.map((point) => point.videoTranscodeAverage), [0.5, 1.5, 2.5]);
  assert.deepEqual(history.points.map((point) => point.videoTranscodePeak), [1, 3, 4]);
  const forwardOnly = normalizeNetdataHistory({
    ...metrics,
    workloadAverage: {
      labels: ["time", "all streams", "video transcodes"],
      data: [[WORKLOAD_CONTEXT_START_SECONDS + 3_600, 4.5, 2.5]],
    },
    workloadPeak: {
      labels: ["time", "all streams", "video transcodes"],
      data: [[WORKLOAD_CONTEXT_START_SECONDS + 3_600, 7, 4]],
    },
  });
  assert.deepEqual(forwardOnly?.points.map((point) => point.streamAverage), [null, null, 4.5]);
  assert.deepEqual(forwardOnly?.points.map((point) => point.videoTranscodePeak), [null, null, 4]);
  assert.equal(history.summary.encodeP95Percent, 90);
  assert.equal(history.summary.decodeP95Percent, 70);
  assert.equal(history.summary.pressure, "pressured");
  assert.equal(history.summary.constraint, "gpu_encoder");
  const comfortable = normalizeNetdataHistory({
    ...metrics,
    encodePercent: series("encoder", [10, 20, 30]),
    decodePercent: series("decoder", [100, 100, 100]),
    temperatureC: series("temp", [50, 60, 70]),
    workloadAverage: {
      labels: ["time", "all streams", "video transcodes"],
      data: [[WORKLOAD_CONTEXT_START_SECONDS + 3_600, 1_000, 1_000], [WORKLOAD_CONTEXT_START_SECONDS + 1_800, 1_000, 1_000], [WORKLOAD_CONTEXT_START_SECONDS, 1_000, 1_000]],
    },
    workloadPeak: {
      labels: ["time", "streams", "video_transcodes"],
      data: [[WORKLOAD_CONTEXT_START_SECONDS + 3_600, 2_000, 2_000], [WORKLOAD_CONTEXT_START_SECONDS + 1_800, 2_000, 2_000], [WORKLOAD_CONTEXT_START_SECONDS, 2_000, 2_000]],
    },
  });
  assert.equal(comfortable?.summary.decodeP95Percent, 100);
  assert.equal(comfortable?.summary.pressure, "comfortable");
  assert.equal(comfortable?.summary.constraint, null);
  const collecting = normalizeNetdataHistory({ ...metrics, workloadAverage: null, workloadPeak: null });
  assert.ok(collecting);
  assert.equal(collecting.points.at(-1)?.streamAverage, null);
  assert.equal(collecting.points.at(-1)?.streamPeak, null);
  assert.equal(collecting.summary.pressure, "pressured");
});

test("Netdata history applies the configured workload-context boundary without hiding later gaps", () => {
  const timestamps = [
    WORKLOAD_CONTEXT_START_SECONDS - 1_800,
    WORKLOAD_CONTEXT_START_SECONDS,
    WORKLOAD_CONTEXT_START_SECONDS + 1_800,
  ];
  const series = (dimension: string, values: number[]) => ({
    labels: ["time", dimension],
    data: values.map((value, index) => [timestamps[index], value]).reverse(),
  });
  const history = normalizeNetdataHistory({
    encodePercent: series("encoder", [99, 10, 20]),
    decodePercent: series("decoder", [90, 5, 6]),
    vramUsedBytes: series("used", [900, 100, 200]),
    vramFreeBytes: series("free", [100, 900, 800]),
    temperatureC: series("temp", [90, 50, 51]),
    cpuPercent: series("user", [90, 15, 16]),
    ramUsedMiB: series("used", [9_000, 1_000, 2_000]),
    ramFreeMiB: series("free", [1_000, 4_000, 3_000]),
    ramCachedMiB: series("cached", [0, 0, 0]),
    ramBuffersMiB: series("buffers", [0, 0, 0]),
    workloadAverage: {
      labels: ["time", "streams", "video_transcodes"],
      data: [[WORKLOAD_CONTEXT_START_SECONDS, 3, 1]],
    },
    workloadPeak: {
      labels: ["time", "streams", "video_transcodes"],
      data: [[WORKLOAD_CONTEXT_START_SECONDS, 5, 2]],
    },
  }, undefined, WORKLOAD_CONTEXT_START_SECONDS);

  assert.ok(history);
  assert.equal(history.sampledFrom, "2030-01-01T00:00:00.000Z");
  assert.equal(history.sampledTo, "2030-01-01T00:30:00.000Z");
  assert.equal(history.analysisSamples, 2);
  assert.deepEqual(history.points.map((point) => point.encodePercent), [10, 20]);
  assert.deepEqual(history.points.map((point) => point.streamAverage), [3, null]);
  assert.deepEqual(history.points.map((point) => point.videoTranscodePeak), [2, null]);
  assert.equal(history.summary.encodeP95Percent, 20);
  assert.equal(history.summary.temperaturePeakC, 51);
  assert.equal(history.summary.pressure, "comfortable");
  assert.equal(history.summary.constraint, null);
});

test("Netdata display downsampling averages workload context but preserves its bucket peaks", () => {
  const values = Array.from({ length: 241 }, (_value, index) => index);
  const series = (dimension: string, samples: number[]) => ({
    labels: ["time", dimension],
    data: samples.map((value, index) => [WORKLOAD_CONTEXT_START_SECONDS + index * 1_800, value]).reverse(),
  });
  const workload = (samples: number[], peaks: number[]) => ({
    average: {
      labels: ["time", "streams", "video_transcodes"],
      data: samples.map((value, index) => [WORKLOAD_CONTEXT_START_SECONDS + index * 1_800, value, value / 2]).reverse(),
    },
    peak: {
      labels: ["time", "streams", "video_transcodes"],
      data: peaks.map((value, index) => [WORKLOAD_CONTEXT_START_SECONDS + index * 1_800, value, value - 1]).reverse(),
    },
  });
  const workloadSeries = workload(values.map((value) => value + 1), values.map((value) => value % 2 ? 9 : 2));
  const history = normalizeNetdataHistory({
    encodePercent: series("encoder", values.map(() => 10)),
    decodePercent: series("decoder", values.map(() => 5)),
    vramUsedBytes: series("used", values.map(() => 100)),
    vramFreeBytes: series("free", values.map(() => 900)),
    temperatureC: series("temp", values.map(() => 50)),
    cpuPercent: series("user", values.map(() => 15)),
    ramUsedMiB: series("used", values.map(() => 1_000)),
    ramFreeMiB: series("free", values.map(() => 4_000)),
    ramCachedMiB: series("cached", values.map(() => 4_000)),
    ramBuffersMiB: series("buffers", values.map(() => 1_000)),
    workloadAverage: workloadSeries.average,
    workloadPeak: workloadSeries.peak,
  });
  assert.ok(history);
  assert.equal(history.analysisSamples, 241);
  assert.equal(history.points.length, 121);
  assert.equal(history.points[0]?.streamAverage, 1.5);
  assert.equal(history.points[0]?.streamPeak, 9);
  assert.equal(history.points[0]?.videoTranscodeAverage, 0.75);
  assert.equal(history.points[0]?.videoTranscodePeak, 8);
});

test("Netdata history refreshes every five minutes without weakening the five-second live collector", async () => {
  const requested: string[] = [];
  const responseFor = (chart: string, historical: boolean, group: string | null) => {
    const times = historical ? [WORKLOAD_CONTEXT_START_SECONDS + 1_800, WORKLOAD_CONTEXT_START_SECONDS] : [WORKLOAD_CONTEXT_START_SECONDS + 1_800];
    const rows = (values: number[]) => times.map((time, index) => [time, values[index] ?? values[0]]);
    if (chart.includes("gpu_utilization")) return { labels: ["time", "utilization"], data: rows([20, 10]) };
    if (chart.includes("encoder_utilization")) return { labels: ["time", "encoder", "decoder"], data: times.map((time, index) => [time, [40, 20][index], [25, 10][index]]) };
    if (chart.includes("mem_usage")) return { labels: ["time", "used", "free"], data: times.map((time, index) => [time, [2_000, 1_000][index], [4_000, 5_000][index]]) };
    if (chart.includes("temperature")) return { labels: ["time", "temp"], data: rows([62, 55]) };
    if (chart === "nvidia_power.watts") return { labels: ["time", "power draw"], data: rows([42, 30]) };
    if (chart === "system.cpu") return { labels: ["time", "guest", "guest_nice", "user", "system"], data: times.map((time, index) => [time, 2, 1, [30, 20][index], [15, 10][index]]) };
    if (chart === "system.ram") return { labels: ["time", "free", "used", "cached", "buffers"], data: times.map((time, index) => [time, 6_000, [4_000, 3_000][index], 5_000, 1_000]) };
    if (chart === "test_workload.concurrent") return {
      labels: ["time", "all streams", "video transcodes"],
      data: times.map((time, index) => [time, group === "max" ? [6, 4][index] : [3.5, 2.5][index], group === "max" ? [4, 2][index] : [1.5, 0.5][index]]),
    };
    throw new Error(`Unexpected chart: ${chart}`);
  };
  const collector = createNetdataCollector("http://netdata.example", async (url) => {
    requested.push(url);
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/info")) return { cores_total: "8" };
    return responseFor(parsed.searchParams.get("chart") ?? "", parsed.searchParams.get("points") === "1440", parsed.searchParams.get("group"));
  }, NETDATA_COLLECTOR_OPTIONS);
  const signal = new AbortController().signal;
  await collector.collect({ signal, now: new Date("2030-01-01T01:00:00.000Z") });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await collector.collect({ signal, now: new Date("2030-01-01T01:01:00.000Z") });
  assert.equal(second.history?.analysisSamples, 2);
  assert.equal(second.history?.points.at(-1)?.streamAverage, 3.5);
  assert.equal(second.history?.points.at(-1)?.streamPeak, 6);
  assert.equal(requested.filter((url) => new URL(url).searchParams.get("points") === "1440").length, 7);
  assert.equal(requested.filter((url) => new URL(url).searchParams.get("chart") === "test_workload.concurrent" && new URL(url).searchParams.get("group") === "max").length, 1);
  assert.equal(requested.filter((url) => new URL(url).searchParams.get("points") === "1").length, 14);
});

test("Netdata live telemetry returns while a background history request is still pending", async () => {
  const collector = createNetdataCollector("http://netdata.example", async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/info")) return { cores_total: "8" };
    if (parsed.searchParams.get("points") === "1440") return new Promise<unknown>(() => undefined);
    const chart = parsed.searchParams.get("chart") ?? "";
    if (chart.includes("gpu_utilization")) return { labels: ["time", "utilization"], data: [[1_710_000_000, 20]] };
    if (chart.includes("encoder_utilization")) return { labels: ["time", "encoder", "decoder"], data: [[1_710_000_000, 40, 25]] };
    if (chart.includes("mem_usage")) return { labels: ["time", "used", "free"], data: [[1_710_000_000, 2_000, 4_000]] };
    if (chart.includes("temperature")) return { labels: ["time", "temp"], data: [[1_710_000_000, 62]] };
    if (chart === "nvidia_power.watts") return { labels: ["time", "power draw"], data: [[1_710_000_000, 42]] };
    if (chart === "system.cpu") return { labels: ["time", "guest", "guest_nice", "user", "system"], data: [[1_710_000_000, 2, 1, 30, 15]] };
    if (chart === "system.ram") return { labels: ["time", "free", "used", "cached", "buffers"], data: [[1_710_000_000, 6_000, 4_000, 5_000, 1_000]] };
    throw new Error(`Unexpected chart: ${chart}`);
  }, NETDATA_COLLECTOR_OPTIONS);
  let timeout: NodeJS.Timeout | undefined;
  try {
    const data = await Promise.race([
      collector.collect({ signal: new AbortController().signal, now: new Date("2030-01-15T12:00:00.000Z") }),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("live collection waited for history")), 100); }),
    ]);
    assert.equal(data.gpuPercent, 20);
    assert.equal(data.history, null);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
});

test("Arcane standby polling environment remains healthy", () => {
  const environment = normalizeArcaneEnvironment({ id: "demo-edge", name: "Demo edge", status: "standby", connected: false }, []);
  assert.equal(environment.connected, true);
  assert.equal(environment.status, "standby");
});

test("Arcane collector includes containers returned by standby Edge environments", async () => {
  const requested: string[] = [];
  const collector = createArcaneCollector("https://arcane.example/api", "concealed", async (url) => {
    requested.push(url);
    if (url.endsWith("/environments?limit=50")) {
      return { data: [{ id: "edge", name: "demo-edge", status: "standby", connected: false }] };
    }
    return { data: [{ name: "demo-edge-agent-1", state: "running", status: "Up" }] };
  });
  const data = await collector.collect({ signal: new AbortController().signal, now: new Date() });
  assert.equal(requested[1], "https://arcane.example/api/environments/edge/containers?limit=100&includeInternal=false");
  assert.equal(data.total, 1);
  assert.equal(data.running, 1);
  assert.equal(data.environments[0]?.connected, true);
  assert.equal(data.environments[0]?.containers[0]?.name, "demo-edge-agent-1");
});

test("Arcane collector keeps standby Edge environments healthy when enumeration is deferred", async () => {
  const collector = createArcaneCollector("https://arcane.example/api", "concealed", async (url) => {
    if (url.endsWith("/environments?limit=50")) {
      return { data: [{ id: "edge", name: "demo-edge", status: "standby", connected: false }] };
    }
    throw new Error("Edge agent is between polling check-ins");
  });
  const data = await collector.collect({ signal: new AbortController().signal, now: new Date() });
  assert.equal(data.environments[0]?.connected, true);
  assert.equal(data.environments[0]?.status, "standby");
  assert.deepEqual(data.environments[0]?.containers, []);
});

test("Arcane collector retains last known containers while a standby Edge Agent is deferred", async () => {
  let environmentReads = 0;
  const collector = createArcaneCollector("https://arcane.example/api", "concealed", async (url) => {
    if (url.endsWith("/environments?limit=50")) {
      environmentReads += 1;
      return {
        data: [{
          id: "edge",
          name: "demo-edge",
          status: environmentReads === 1 ? "online" : "standby",
          connected: environmentReads === 1,
        }],
      };
    }
    if (environmentReads === 1) return { data: [{ name: "demo-edge-agent-1", state: "running", status: "Up" }] };
    throw new Error("Edge agent is between polling check-ins");
  });
  const first = await collector.collect({ signal: new AbortController().signal, now: new Date() });
  const second = await collector.collect({ signal: new AbortController().signal, now: new Date() });
  assert.equal(first.running, 1);
  assert.equal(second.environments[0]?.status, "standby");
  assert.equal(second.environments[0]?.connected, true);
  assert.equal(second.environments[0]?.containers[0]?.name, "demo-edge-agent-1");
  assert.equal(second.running, 1);
});

test("Proxmox authorization gaps render unknown instead of down", () => {
  const node = normalizeProxmoxNode({ node: "node-a", status: "unknown" }, {}, []);
  assert.equal(node.status, "unknown");
});

test("Proxmox supplies a compact physical processor manufacturer and model", () => {
  assert.equal(normalizeCpuModel("Example(R) Processor(R) 9000 CPU @ 3.60GHz"), "Example Processor 9000");
  const node = normalizeProxmoxNode(
    { node: "media-node", status: "online" },
    { data: { status: "online", cpuinfo: { model: "Example(R) Processor(R) 9000 CPU @ 3.60GHz" } } },
    [],
    { data: { used: 40, total: 100 } },
  );
  assert.equal(node.cpuModel, "Example Processor 9000");
  assert.equal(node.storageUsedBytes, 40);
  assert.equal(node.storageTotalBytes, 100);
});

test("Proxmox collector applies configured node roles and exclusions", async () => {
  const requested: string[] = [];
  const collector = createProxmoxCollector("https://pve.example", "concealed", async (url) => {
    requested.push(url);
    if (url.endsWith("/nodes")) return { data: [
      { node: "compute-b", status: "online", maxmem: 100 },
      { node: "compute-a", status: "online", maxmem: 100 },
      { node: "quorum-only", status: "online", maxmem: 900 },
    ] };
    if (url.includes("cluster/resources")) return { data: [] };
    if (url.includes("/storage/fast-storage/status")) return { data: { used: 40, total: 100 } };
    return { data: { node: "compute-a", status: "online", memory: { total: 100 } } };
  }, {
    storageId: "fast-storage",
    allowInsecureTls: true,
    excludedNodes: ["quorum-only"],
    nodeRoles: { "compute-a": "cluster anchor", "compute-b": "media processing" },
  });
  const data = await collector.collect({ signal: new AbortController().signal, now: new Date() });
  assert.deepEqual(data.nodes.map(({ name }) => name), ["compute-a", "compute-b"]);
  assert.deepEqual(data.nodes.map(({ role }) => role), ["cluster anchor", "media processing"]);
  assert.equal(data.totalMemoryBytes, 200);
  assert.equal(data.nodes[0]?.storageUsedBytes, 40);
  assert.equal(requested.some((url) => url.includes("/nodes/compute-a/storage/fast-storage/status")), true);
  assert.equal(requested.some((url) => url.includes("/nodes/quorum-only/status")), false);
});

test("Proxmox guest backup rollup spans cluster tasks and counts unique guests", async () => {
  const requested: string[] = [];
  const primaryUpid = "UPID:demo-node-a:vzdump:root@pam:";
  const secondaryUpid = "UPID:demo-node-b:vzdump:503:root@pam:";
  const quorumUpid = "UPID:demo-node-c:vzdump:root@pam:";
  const jobs = await collectPveBackupJobs("https://pve.example", "concealed", new AbortController().signal, async (url) => {
    requested.push(url);
    if (url.endsWith("/cluster/tasks")) return { data: [
      { type: "vzdump", node: "demo-node-c", upid: quorumUpid, starttime: 2_004, endtime: 2_004, status: "OK" },
      { type: "vzdump", node: "demo-node-b", upid: secondaryUpid, starttime: 2_003, endtime: 2_106, status: "OK" },
      { type: "vzdump", node: "demo-node-a", upid: primaryUpid, starttime: 2_000, endtime: 4_795, status: "WARNINGS: 3" },
      { type: "vzdump", node: "demo-node-a", upid: "prior-run", starttime: 500, endtime: 600, status: "OK" },
      { type: "aptupdate", node: "demo-node-a", upid: "newer-other-task", starttime: 3_000, endtime: 3_001, status: "OK" },
    ] };
    if (url.includes(encodeURIComponent(primaryUpid))) return { data: [
      { t: "INFO: Starting Backup of VM 501 (qemu)" },
      { t: "INFO: Starting Backup of VM 502 (lxc)" },
      { t: "INFO: Finished Backup of VM 501 (00:01:43)" },
    ] };
    if (url.includes(encodeURIComponent(secondaryUpid))) return { data: [
      { t: "INFO: Starting Backup of VM 503 (qemu)" },
      { t: "INFO: Finished Backup of VM 503 (00:01:39)" },
    ] };
    if (url.includes(encodeURIComponent(quorumUpid))) return { data: [{ t: "TASK OK" }] };
    throw new Error(`Unexpected request: ${url}`);
  });

  assert.equal(jobs[0]?.name, "Proxmox guest backup run");
  assert.equal(jobs[0]?.detail, "3 guests · latest completed run");
  assert.equal(jobs[0]?.lastRunAt, "1970-01-01T00:33:20.000Z");
  assert.equal(jobs[0]?.durationSeconds, 2_795);
  assert.equal(jobs[0]?.message, "3 warnings");
  assert.equal(jobs[0]?.transferredBytes, null);
  assert.equal(requested.filter((url) => url.endsWith("/log?start=0&limit=10000")).length, 3);
  assert.equal(requested.some((url) => url.includes("prior-run")), false);
});

test("backup collection leaves unconfigured PBS and topology placeholders absent", async () => {
  const requested: string[] = [];
  const upid = "UPID:compute-a:vzdump:root@pam:";
  const collector = createBackupCollector({
    pveUrl: "https://pve.example",
    pveToken: "pve-concealed",
  }, async (url) => {
    requested.push(url);
    if (url.endsWith("/cluster/tasks")) return { data: [
      { type: "vzdump", node: "compute-a", upid, starttime: 2_000, endtime: 2_100, status: "OK" },
    ] };
    if (url.includes(encodeURIComponent(upid))) return { data: [
      { t: "INFO: Starting Backup of VM 101 (qemu)" },
    ] };
    throw new Error(`Unexpected request: ${url}`);
  });

  const data = await collector.collect({ signal: new AbortController().signal, now: new Date() });
  assert.equal(collector.source, "Proxmox VE");
  assert.equal(data.pbs, undefined);
  assert.deepEqual(data.jobs.map(({ source }) => source), ["Proxmox VE"]);
  assert.equal(requested.every((url) => url.startsWith("https://pve.example/")), true);
  assert.doesNotMatch(JSON.stringify(data), /PBS|topology-placeholder/i);
});

test("PBS guest backup rollup spans the latest run and sums every archive", async () => {
  const requested: string[] = [];
  const pveUpid = "UPID:demo-node-a:vzdump:root@pam:";
  const vmUpid = "UPID:backup-demo:backup:primary-demo\\x3avm-501:root@pam:";
  const ctUpid = "UPID:backup-demo:backup:primary-demo\\x3act-502:root@pam:";
  const collector = createBackupCollector({
    pveUrl: "https://pve.example",
    pveToken: "pve-concealed",
    pbs: { url: "https://pbs.example", token: "pbs-concealed" },
  }, async (url) => {
    requested.push(url);
    if (url === "https://pve.example/api2/json/cluster/tasks") return { data: [
      { type: "vzdump", node: "demo-node-a", upid: pveUpid, starttime: 1_980, endtime: 2_006, status: "OK" },
    ] };
    if (url.includes(encodeURIComponent(pveUpid))) return { data: [
      { t: "INFO: Starting Backup of VM 502 (lxc)" },
      { t: "INFO: Starting Backup of VM 501 (qemu)" },
    ] };
    if (url.endsWith("/tasks?limit=100")) return { data: [
      { upid: "newer-sync", worker_type: "syncjob", starttime: 2_010, endtime: 2_012, status: "OK" },
      { upid: vmUpid, worker_type: "backup", worker_id: "primary-demo:vm/501", starttime: 2_000, endtime: 2_006, status: "OK" },
      { upid: ctUpid, worker_type: "backup", worker_id: "primary-demo:ct/502", starttime: 1_980, endtime: 1_990, status: "OK" },
      { upid: "prior-run", worker_type: "backup", worker_id: "primary-demo:vm/503", starttime: 500, endtime: 600, status: "OK" },
    ] };
    if (url.includes(encodeURIComponent(vmUpid))) return { data: [
      { n: 1, t: "Size: 3758096384" },
      { n: 2, t: "Upload size: 4194304 (0%)" },
    ] };
    if (url.includes(encodeURIComponent(ctUpid))) return { data: [
      { n: 1, t: "Upload size: 488254691 (9%)" },
      { n: 2, t: "Upload size: 528967 (100%)" },
    ] };
    throw new Error(`Unexpected request: ${url}`);
  });

  const data = await collector.collect({ signal: new AbortController().signal, now: new Date() });
  const backup = data.jobs.find((job) => job.source === "Proxmox VE + PBS");
  assert.equal(backup?.name, "Proxmox guest backups");
  assert.equal(backup?.detail, "2 guests · stored in PBS");
  assert.equal(backup?.lastRunAt, "1970-01-01T00:33:00.000Z");
  assert.equal(backup?.durationSeconds, 26);
  assert.equal(backup?.result, "success");
  assert.equal(backup?.transferredBytes, 492_977_962);
  assert.equal(requested.filter((url) => url.endsWith("/log?start=0&limit=10000")).length, 3);
  assert.equal(requested.some((url) => url.includes("prior-run")), false);
});

test("PBS protection overview uses authoritative available bytes and deduplicates protected guests", async () => {
  const requests: Array<{ url: string; authorization: string | null; insecure: boolean | undefined }> = [];
  const pbsUpid = "UPID:backup-demo:00000001:00000002:66852280:backup:primary-demo-vm-501:root@pam:";
  const collector = createBackupCollector({
    pveUrl: "https://pve.example",
    pveToken: "pve-concealed",
    pbs: { url: "https://pbs.example", token: "pbs-concealed" },
  }, async (url, init, insecure) => {
    requests.push({ url, authorization: new Headers(init.headers).get("authorization"), insecure });
    if (url === "https://pve.example/api2/json/cluster/tasks") return { data: [] };
    if (url.endsWith("/tasks?limit=100")) return { data: [
      { node: "localhost", upid: pbsUpid, worker_type: "backup", starttime: 2_000, endtime: 2_010, status: "OK" },
    ] };
    if (url.includes(encodeURIComponent(pbsUpid))) return { data: [{ t: "Upload size: 42" }] };
    if (url.endsWith("/admin/datastore")) return { data: [
      { store: "primary-demo", "mount-status": "mounted" },
      { store: "archive-demo", "mount-status": "mounted" },
    ] };
    if (url.endsWith("/admin/datastore/primary-demo/status")) return { data: { used: 600, avail: 350, total: 1_000 } };
    if (url.endsWith("/admin/datastore/archive-demo/status")) return { data: { used: 800, avail: 150, total: 1_000 } };
    if (url.endsWith("/admin/datastore/primary-demo/snapshots")) return { data: [
      { "backup-type": "vm", "backup-id": "501", verification: { state: "ok" } },
      { "backup-type": "vm", "backup-id": "501", verification: { state: "ok" } },
      { "backup-type": "ct", "backup-id": "502" },
    ] };
    if (url.endsWith("/admin/datastore/archive-demo/snapshots")) return { data: [
      { "backup-type": "vm", "backup-id": "501", verification: { state: "ok" } },
      { "backup-type": "host", "backup-id": "pbs", verification: { state: "ok" } },
    ] };
    if (url.endsWith("/admin/verify")) return { data: [
      { store: "primary-demo", "last-run-endtime": 1_720_000_050, "last-run-state": "OK" },
    ] };
    if (url.endsWith("/admin/gc")) return { data: [
      { store: "primary-demo", "last-run-endtime": 1_720_000_100, "last-run-state": "OK", "removed-bytes": 700 },
      { store: "archive-demo", "last-run-endtime": 1_719_000_000, "last-run-state": "OK", "removed-bytes": 900 },
    ] };
    throw new Error(`Unexpected request: ${url}`);
  });

  const data = await collector.collect({ signal: new AbortController().signal, now: new Date() });
  const primary = data.pbs?.datastores.find((datastore) => datastore.name === "primary-demo");
  assert.equal(data.pbs?.serverName, "backup-demo");
  assert.equal(data.pbs?.status, "online");
  assert.equal(primary?.availableBytes, 350);
  assert.notEqual(primary?.availableBytes, (primary?.totalBytes ?? 0) - (primary?.usedBytes ?? 0));
  assert.equal(primary?.restorePoints, 3);
  assert.equal(data.pbs?.protectedGuests, 2);
  assert.equal(data.pbs?.verifiedSnapshots, 4);
  assert.equal(data.pbs?.verificationTotal, 5);
  assert.equal(data.pbs?.verificationResult, "warning");
  assert.equal(data.pbs?.lastVerificationAt, new Date(1_720_000_050_000).toISOString());
  assert.equal(data.pbs?.garbageCollectionResult, "success");
  assert.equal(data.pbs?.lastGarbageCollectionAt, new Date(1_720_000_100_000).toISOString());
  assert.equal(data.pbs?.reclaimedBytes, 700);
  const pbsRequests = requests.filter(({ url }) => url.startsWith("https://pbs.example/"));
  assert.ok(pbsRequests.every(({ authorization, insecure }) => authorization === "PBSAPIToken=pbs-concealed" && insecure !== true));
});

test("PBS snapshot failure preserves datastore capacity and the canonical backup ledger", async () => {
  const pveUpid = "UPID:demo-node-a:vzdump:root@pam:";
  const pbsUpid = "UPID:backup-demo:backup:primary-demo\\x3avm-501:root@pam:";
  const collector = createBackupCollector({
    pveUrl: "https://pve.example",
    pveToken: "pve-concealed",
    pbs: { url: "https://pbs.example", token: "pbs-concealed" },
  }, async (url) => {
    if (url === "https://pve.example/api2/json/cluster/tasks") return { data: [
      { type: "vzdump", node: "demo-node-a", upid: pveUpid, starttime: 2_000, endtime: 2_010, status: "OK" },
    ] };
    if (url.includes(encodeURIComponent(pveUpid))) return { data: [{ t: "INFO: Starting Backup of VM 501 (qemu)" }] };
    if (url.endsWith("/tasks?limit=100")) return { data: [
      { node: "backup-demo", upid: pbsUpid, worker_type: "backup", starttime: 2_000, endtime: 2_010, status: "OK" },
    ] };
    if (url.includes(encodeURIComponent(pbsUpid))) return { data: [{ t: "Upload size: 42" }] };
    if (url.endsWith("/admin/datastore")) return { data: [{ store: "primary-demo", "mount-status": "mounted" }] };
    if (url.endsWith("/admin/datastore/primary-demo/status")) return { data: { used: 600, avail: 350, total: 1_000 } };
    if (url.endsWith("/admin/datastore/primary-demo/snapshots")) throw new Error("snapshot audit temporarily unavailable");
    if (url.endsWith("/admin/verify") || url.endsWith("/admin/gc")) return { data: [] };
    throw new Error(`Unexpected request: ${url}`);
  });

  const data = await collector.collect({ signal: new AbortController().signal, now: new Date() });
  const backup = data.jobs.find((job) => job.source === "Proxmox VE + PBS");
  assert.equal(backup?.result, "success");
  assert.equal(backup?.detail, "1 guest · stored in PBS");
  assert.equal(data.pbs?.status, "degraded");
  assert.equal(data.pbs?.datastores[0]?.availableBytes, 350);
  assert.equal(data.pbs?.datastores[0]?.restorePoints, null);
  assert.equal(data.pbs?.protectedGuests, null);
  assert.equal(data.pbs?.verifiedSnapshots, null);
  assert.equal(data.pbs?.verificationTotal, null);
});

test("PBS task-history failure does not erase a healthy datastore overview", async () => {
  const collector = createBackupCollector({
    pveUrl: "https://pve.example",
    pveToken: "pve-concealed",
    pbs: { url: "https://pbs.example", token: "pbs-concealed" },
  }, async (url) => {
    if (url === "https://pve.example/api2/json/cluster/tasks") return { data: [] };
    if (url.endsWith("/tasks?limit=100")) throw new Error("task history unavailable");
    if (url.endsWith("/admin/datastore")) return { data: [{ store: "primary-demo", "mount-status": "mounted" }] };
    if (url.endsWith("/admin/datastore/primary-demo/status")) return { data: { used: 600, avail: 350, total: 1_000 } };
    if (url.endsWith("/admin/datastore/primary-demo/snapshots")) return { data: [] };
    if (url.endsWith("/admin/verify") || url.endsWith("/admin/gc")) return { data: [] };
    throw new Error(`Unexpected request: ${url}`);
  });

  const data = await collector.collect({ signal: new AbortController().signal, now: new Date() });
  assert.equal(data.pbs?.serverName, "PBS");
  assert.equal(data.pbs?.status, "online");
  assert.equal(data.pbs?.datastores[0]?.availableBytes, 350);
  assert.equal(data.jobs.find((job) => job.source === "Proxmox VE + PBS")?.message, "PVE status unavailable");
});

test("PBS incremental size sums upload statistics without counting virtual disk size", () => {
  assert.equal(pbsIncrementalBytes({ data: [
    { t: "Size: 3758096384" },
    { t: "Upload size: 4194304 (0%)" },
    { t: "Upload size: 2097152 (1%)" },
  ] }), 6_291_456);
  assert.equal(pbsIncrementalBytes({ data: [{ t: "TASK OK" }] }), null);
});

test("TrueNAS storage uses root-dataset usable capacity without exposing pool names", () => {
  const data = normalizeTrueNasStorage(
    { hostname: "demo-storage" },
    [{ name: "private-pool-name", status: "ONLINE", size: 10_000, allocated: 6_000, free: 4_000 }],
    [{ id: "private-pool-name", used: { parsed: 6_000 }, available: { parsed: 3_500 } }],
  );
  assert.equal(data.serverName, "demo-storage");
  assert.equal(data.health, "online");
  assert.equal(data.usedBytes, 6_000);
  assert.equal(data.availableBytes, 3_500);
  assert.equal(data.totalBytes, 9_500);
  assert.equal(data.poolsOnline, 1);
  assert.doesNotMatch(JSON.stringify(data), /private-pool-name/);
  assert.equal(normalizeTrueNasStorage({ hostname: "demo-storage" }, [{ status: "DEGRADED", allocated: 60, free: 40 }]).health, "degraded");
});

test("TrueNAS storage collector uses read-only bearer requests for system, pool, and dataset data", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const collector = createTrueNasStorageCollector("https://truenas.example/", "concealed", async (url, init) => {
    const headers = new Headers(init.headers);
    requests.push({ url, authorization: headers.get("authorization") });
    if (url.endsWith("/system/info")) return { hostname: "demo-storage" };
    if (url.endsWith("/pool")) return [{ name: "private-pool-name", status: "ONLINE", allocated: 600, free: 400 }];
    return [{ id: "private-pool-name", used: { parsed: 60 }, available: { parsed: 40 } }];
  });
  const data = await collector.collect({ signal: new AbortController().signal, now: new Date() });
  assert.equal(data.totalBytes, 100);
  assert.deepEqual(requests.map(({ url }) => url), [
    "https://truenas.example/api/v2.0/system/info",
    "https://truenas.example/api/v2.0/pool",
    "https://truenas.example/api/v2.0/pool/dataset",
  ]);
  assert.ok(requests.every(({ authorization }) => authorization === "Bearer concealed"));
});

test("Uptime Kuma public page maps latest heartbeat posture", () => {
  const posture = normalizeUptimeKuma({ publicGroupList: [{ monitorList: [{ id: 1, name: "Demo service" }] }] }, { heartbeatList: { "1": [{ status: 1, time: "2030-01-15T01:00:00.000Z", ping: 20 }] } });
  assert.equal(posture.healthy, 1);
  assert.equal(posture.down, 0);
});
