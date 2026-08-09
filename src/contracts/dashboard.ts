import { z } from "zod";

export const panelStatusSchema = z.enum(["ok", "stale", "error", "disabled"]);
export const demoStateSchema = z.enum([
  "healthy",
  "empty",
  "stale",
  "degraded",
  "collector-failure",
  "privacy",
]);

export const streamSchema = z.object({
  id: z.string().max(160),
  user: z.string().max(80),
  title: z.string().max(160),
  context: z.string().max(200),
  progressPercent: z.number().min(0).max(100),
  playbackMode: z.enum(["direct", "transcode", "copy", "unknown"]),
  transcodeMode: z.enum(["none", "software", "partial", "hardware"]),
  playbackLabel: z.string().max(80),
  bitrateMbps: z.number().nonnegative(),
  platform: z.string().min(1).max(60).nullable().default(null),
  location: z.object({
    label: z.string().max(120),
    countryCode: z.string().regex(/^[A-Z]{2}$/).nullable(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
  }),
});

export const streamsDataSchema = z.object({
  total: z.number().int().nonnegative(),
  transcodes: z.number().int().nonnegative(),
  totalBitrateMbps: z.number().nonnegative(),
  streams: z.array(streamSchema).max(24),
});

export const bandwidthDataSchema = z.object({
  downloadMbps: z.number().nonnegative(),
  uploadMbps: z.number().nonnegative(),
  samples: z.array(z.object({
    sampledAt: z.iso.datetime(),
    downloadMbps: z.number().nonnegative(),
    uploadMbps: z.number().nonnegative(),
  })).max(48),
});

export const plexHostHistorySchema = z.object({
  requestedWindowSeconds: z.number().int().positive(),
  sampledFrom: z.iso.datetime(),
  sampledTo: z.iso.datetime(),
  bucketSeconds: z.number().int().positive(),
  analysisSamples: z.number().int().positive(),
  points: z.array(z.object({
    sampledAt: z.iso.datetime(),
    encodePercent: z.number().min(0).max(100),
    decodePercent: z.number().min(0).max(100),
    cpuPercent: z.number().min(0).max(100),
    ramPercent: z.number().min(0).max(100),
    vramPercent: z.number().min(0).max(100),
    temperatureC: z.number(),
    streamAverage: z.number().nonnegative().nullable(),
    streamPeak: z.number().nonnegative().nullable(),
    videoTranscodeAverage: z.number().nonnegative().nullable(),
    videoTranscodePeak: z.number().nonnegative().nullable(),
  })).min(1).max(240),
  summary: z.object({
    encodeP95Percent: z.number().min(0).max(100),
    decodeP95Percent: z.number().min(0).max(100),
    cpuP95Percent: z.number().min(0).max(100),
    ramPeakPercent: z.number().min(0).max(100),
    vramPeakPercent: z.number().min(0).max(100),
    temperaturePeakC: z.number(),
    pressure: z.enum(["comfortable", "watch", "pressured"]),
    constraint: z.enum(["gpu_encoder", "cpu", "host_ram", "vram", "cooling"]).nullable(),
  }),
});

export const plexHostDataSchema = z.object({
  host: z.string().max(80),
  gpuName: z.string().max(100),
  gpuTensorCores: z.number().int().positive().nullable(),
  cpuCores: z.number().int().positive(),
  gpuPercent: z.number().min(0).max(100),
  encodePercent: z.number().min(0).max(100),
  decodePercent: z.number().min(0).max(100),
  vramUsedBytes: z.number().nonnegative(),
  vramTotalBytes: z.number().positive(),
  temperatureC: z.number(),
  powerWatts: z.number().nonnegative(),
  cpuPercent: z.number().min(0).max(100),
  ramUsedBytes: z.number().nonnegative(),
  ramTotalBytes: z.number().positive(),
  hardwareSessions: z.number().int().nonnegative(),
  history: plexHostHistorySchema.nullable(),
});

export const powerDataSchema = z.object({
  serverWatts: z.number().nonnegative(),
  acWatts: z.number().nonnegative(),
  houseWatts: z.number().nonnegative(),
  totalWatts: z.number().nonnegative(),
  serverTodayKwh: z.number().nonnegative(),
  acTodayKwh: z.number().nonnegative(),
  todayKwh: z.number().nonnegative(),
  houseTodayKwh: z.number().nonnegative(),
  serverMonthKwh: z.number().nonnegative(),
  acMonthKwh: z.number().nonnegative(),
  monthKwh: z.number().nonnegative(),
  houseMonthKwh: z.number().nonnegative(),
  projectedKwh: z.number().nonnegative(),
  projectedHouseKwh: z.number().nonnegative(),
  monthCost: z.number().nonnegative(),
  projectedCost: z.number().nonnegative(),
  projectedHouseCost: z.number().nonnegative(),
  rate: z.number().nonnegative(),
  rateLabel: z.string().max(80),
  daysInMonth: z.number().int().min(28).max(31),
  serverPercentOfHouse: z.number().min(0).max(100),
});

export const rackPowerDataSchema = z.object({
  deviceName: z.string().min(1).max(80),
  currentWatts: z.number().nonnegative(),
  rolling24hAverageWatts: z.number().nonnegative(),
  rolling24hSampleMinutes: z.number().min(0).max(1_440),
  capacityWatts: z.number().positive(),
  voltage: z.number().nonnegative(),
  meteredOutlets: z.number().int().positive().max(32),
  outlets: z.array(z.object({
    index: z.number().int().positive().max(64),
    name: z.string().min(1).max(80),
    watts: z.number().nonnegative(),
    currentAmps: z.number().nonnegative(),
    powerFactor: z.number().min(0).max(1),
    relayOn: z.boolean(),
  })).min(1).max(32),
});

export const upsDataSchema = z.object({
  batteryStatus: z.enum(["unknown", "normal", "low", "depleted"]),
  secondsOnBattery: z.number().int().nonnegative(),
  runtimeMinutes: z.number().int().nonnegative(),
  chargePercent: z.number().min(0).max(100),
  loadPercent: z.number().min(0).max(100),
});

export const sabQueueItemSchema = z.object({
  name: z.string().max(160),
  remainingBytes: z.number().nonnegative(),
  progressPercent: z.number().min(0).max(100),
  status: z.string().max(60),
});

export const sabQueuesDataSchema = z.object({
  instances: z.array(z.object({
    name: z.string().max(40),
    client: z.enum(["sabnzbd", "qbittorrent"]),
    library: z.string().min(1).max(80),
    paused: z.boolean(),
    speedBytesPerSecond: z.number().nonnegative(),
    timeLeftSeconds: z.number().int().nonnegative(),
    items: z.array(sabQueueItemSchema).max(12),
  })).min(1).max(24),
});

export const episodesDataSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  episodes: z.array(z.object({
    id: z.string().max(120),
    library: z.string().min(1).max(80),
    show: z.string().max(160),
    context: z.string().max(180),
    airAt: z.iso.datetime(),
    quality: z.string().max(80),
    state: z.enum(["grabbed", "waiting", "missing", "airing"]),
  })).max(30),
});

