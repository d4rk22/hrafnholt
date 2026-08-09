import { plexHostDataSchema, type PanelData } from "../contracts/dashboard.js";
import { boundedText, fetchJson, finiteNumber, type Collector, type JsonRequest } from "./collector.js";

type UnknownRecord = Record<string, unknown>;
type MetricRequest = { chart: string; dimension: string };
type NumericPoint = { sampledAt: number; value: number };
type PlexHistory = NonNullable<PanelData<"plexHost">["history"]>;
type PlexHistoryPoint = PlexHistory["points"][number];

const NETDATA_METRIC_KEYS = [
  "gpuPercent",
  "encodePercent",
  "decodePercent",
  "vramUsedBytes",
  "vramFreeBytes",
  "temperatureC",
  "powerWatts",
  "cpuPercent",
  "ramUsedMiB",
  "ramFreeMiB",
  "ramCachedMiB",
  "ramBuffersMiB",
] as const;
type NetdataMetricKey = typeof NETDATA_METRIC_KEYS[number];
export type NetdataMetricSelectors = Record<NetdataMetricKey, MetricRequest>;
type NetdataMetricDimensions = Record<NetdataMetricKey, string>;
const DEFAULT_METRIC_DIMENSIONS: NetdataMetricDimensions = {
  gpuPercent: "utilization",
  encodePercent: "encoder",
  decodePercent: "decoder",
  vramUsedBytes: "used",
  vramFreeBytes: "free",
  temperatureC: "temp",
  powerWatts: "power draw",
  cpuPercent: "__total__",
  ramUsedMiB: "used",
  ramFreeMiB: "free",
  ramCachedMiB: "cached",
  ramBuffersMiB: "buffers",
};
export type NetdataCollectorOptions = {
  metrics: NetdataMetricSelectors;
  gpuName?: string;
  gpuTensorCores?: number;
  workload?: { chart: string; startAt?: string };
  allowInsecureTls?: boolean;
  hostLabel?: string;
};

const HISTORY_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const HISTORY_ANALYSIS_POINTS = 1_440;
const HISTORY_DISPLAY_POINTS = 240;
const HISTORY_REFRESH_MS = 5 * 60 * 1_000;
const HISTORY_TIMEOUT_MS = 10_000;
const HISTORY_METRIC_KEYS = [
  "encodePercent",
  "decodePercent",
  "vramUsedBytes",
  "vramFreeBytes",
  "temperatureC",
  "cpuPercent",
  "ramUsedMiB",
  "ramFreeMiB",
  "ramCachedMiB",
  "ramBuffersMiB",
] as const;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function finiteOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function v1RowValue(labels: string[], row: unknown[], dimension: string | readonly string[]): number | null {
  if (dimension === "__total__") {
    const values = labels
      .map((label, index) => ({ label, value: finiteOrNull(row[index]) }))
      .filter(({ label, value }) => label !== "time" && label !== "guest" && label !== "guest_nice" && value !== null)
      .map(({ value }) => value as number);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  const dimensions = typeof dimension === "string" ? [dimension] : dimension;
  const index = labels.findIndex((label) => dimensions.includes(label));
  return index >= 0 ? finiteOrNull(row[index]) : null;
}

export function extractNetdataSeries(input: unknown, dimension: string | readonly string[]): NumericPoint[] {
  const body = record(input);
  const labels = Array.isArray(body.labels) ? body.labels.map(String) : [];
  const timeIndex = labels.findIndex((label) => label === "time");
  const rows = Array.isArray(body.data) ? body.data : [];
  if (timeIndex < 0 || labels.length === 0) return [];
  return rows
    .map((row) => Array.isArray(row) ? row as unknown[] : [])
    .map((row) => ({ sampledAt: finiteOrNull(row[timeIndex]), value: v1RowValue(labels, row, dimension) }))
    .filter((point): point is NumericPoint => point.sampledAt !== null && point.value !== null)
    .sort((left, right) => left.sampledAt - right.sampledAt);
}

function nearestValue(series: NumericPoint[], sampledAt: number, toleranceSeconds: number): number | null {
  let low = 0;
  let high = series.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const point = series[middle]!;
    if (point.sampledAt < sampledAt) low = middle + 1;
    else if (point.sampledAt > sampledAt) high = middle - 1;
    else return point.value;
  }
  const candidates = [series[low], series[high]].filter((point): point is NumericPoint => Boolean(point));
  const nearest = candidates.sort((left, right) => Math.abs(left.sampledAt - sampledAt) - Math.abs(right.sampledAt - sampledAt))[0];
  return nearest && Math.abs(nearest.sampledAt - sampledAt) <= toleranceSeconds ? nearest.value : null;
}

