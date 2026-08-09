import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { bandwidthDataSchema, rackPowerDataSchema, type PanelData } from "../contracts/dashboard.js";
import { boundedText, finiteNumber, integer, type Collector } from "./collector.js";
import {
  createUniFiReadClient,
  type UniFiOptions,
  type UniFiRead,
} from "./unifi-client.js";

export type UniFiPduOptions = UniFiOptions & { macAddress: string; statePath?: string };
type UnknownRecord = Record<string, unknown>;
type BandwidthSample = PanelData<"bandwidth">["samples"][number];
export type PowerSample = { sampledAt: number; watts: number };

const ROLLING_POWER_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_PERSISTED_POWER_SAMPLES = 3_000;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

export function normalizeUniFiHealth(input: unknown, samples: BandwidthSample[], sampledAt = new Date()): PanelData<"bandwidth"> {
  const body = record(input);
  const rows = Array.isArray(body.data) ? body.data : Array.isArray(input) ? input : [];
  const wan = rows.map(record).find((row) => row.subsystem === "wan");
  if (!wan) throw new Error("UniFi WAN subsystem is unavailable");
  const downloadMbps = Math.max(0, finiteNumber(wan["rx_bytes-r"]) * 8 / 1_000_000);
  const uploadMbps = Math.max(0, finiteNumber(wan["tx_bytes-r"]) * 8 / 1_000_000);
  samples.push({ sampledAt: sampledAt.toISOString(), downloadMbps, uploadMbps });
  if (samples.length > 48) samples.splice(0, samples.length - 48);
  return bandwidthDataSchema.parse({ downloadMbps, uploadMbps, samples: [...samples] });
}

export function updateRollingPowerAverage(
  samples: PowerSample[],
  watts: number,
  sampledAt: Date,
  windowMs = ROLLING_POWER_WINDOW_MS,
): { watts: number; sampleMinutes: number } {
  const timestamp = sampledAt.getTime();
  const latest = samples.at(-1);
  if (latest && timestamp < latest.sampledAt) samples.splice(0);
  if (samples.at(-1)?.sampledAt === timestamp) {
    samples[samples.length - 1] = { sampledAt: timestamp, watts };
  } else {
    samples.push({ sampledAt: timestamp, watts });
  }

  const windowStart = timestamp - windowMs;
  while (samples.length > 1 && samples[1]!.sampledAt <= windowStart) samples.shift();
  const coverageStart = Math.max(windowStart, samples[0]?.sampledAt ?? timestamp);
  let wattMilliseconds = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const segmentStart = Math.max(coverageStart, sample.sampledAt);
    const segmentEnd = Math.min(timestamp, samples[index + 1]?.sampledAt ?? timestamp);
    if (segmentEnd > segmentStart) wattMilliseconds += sample.watts * (segmentEnd - segmentStart);
  }
  const coveredMilliseconds = Math.max(0, timestamp - coverageStart);
  return {
    watts: coveredMilliseconds > 0 ? wattMilliseconds / coveredMilliseconds : watts,
    sampleMinutes: Math.min(windowMs, coveredMilliseconds) / 60_000,
  };
}

export async function loadPersistedPowerSamples(
  statePath: string,
  now: Date,
  windowMs = ROLLING_POWER_WINDOW_MS,
): Promise<PowerSample[]> {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8")) as { version?: unknown; samples?: unknown };
    if (state.version !== 1 || !Array.isArray(state.samples)) return [];
    const timestamp = now.getTime();
    const windowStart = timestamp - windowMs;
    return state.samples
      .map((sample) => sample && typeof sample === "object" ? sample as Record<string, unknown> : {})
      .map((sample) => ({ sampledAt: Number(sample.sampledAt), watts: Number(sample.watts) }))
      .filter((sample) => Number.isFinite(sample.sampledAt)
        && Number.isFinite(sample.watts)
        && sample.watts >= 0
        && sample.sampledAt >= windowStart
        && sample.sampledAt <= timestamp)
      .sort((left, right) => left.sampledAt - right.sampledAt)
      .slice(-MAX_PERSISTED_POWER_SAMPLES);
  } catch {
    return [];
  }
}

export async function persistPowerSamples(statePath: string, samples: PowerSample[]): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  const state = JSON.stringify({ version: 1, samples: samples.slice(-MAX_PERSISTED_POWER_SAMPLES) });
  await writeFile(temporaryPath, state, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, statePath);
}

