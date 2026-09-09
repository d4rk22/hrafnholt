import type { DashboardSnapshot, PanelData } from "./contracts/dashboard.js";

// Hand-authored fiction and deterministic waveforms. No production input is read.
const TITLES = [
  "Signal at Dawn", "The Glass Tide", "Orbit of Ash", "A Quiet Latitude",
  "Velvet Meridian", "The Last Lighthouse", "Copper Skies", "After the Rain",
  "Paper Satellites", "The Blue Archive", "Between Two Suns", "Winter Frequency",
  "The Long Return", "Echoes in Amber", "Tidepool City", "Aster Station",
];
const round = (n: number) => Math.round(n * 100) / 100;
const iso = (n: number) => new Date(n).toISOString();
type History = NonNullable<PanelData<"plexHost">["history"]>;
type Window = NonNullable<History["windows"]["1w"]>;

function showcaseHistory(now: number, seconds: number): Window {
  const bucketSeconds = Math.floor(seconds / 239);
  const points = Array.from({ length: 240 }, (_, i) => {
    const at = now - (239 - i) * bucketSeconds * 1000;
    const hours = at / 3_600_000;
    const evening = Math.pow((1 + Math.sin(hours * Math.PI / 12 - 2)) / 2, 3);
    const burst = Math.pow((1 + Math.sin(hours * 2.31)) / 2, 8);
    const ripple = (1 + Math.sin(hours * 5.7)) / 2;
    const streamAverage = round(1.5 + evening * 5 + burst * 2);
    const videoTranscodeAverage = round(.4 + evening * 2.4 + burst);
    return {
      sampledAt: iso(at),
      encodePercent: round(4 + evening * 27 + burst * 14 + ripple * 3),
      decodePercent: round(3 + evening * 14 + burst * 8),
      cpuPercent: round(7 + evening * 14 + burst * 6 + ripple * 3),
      ramPercent: round(22 + evening * 5 + burst * 2),
      vramPercent: round(12 + evening * 14 + burst * 3),
      temperatureC: round(42 + evening * 15 + burst * 5),
      streamAverage, streamPeak: Math.ceil(streamAverage + 1),
      videoTranscodeAverage, videoTranscodePeak: Math.ceil(videoTranscodeAverage),
    };
  });
  const p95 = (key: "encodePercent" | "decodePercent" | "cpuPercent") =>
    points.map(p => p[key]).sort((a, b) => a - b)[Math.ceil(points.length * .95) - 1]!;
  const peak = (key: "ramPercent" | "vramPercent" | "temperatureC") =>
    points.reduce((best, point) => point[key] > best[key] ? point : best);
  return {
    requestedWindowSeconds: seconds, sampledFrom: points[0]!.sampledAt,
    sampledTo: iso(now), bucketSeconds, analysisSamples: points.length, points,
    summary: {
      encodeP95Percent: p95("encodePercent"), decodeP95Percent: p95("decodePercent"), cpuP95Percent: p95("cpuPercent"),
      ramPeakPercent: peak("ramPercent").ramPercent, ramPeakAt: peak("ramPercent").sampledAt,
      vramPeakPercent: peak("vramPercent").vramPercent, vramPeakAt: peak("vramPercent").sampledAt,
      temperaturePeakC: peak("temperatureC").temperatureC, temperaturePeakAt: peak("temperatureC").sampledAt,
    },
  };
}