function percentile(values: number[], percentileValue: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ordered.length * percentileValue) - 1);
  return ordered[index] ?? 0;
}

function downsampleHistory(points: PlexHistoryPoint[], limit: number): PlexHistoryPoint[] {
  if (points.length <= limit) return points;
  const bucketSize = Math.ceil(points.length / limit);
  const result: PlexHistoryPoint[] = [];
  for (let index = 0; index < points.length; index += bucketSize) {
    const bucket = points.slice(index, index + bucketSize);
    const average = (key: "encodePercent" | "decodePercent" | "cpuPercent" | "ramPercent" | "vramPercent" | "temperatureC") => bucket.reduce((sum, point) => sum + point[key], 0) / bucket.length;
    const nullableValues = (key: "streamAverage" | "streamPeak" | "videoTranscodeAverage" | "videoTranscodePeak") => bucket
      .map((point) => point[key])
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const nullableAverage = (key: "streamAverage" | "videoTranscodeAverage") => {
      const values = nullableValues(key);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };
    const nullableMaximum = (key: "streamPeak" | "videoTranscodePeak") => {
      const values = nullableValues(key);
      return values.length ? Math.max(...values) : null;
    };
    result.push({
      sampledAt: bucket.at(-1)!.sampledAt,
      encodePercent: average("encodePercent"),
      decodePercent: average("decodePercent"),
      cpuPercent: average("cpuPercent"),
      ramPercent: average("ramPercent"),
      vramPercent: average("vramPercent"),
      temperatureC: average("temperatureC"),
      streamAverage: nullableAverage("streamAverage"),
      streamPeak: nullableMaximum("streamPeak"),
      videoTranscodeAverage: nullableAverage("videoTranscodeAverage"),
      videoTranscodePeak: nullableMaximum("videoTranscodePeak"),
    });
  }
  return result;
}