export function normalizeUniFiPdu(
  input: unknown,
  rolling?: { watts: number; sampleMinutes: number },
): PanelData<"rackPower"> {
  const body = record(input);
  const device = record(body.device ?? (Array.isArray(body.data) ? body.data[0] : input));
  const outletRows = Array.isArray(device.outlet_table) ? device.outlet_table.map(record) : [];
  const metered = outletRows
    .filter((outlet) => outlet.outlet_power !== undefined && outlet.outlet_power !== null)
    .map((outlet) => {
      const index = integer(outlet.index);
      return {
        index,
        name: boundedText(outlet.name, 80) || `Outlet ${index}`,
        watts: Math.max(0, finiteNumber(outlet.outlet_power)),
        currentAmps: Math.max(0, finiteNumber(outlet.outlet_current)),
        powerFactor: Math.min(1, Math.max(0, finiteNumber(outlet.outlet_power_factor))),
        relayOn: outlet.relay_state === true,
      };
    })
    .sort((left, right) => right.watts - left.watts || left.index - right.index);
  if (!metered.length) throw new Error("UniFi PDU metered outlets are unavailable");

  const summedWatts = metered.reduce((sum, outlet) => sum + outlet.watts, 0);
  const firstMetered = outletRows.find((outlet) => outlet.outlet_voltage !== undefined);
  const currentWatts = Math.max(0, finiteNumber(device.outlet_ac_power_consumption, summedWatts));
  return rackPowerDataSchema.parse({
    deviceName: boundedText(device.name ?? "Rack PDU", 80) || "Rack PDU",
    currentWatts,
    rolling24hAverageWatts: rolling?.watts ?? currentWatts,
    rolling24hSampleMinutes: rolling?.sampleMinutes ?? 0,
    capacityWatts: Math.max(1, finiteNumber(device.outlet_ac_power_budget, 1_875)),
    voltage: Math.max(0, finiteNumber(firstMetered?.outlet_voltage)),
    meteredOutlets: metered.length,
    outlets: metered,
  });
}

export function createUniFiCollector(
  options: UniFiOptions,
  read: UniFiRead = createUniFiReadClient(options),
): Collector<"bandwidth"> {
  const samples: BandwidthSample[] = [];
  return {
    name: "UniFi WAN bandwidth",
    panel: "bandwidth",
    source: "UniFi Network",
    intervalMs: 5_000,
    staleAfterMs: 20_000,
    timeoutMs: 3_000,
    required: true,
    enabled: Boolean(options.username && options.password),
    schema: bandwidthDataSchema,
    collect: async ({ signal, now }) => normalizeUniFiHealth(
      await read("/stat/health", signal),
      samples,
      now,
    ),
  };
}

export function createUniFiPduCollector(
  options: UniFiPduOptions,
  read: UniFiRead = createUniFiReadClient(options),
): Collector<"rackPower"> {
  const mac = options.macAddress.toLowerCase();
  const powerSamples: PowerSample[] = [];
  let stateLoaded = false;
  return {
    name: "UniFi rack PDU",
    panel: "rackPower",
    source: "UniFi PDU",
    intervalMs: 30_000,
    staleAfterMs: 120_000,
    timeoutMs: 5_000,
    required: true,
    enabled: Boolean(options.username && options.password && mac),
    schema: rackPowerDataSchema,
    collect: async ({ signal, now }) => {
      if (!stateLoaded) {
        if (options.statePath) {
          powerSamples.push(...await loadPersistedPowerSamples(options.statePath, now));
        }
        stateLoaded = true;
      }
      const snapshot = normalizeUniFiPdu(
        await read(`/stat/device/${encodeURIComponent(mac)}`, signal),
      );
      const rolling = updateRollingPowerAverage(powerSamples, snapshot.currentWatts, now);
      if (options.statePath) {
        await persistPowerSamples(options.statePath, powerSamples);
      }
      return rackPowerDataSchema.parse({
        ...snapshot,
        rolling24hAverageWatts: rolling.watts,
        rolling24hSampleMinutes: rolling.sampleMinutes,
      });
    },
  };
}

export function createUniFiCollectors(
  options: UniFiPduOptions,
  read: UniFiRead = createUniFiReadClient(options),
): [Collector<"bandwidth">, Collector<"rackPower">] {
  return [
    createUniFiCollector(options, read),
    createUniFiPduCollector(options, read),
  ];
}