export function populateShowcase(snapshot: DashboardSnapshot): void {
  const p = snapshot.panels;
  const now = Date.parse(snapshot.generatedAt);
  const streams = p.streams.data!;
  const locations = [
    { label: "Cedar Bay · Fictional", countryCode: "US", latitude: 45.3, longitude: -123.3 },
    { label: "Juniper Ridge · Fictional", countryCode: "US", latitude: 40.5, longitude: -115.4 },
    { label: "Silver Mesa · Fictional", countryCode: "US", latitude: 35.8, longitude: -107.5 },
    { label: "Lake Ember · Fictional", countryCode: "US", latitude: 43.2, longitude: -111.2 },
  ];
  streams.streams = locations.map((location, i) => ({
    ...streams.streams[i % 3]!, id: `showcase-stream-${i}`, user: `showcase-viewer-${i}`,
    title: TITLES[i]!, context: i % 2 ? `${2030 - i % 4} · Fictional feature` : `S02E0${i + 1} · The next horizon`,
    progressPercent: [62, 28, 79, 43][i]!, bitrateMbps: [12, 8, 6, 4][i]!,
    platform: ["Living room TV", "Tablet", "Web browser", "Media player"][i]!, location,
    playbackMode: i % 2 ? "transcode" : "direct", transcodeMode: i % 2 ? "hardware" : "none",
    playbackLabel: i % 2 ? "HW transcode · 1080p" : "Direct play · 1080p",
  }));
  streams.total = streams.streams.length;
  streams.transcodes = 2;
  streams.totalBitrateMbps = streams.streams.reduce((sum, stream) => sum + stream.bitrateMbps, 0);

  const traffic = p.bandwidth.data!;
  traffic.samples = Array.from({ length: 48 }, (_, i) => ({
    sampledAt: iso(now - (47 - i) * 5000),
    uploadMbps: round(32 + 16 * Math.pow(Math.sin(i * .67), 6) + 4 * Math.sin(i * 1.7)),
    downloadMbps: round(74 + 45 * Math.pow(Math.sin(i * .43), 4) + 18 * Math.sin(i * 1.13)),
  }));
  Object.assign(traffic, { uploadMbps: traffic.samples.at(-1)!.uploadMbps, downloadMbps: traffic.samples.at(-1)!.downloadMbps });

  const host = p.plexHost.data!;
  host.host = "showcase-media";
  host.gpuName = "Demo GPU · 8 GB";
  host.hardwareSessions = 2;
  host.history = {
    windows: { "1h": showcaseHistory(now, 3600), "1d": showcaseHistory(now, 86400), "1w": showcaseHistory(now, 604800), "1m": showcaseHistory(now, 2592000) },
    upgradePressure30d: { pressure: "comfortable", constraint: null },
  };
  const current = host.history.windows["1h"]!.points.at(-1)!;
  Object.assign(host, {
    gpuPercent: current.encodePercent, encodePercent: current.encodePercent, decodePercent: current.decodePercent,
    cpuPercent: current.cpuPercent, ramUsedBytes: Math.round(host.ramTotalBytes * current.ramPercent / 100),
    vramUsedBytes: Math.round(host.vramTotalBytes * current.vramPercent / 100), temperatureC: current.temperatureC,
  });

  p.episodes.data!.episodes = Array.from({ length: 18 }, (_, i) => ({
    id: `showcase-episode-${i}`, library: i % 3 ? "Television" : "Animation",
    show: TITLES[i % TITLES.length]!, context: `S0${i % 3 + 1}E${String(i + 1).padStart(2, "0")} · ${["The arrival", "Open water", "New constellations", "Homeward"][i % 4]}`,
    airAt: iso(now - 8 * 3_600_000 + i * 3_600_000), quality: "WEB-1080p", state: i < 9 ? "grabbed" : "waiting",
  }));
  p.movies.data!.movies = TITLES.map((title, i) => ({
    id: `showcase-movie-${i + 1}`, library: i % 3 ? "Cinema" : "Cinema 4K", title, year: 2030 - i % 4,
    addedAt: iso(now - i * 3_600_000), hasFile: true, format: i % 3 ? "WEB-1080p" : "BluRay-2160p",
    posterUrl: `/assets/demo-posters/${i + 1}.svg`,
  }));
  p.sabQueues.data!.instances = [
    { name: "Television", client: "sabnzbd", library: "TV", paused: false, speedBytesPerSecond: 8_000_000, timeLeftSeconds: 400,
      items: [{ name: "Signal.at.Dawn.S02E04", remainingBytes: 3_200_000_000, progressPercent: 62, status: "Downloading" }] },
    { name: "Cinema", client: "sabnzbd", library: "Movies", paused: false, speedBytesPerSecond: 0, timeLeftSeconds: 0, items: [] },
    { name: "Archive", client: "qbittorrent", library: "Independent films", paused: false, speedBytesPerSecond: 1_000_000, timeLeftSeconds: 900,
      items: [{ name: "Paper.Satellites.2030", remainingBytes: 900_000_000, progressPercent: 34, status: "Downloading" }] },
    { name: "Animation", client: "qbittorrent", library: "Animation", paused: false, speedBytesPerSecond: 0, timeLeftSeconds: 0, items: [] },
  ];
  const services = ["gateway", "catalog", "library", "calendar", "worker", "search", "metrics", "cache", "photos", "notes", "queue", "archive", "reader", "index", "status", "sync", "proxy", "media", "ingest", "dashboard"];
  p.arcane.data!.environments = ["primary", "secondary"].map((name, i) => ({
    id: `showcase-${name}`, name: `Demo ${name}`, status: "online", connected: true,
    containers: services.map(service => ({ name: `${service}-${i + 1}`, state: "running", status: "Synthetic healthy" })),
  }));
  p.arcane.data!.total = 40;
  p.arcane.data!.running = 40;

  const power = p.power.data!;
  Object.assign(power, {
    serverTodayKwh: 7.2, acTodayKwh: 1.8, todayKwh: 9, houseTodayKwh: 28.8,
    serverMonthKwh: 216, acMonthKwh: 54, monthKwh: 270, houseMonthKwh: 900,
    projectedKwh: 540, projectedHouseKwh: 1800, monthCost: 40.5, projectedCost: 81, projectedHouseCost: 270,
    serverPercentOfHouse: 30,
    topConsumers: [
      { name: "Equipment room", kwh: 7.2 }, { name: "EV charger", kwh: 6.8 },
      { name: "Heat pump", kwh: 4.6 }, { name: "Kitchen", kwh: 3.8 },
      { name: "Room cooling", kwh: 1.8 }, { name: "Refrigerator", kwh: 1.4 },
    ],
  });
  p.truenasStorage.data = { serverName: "Demo storage", health: "online", usedBytes: 72 * 2 ** 40, availableBytes: 24 * 2 ** 40, totalBytes: 96 * 2 ** 40, poolsOnline: 2, poolsTotal: 2 };
  p.backups.data!.pbs!.garbageCollectionResult = "running";
  p.backups.data!.pbs!.lastGarbageCollectionAt = iso(now - 12 * 60_000);
  p.watchlist.data!.items = [{ id: "showcase-maintenance", severity: "info", title: "Scheduled storage maintenance", detail: "Fictional example · no action is required.", ageLabel: "demo only" }];
}