export function normalizeNetdataHistory(
  metrics: Record<string, unknown>,
  dimensions: NetdataMetricDimensions = DEFAULT_METRIC_DIMENSIONS,
  historyStartSeconds = Number.NEGATIVE_INFINITY,
): PlexHistory | null {
  const series = Object.fromEntries(HISTORY_METRIC_KEYS.map((key) => [key, extractNetdataSeries(metrics[key], dimensions[key])])) as Record<typeof HISTORY_METRIC_KEYS[number], NumericPoint[]>;
  const workloadAverageStreams = extractNetdataSeries(metrics.workloadAverage, ["streams", "all streams"]);
  const workloadAverageVideoTranscodes = extractNetdataSeries(metrics.workloadAverage, ["video_transcodes", "video transcodes"]);
  const workloadPeakStreams = extractNetdataSeries(metrics.workloadPeak, ["streams", "all streams"]);
  const workloadPeakVideoTranscodes = extractNetdataSeries(metrics.workloadPeak, ["video_transcodes", "video transcodes"]);
  const encoder = series.encodePercent.filter(
    ({ sampledAt }) => sampledAt >= historyStartSeconds,
  );
  if (encoder.length === 0) return null;
  const toleranceSeconds = Math.ceil(HISTORY_WINDOW_SECONDS / HISTORY_ANALYSIS_POINTS);
  const workloadToleranceSeconds = Math.max(1, Math.floor(toleranceSeconds / 2));
  const analysis = encoder.flatMap(({ sampledAt, value: encodePercent }) => {
    const decodePercent = nearestValue(series.decodePercent, sampledAt, toleranceSeconds);
    const cpuPercent = nearestValue(series.cpuPercent, sampledAt, toleranceSeconds);
    const vramUsed = nearestValue(series.vramUsedBytes, sampledAt, toleranceSeconds);
    const vramFree = nearestValue(series.vramFreeBytes, sampledAt, toleranceSeconds);
    const temperatureC = nearestValue(series.temperatureC, sampledAt, toleranceSeconds);
    const ramUsed = nearestValue(series.ramUsedMiB, sampledAt, toleranceSeconds);
    const ramFree = nearestValue(series.ramFreeMiB, sampledAt, toleranceSeconds);
    const ramCached = nearestValue(series.ramCachedMiB, sampledAt, toleranceSeconds);
    const ramBuffers = nearestValue(series.ramBuffersMiB, sampledAt, toleranceSeconds);
    if ([decodePercent, cpuPercent, vramUsed, vramFree, temperatureC, ramUsed, ramFree, ramCached, ramBuffers].some((value) => value === null)) return [];
    const vramTotal = (vramUsed as number) + (vramFree as number);
    const ramTotal = (ramUsed as number) + (ramFree as number) + (ramCached as number) + (ramBuffers as number);
    return [{
      sampledAt: new Date(sampledAt * 1_000).toISOString(),
      encodePercent: Math.min(100, Math.max(0, encodePercent)),
      decodePercent: Math.min(100, Math.max(0, decodePercent as number)),
      cpuPercent: Math.min(100, Math.max(0, cpuPercent as number)),
      ramPercent: Math.min(100, Math.max(0, ramTotal > 0 ? (ramUsed as number) / ramTotal * 100 : 0)),
      vramPercent: Math.min(100, Math.max(0, vramTotal > 0 ? (vramUsed as number) / vramTotal * 100 : 0)),
      temperatureC: temperatureC as number,
      streamAverage: nearestValue(workloadAverageStreams, sampledAt, workloadToleranceSeconds),
      streamPeak: nearestValue(workloadPeakStreams, sampledAt, workloadToleranceSeconds),
      videoTranscodeAverage: nearestValue(workloadAverageVideoTranscodes, sampledAt, workloadToleranceSeconds),
      videoTranscodePeak: nearestValue(workloadPeakVideoTranscodes, sampledAt, workloadToleranceSeconds),
    } satisfies PlexHistoryPoint];
  });
  if (analysis.length === 0) return null;

  const encodeP95Percent = percentile(analysis.map((point) => point.encodePercent), .95);
  const decodeP95Percent = percentile(analysis.map((point) => point.decodePercent), .95);
  const cpuP95Percent = percentile(analysis.map((point) => point.cpuPercent), .95);
  const ramPeakPercent = Math.max(...analysis.map((point) => point.ramPercent));
  const vramPeakPercent = Math.max(...analysis.map((point) => point.vramPercent));
  const temperaturePeakC = Math.max(...analysis.map((point) => point.temperatureC));
  const constraints = [
    { constraint: "gpu_encoder" as const, value: encodeP95Percent, watch: 60, review: 80 },
    { constraint: "cpu" as const, value: cpuP95Percent, watch: 65, review: 80 },
    { constraint: "host_ram" as const, value: ramPeakPercent, watch: 75, review: 90 },
    { constraint: "vram" as const, value: vramPeakPercent, watch: 75, review: 90 },
    { constraint: "cooling" as const, value: temperaturePeakC, watch: 75, review: 85 },
  ].map((candidate) => ({ ...candidate, score: candidate.value / candidate.review }));
  const pressured = constraints.filter((candidate) => candidate.value >= candidate.review).sort((left, right) => right.score - left.score);
  const watching = constraints.filter((candidate) => candidate.value >= candidate.watch).sort((left, right) => right.score - left.score);
  const pressure = pressured.length ? "pressured" : watching.length ? "watch" : "comfortable";
  const leading = pressured[0] ?? watching[0] ?? null;
  const firstTimestamp = Date.parse(analysis[0]!.sampledAt);
  const lastTimestamp = Date.parse(analysis.at(-1)!.sampledAt);
  const bucketSeconds = analysis.length > 1
    ? Math.max(1, Math.round((lastTimestamp - firstTimestamp) / (analysis.length - 1) / 1_000))
    : HISTORY_WINDOW_SECONDS;
  return {
    requestedWindowSeconds: HISTORY_WINDOW_SECONDS,
    sampledFrom: analysis[0]!.sampledAt,
    sampledTo: analysis.at(-1)!.sampledAt,
    bucketSeconds,
    analysisSamples: analysis.length,
    points: downsampleHistory(analysis, HISTORY_DISPLAY_POINTS),
    summary: {
      encodeP95Percent,
      decodeP95Percent,
      cpuP95Percent,
      ramPeakPercent,
      vramPeakPercent,
      temperaturePeakC,
      pressure,
      constraint: leading?.constraint ?? null,
    },
  };
}