export const moviesDataSchema = z.object({
  movies: z.array(z.object({
    id: z.string().max(120),
    library: z.string().min(1).max(80),
    title: z.string().max(160),
    year: z.number().int().min(1888).max(2200).nullable(),
    addedAt: z.iso.datetime(),
    hasFile: z.boolean(),
    format: z.string().max(80),
    posterUrl: z.string().regex(/^\/api\/posters\/radarr\/[a-z][a-z0-9-]{0,39}\/\d{1,10}$/).nullable(),
  })).max(16),
});

export const arcaneDataSchema = z.object({
  total: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  environments: z.array(z.object({
    id: z.string().max(100),
    name: z.string().max(80),
    status: z.enum(["online", "offline", "standby", "unknown"]),
    connected: z.boolean(),
    containers: z.array(z.object({
      name: z.string().max(120),
      state: z.enum(["running", "exited", "paused", "unknown"]),
      status: z.string().max(160),
    })).max(100),
  })).max(10),
});

export const proxmoxDataSchema = z.object({
  totalMemoryBytes: z.number().nonnegative(),
  nodes: z.array(z.object({
    name: z.string().max(80),
    role: z.string().max(100),
    cpuModel: z.string().max(120).nullable(),
    status: z.enum(["online", "down", "unknown"]),
    cpuPercent: z.number().min(0).max(100),
    memoryUsedBytes: z.number().nonnegative(),
    memoryTotalBytes: z.number().nonnegative(),
    storageUsedBytes: z.number().nonnegative(),
    storageTotalBytes: z.number().nonnegative(),
    guests: z.number().int().nonnegative(),
  })).max(12),
});