export function extractNetdataDimension(input: unknown, dimension: string): number {
  const body = record(input);
  const labels = Array.isArray(body.labels) ? body.labels.map(String) : [];
  const v1Rows = Array.isArray(body.data) ? body.data : [];
  const v1Row = Array.isArray(v1Rows[0]) ? v1Rows[0] as unknown[] : [];
  if (dimension === "__total__" && labels.length && v1Row.length) {
    return labels.reduce((sum, label, index) => {
      if (label === "time" || label === "guest" || label === "guest_nice") return sum;
      return sum + finiteNumber(v1Row[index]);
    }, 0);
  }
  const v1Index = labels.findIndex((label) => label === dimension);
  if (v1Index >= 0 && v1Row.length > v1Index) return finiteNumber(v1Row[v1Index]);
  const view = record(body.view);
  const dimensions = record(view.dimensions);
  const ids = Array.isArray(dimensions.ids) ? dimensions.ids.map(String) : [];
  const names = Array.isArray(dimensions.names) ? dimensions.names.map(String) : [];
  const result = record(body.result);
  const rows = Array.isArray(result.data) ? result.data : Array.isArray(body.data) ? body.data : [];
  const row = Array.isArray(rows[0]) ? rows[0] as unknown[] : [];
  const index = ids.findIndex((id) => id === dimension || id.endsWith(`:${dimension}`));
  const nameIndex = names.findIndex((name) => name.toLowerCase() === dimension.toLowerCase());
  const resolved = index >= 0 ? index : nameIndex;
  if (resolved >= 0 && row.length > resolved) {
    const offset = row.length === ids.length + 1 ? 1 : 0;
    return finiteNumber(row[resolved + offset]);
  }
  const direct = result[dimension] ?? body[dimension];
  if (direct !== undefined) return finiteNumber(direct);
  throw new Error(`Netdata dimension ${dimension} is unavailable`);
}

export function normalizeNetdata(
  metrics: Record<string, unknown>,
  host: string,
  info: unknown,
  history: PlexHistory | null = null,
  options: {
    dimensions?: NetdataMetricDimensions;
    gpuName?: string;
    gpuTensorCores?: number;
  } = {},
): PanelData<"plexHost"> {
  const dimensions = options.dimensions ?? DEFAULT_METRIC_DIMENSIONS;
  const values = Object.fromEntries(NETDATA_METRIC_KEYS.map(
    (key) => [key, extractNetdataDimension(metrics[key], dimensions[key])],
  ));
  const hostInfo = record(info);
  const usedMiB = finiteNumber(values.vramUsedBytes);
  const totalMiB = usedMiB + finiteNumber(values.vramFreeBytes);
  const ramUsedMiB = finiteNumber(values.ramUsedMiB);
  const ramTotalMiB = ramUsedMiB
    + finiteNumber(values.ramFreeMiB)
    + finiteNumber(values.ramCachedMiB)
    + finiteNumber(values.ramBuffersMiB);
  return plexHostDataSchema.parse({
    host: boundedText(host, 80),
    gpuName: boundedText(options.gpuName ?? "GPU", 100),
    gpuTensorCores: options.gpuTensorCores ?? null,
    cpuCores: Math.max(1, Math.trunc(finiteNumber(hostInfo.cores_total, 1))),
    gpuPercent: Math.min(100, Math.max(0, finiteNumber(values.gpuPercent))),
    encodePercent: Math.min(100, Math.max(0, finiteNumber(values.encodePercent))),
    decodePercent: Math.min(100, Math.max(0, finiteNumber(values.decodePercent))),
    vramUsedBytes: Math.max(0, usedMiB * 1024 * 1024),
    vramTotalBytes: Math.max(1, totalMiB * 1024 * 1024),
    temperatureC: finiteNumber(values.temperatureC),
    powerWatts: Math.max(0, finiteNumber(values.powerWatts)),
    cpuPercent: Math.min(100, Math.max(0, finiteNumber(values.cpuPercent))),
    ramUsedBytes: Math.max(0, ramUsedMiB * 1024 * 1024),
    ramTotalBytes: Math.max(1, ramTotalMiB * 1024 * 1024),
    hardwareSessions: 0,
    history,
  });
}

export function createNetdataCollector(
  baseUrl: string,
  request: JsonRequest = fetchJson,
  options: NetdataCollectorOptions,
): Collector<"plexHost"> {
  const configuredRequest: JsonRequest = (url, init) => request(url, init, options.allowInsecureTls);
  const dimensions = Object.fromEntries(NETDATA_METRIC_KEYS.map(
    (key) => [key, options.metrics[key].dimension],
  )) as NetdataMetricDimensions;
  const historyStartSeconds = options.workload?.startAt
    ? Date.parse(options.workload.startAt) / 1_000
    : Number.NEGATIVE_INFINITY;
  let historyCache: PlexHistory | null = null;
  let workloadSourceCache: { average: unknown | null; peak: unknown | null } = { average: null, peak: null };
  let historyLastAttemptAt = 0;
  let historyRefresh: Promise<void> | null = null;

  const startHistoryRefresh = (attemptedAt: number): void => {
    if (historyRefresh) return;
    historyLastAttemptAt = attemptedAt;
    const signal = AbortSignal.timeout(HISTORY_TIMEOUT_MS);
    historyRefresh = (async () => {
      const historyCharts = [...new Set(HISTORY_METRIC_KEYS.map((key) => options.metrics[key].chart))];
      const historyEntries = await Promise.all(historyCharts.map(async (chart) => {
        const url = new URL("/api/v1/data", baseUrl);
        url.searchParams.set("chart", chart);
        url.searchParams.set("after", `-${HISTORY_WINDOW_SECONDS}`);
        url.searchParams.set("points", String(HISTORY_ANALYSIS_POINTS));
        url.searchParams.set("group", "average");
        url.searchParams.set("format", "json");
        return [chart, await configuredRequest(url.toString(), { signal, headers: { accept: "application/json" } })];
      }));
      const workloadRequest = async (group: "average" | "max"): Promise<unknown | null> => {
        if (!options.workload) return null;
        const url = new URL("/api/v1/data", baseUrl);
        url.searchParams.set("chart", options.workload.chart);
        url.searchParams.set("after", `-${HISTORY_WINDOW_SECONDS}`);
        url.searchParams.set("points", String(HISTORY_ANALYSIS_POINTS));
        url.searchParams.set("group", group);
        url.searchParams.set("format", "json");
        try {
          return await configuredRequest(url.toString(), { signal, headers: { accept: "application/json" } });
        } catch {
          return null;
        }
      };
      const [workloadAverage, workloadPeak] = await Promise.all([
        workloadRequest("average"),
        workloadRequest("max"),
      ]);
      workloadSourceCache = {
        average: workloadAverage ?? workloadSourceCache.average,
        peak: workloadPeak ?? workloadSourceCache.peak,
      };
      const historyResponses = Object.fromEntries(historyEntries);
      const historyMetrics = {
        ...Object.fromEntries(HISTORY_METRIC_KEYS.map((key) => [key, historyResponses[options.metrics[key].chart]])),
        workloadAverage: workloadSourceCache.average,
        workloadPeak: workloadSourceCache.peak,
      };
      historyCache = normalizeNetdataHistory(historyMetrics, dimensions, historyStartSeconds);
    })()
      .catch(() => {
        // Historical capacity is additive. Preserve live telemetry and any prior history on failure.
      })
      .finally(() => {
        historyRefresh = null;
      });
  };

  return {
    name: "Plex Netdata GPU telemetry",
    panel: "plexHost",
    source: "Netdata + nvidia_smi",
    intervalMs: 5_000,
    staleAfterMs: 20_000,
    timeoutMs: 3_000,
    required: true,
    enabled: baseUrl.length > 0,
    schema: plexHostDataSchema,
    collect: async ({ signal, now }) => {
      const charts = [...new Set(Object.values(options.metrics).map(({ chart }) => chart))];
      const infoUrl = new URL("/api/v1/info", baseUrl);
      const [chartEntries, info] = await Promise.all([
        Promise.all(charts.map(async (chart) => {
          const url = new URL("/api/v1/data", baseUrl);
          url.searchParams.set("chart", chart);
          url.searchParams.set("after", "-1");
          url.searchParams.set("points", "1");
          url.searchParams.set("format", "json");
          return [chart, await configuredRequest(url.toString(), { signal, headers: { accept: "application/json" } })];
        })),
        configuredRequest(infoUrl.toString(), { signal, headers: { accept: "application/json" } }),
      ]);
      const chartResponses = Object.fromEntries(chartEntries);
      const metrics = Object.fromEntries(NETDATA_METRIC_KEYS.map(
        (key) => [key, chartResponses[options.metrics[key].chart]],
      ));
      if (now.getTime() - historyLastAttemptAt >= HISTORY_REFRESH_MS) startHistoryRefresh(now.getTime());
      return normalizeNetdata(metrics, options.hostLabel ?? "Media host", info, historyCache, {
        dimensions,
        ...(options.gpuName ? { gpuName: options.gpuName } : {}),
        ...(options.gpuTensorCores ? { gpuTensorCores: options.gpuTensorCores } : {}),
      });
    },
  };
}