export const truenasStorageDataSchema = z.object({
  serverName: z.string().min(1).max(80),
  health: z.enum(["online", "degraded", "offline", "unknown"]),
  usedBytes: z.number().nonnegative(),
  availableBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative(),
  poolsOnline: z.number().int().nonnegative(),
  poolsTotal: z.number().int().nonnegative(),
});

export const backupsDataSchema = z.object({
  pbs: z.object({
    serverName: z.string().min(1).max(80),
    status: z.enum(["online", "degraded", "maintenance", "unavailable"]),
    datastores: z.array(z.object({
      name: z.string().min(1).max(80),
      status: z.enum(["online", "degraded", "maintenance", "unavailable"]),
      usedBytes: z.number().nonnegative(),
      availableBytes: z.number().nonnegative(),
      totalBytes: z.number().positive(),
      restorePoints: z.number().int().nonnegative().nullable(),
    })).min(1).max(8),
    protectedGuests: z.number().int().nonnegative().nullable(),
    verifiedSnapshots: z.number().int().nonnegative().nullable(),
    verificationTotal: z.number().int().nonnegative().nullable(),
    lastVerificationAt: z.iso.datetime().nullable(),
    verificationResult: z.enum(["success", "warning", "failure", "running", "unavailable"]),
    lastGarbageCollectionAt: z.iso.datetime().nullable(),
    garbageCollectionResult: z.enum(["success", "warning", "failure", "running", "unavailable"]),
    reclaimedBytes: z.number().nonnegative().nullable(),
  }).optional(),
  jobs: z.array(z.object({
    id: z.string().max(120),
    name: z.string().max(120),
    detail: z.string().max(180),
    source: z.string().max(80),
    result: z.enum(["success", "warning", "failure", "running", "not_configured", "unavailable"]),
    lastRunAt: z.iso.datetime().nullable(),
    durationSeconds: z.number().int().nonnegative().nullable(),
    transferredBytes: z.number().nonnegative().nullable(),
    message: z.string().max(200).nullable(),
  })).max(24),
});

export const servicePostureDataSchema = z.object({
  healthy: z.number().int().nonnegative(),
  down: z.number().int().nonnegative(),
  monitors: z.array(z.object({
    id: z.string().max(100),
    name: z.string().max(120),
    status: z.enum(["up", "down", "pending", "maintenance", "unknown"]),
    pingMs: z.number().nonnegative().nullable(),
    observedAt: z.iso.datetime().nullable(),
  })).max(100),
});

export const watchlistDataSchema = z.object({
  items: z.array(z.object({
    id: z.string().max(120),
    severity: z.enum(["info", "warning", "critical"]),
    title: z.string().max(140),
    detail: z.string().max(240),
    ageLabel: z.string().max(40),
  })).max(20),
});

export function panelStateSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    status: panelStatusSchema,
    source: z.string().min(1).max(120),
    lastAttemptAt: z.iso.datetime().nullable(),
    lastSuccessAt: z.iso.datetime().nullable(),
    ageSeconds: z.number().nonnegative().nullable(),
    staleAfterSeconds: z.number().int().positive(),
    message: z.string().max(240).nullable(),
    data: dataSchema.nullable(),
  });
}

export const dashboardSnapshotSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  generatedAt: z.iso.datetime(),
  mode: z.enum(["fixture", "live"]),
  demoState: demoStateSchema.nullable(),
  panels: z.object({
    streams: panelStateSchema(streamsDataSchema),
    bandwidth: panelStateSchema(bandwidthDataSchema),
    plexHost: panelStateSchema(plexHostDataSchema),
    power: panelStateSchema(powerDataSchema),
    rackPower: panelStateSchema(rackPowerDataSchema),
    ups: panelStateSchema(upsDataSchema),
    sabQueues: panelStateSchema(sabQueuesDataSchema),
    episodes: panelStateSchema(episodesDataSchema),
    movies: panelStateSchema(moviesDataSchema),
    arcane: panelStateSchema(arcaneDataSchema),
    proxmox: panelStateSchema(proxmoxDataSchema),
    truenasStorage: panelStateSchema(truenasStorageDataSchema),
    backups: panelStateSchema(backupsDataSchema),
    servicePosture: panelStateSchema(servicePostureDataSchema),
    watchlist: panelStateSchema(watchlistDataSchema),
  }),
});

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;
export type DemoState = z.infer<typeof demoStateSchema>;
export type PanelKey = keyof DashboardSnapshot["panels"];
export type PanelData<K extends PanelKey> = NonNullable<DashboardSnapshot["panels"][K]["data"]>;
