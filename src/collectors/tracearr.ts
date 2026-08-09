import { streamsDataSchema, type PanelData } from "../contracts/dashboard.js";
import { boundedText, fetchJson, finiteNumber, type Collector, type JsonRequest } from "./collector.js";

type TracearrOptions = {
  baseUrl: string;
  token: string;
  homeLocation?: TracearrHomeLocation;
  allowInsecureTls?: boolean;
  request?: JsonRequest;
};

export type TracearrHomeLocation = {
  label: string;
  countryCode: string | null;
  latitude: number;
  longitude: number;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function roundedCoordinate(value: unknown, minimum: number, maximum: number): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return null;
  return Math.round(number * 10) / 10;
}

function locationLabel(stream: UnknownRecord): string {
  const parts = [stream.geoCity, stream.geoRegion, stream.geoCountry]
    .map((value) => boundedText(value ?? "", 60))
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
  return parts.length > 0 ? boundedText(parts.join(" · "), 120) : "Location unavailable";
}

function countryCode(value: unknown): string | null {
  const normalized = boundedText(value ?? "", 8).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function isLocalNetwork(value: unknown): boolean {
  return boundedText(value ?? "", 60).trim().toLowerCase() === "local network";
}

function coarseLocation(stream: UnknownRecord, homeLocation?: TracearrHomeLocation) {
  if (isLocalNetwork(stream.geoCity) || isLocalNetwork(stream.geoCountry)) {
    return homeLocation ?? {
      label: "Local network",
      countryCode: null,
      latitude: null,
      longitude: null,
    };
  }
  const normalizedCountryCode = countryCode(stream.geoCountry);
  const latitude = roundedCoordinate(stream.geoLat, -90, 90);
  const longitude = roundedCoordinate(stream.geoLon, -180, 180);
  const nullIslandSentinel = normalizedCountryCode === null && latitude === 0 && longitude === 0;
  return {
    label: locationLabel(stream),
    countryCode: normalizedCountryCode,
    latitude: nullIslandSentinel ? null : latitude,
    longitude: nullIslandSentinel ? null : longitude,
  };
}

function streamPresentation(stream: UnknownRecord): { title: string; context: string } {
  const mediaType = String(stream.mediaType ?? "").toLowerCase();
  const mediaTitle = boundedText(stream.mediaTitle ?? stream.title ?? "Unknown title", 160);
  if (mediaType === "episode") {
    const show = boundedText(stream.showTitle ?? stream.grandparentTitle ?? mediaTitle, 160);
    const season = Number(stream.seasonNumber);
    const episode = Number(stream.episodeNumber);
    const episodeCode = Number.isInteger(season) && Number.isInteger(episode)
      ? `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
      : "";
    return { title: show, context: boundedText([episodeCode, mediaTitle].filter(Boolean).join(" · "), 200) };
  }
  if (mediaType === "track") {
    return {
      title: mediaTitle,
      context: boundedText([stream.artistName, stream.albumName].filter(Boolean).join(" · "), 200),
    };
  }
  return { title: mediaTitle, context: boundedText(stream.year ?? stream.mediaType ?? "", 200) };
}

function formattedSummaryBitrate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(kbps|mbps)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2]?.toLowerCase() === "kbps" ? amount / 1000 : amount;
}

function hasHardwareEngine(value: unknown): boolean {
  if (value === true) return true;
  const normalized = boundedText(value ?? "", 40).toLowerCase();
  return normalized.length > 0 && !["0", "false", "none", "software"].includes(normalized);
}

export function normalizeTracearr(input: unknown, homeLocation?: TracearrHomeLocation): PanelData<"streams"> {
  const body = record(input);
  const rawStreams = Array.isArray(body.data) ? body.data : Array.isArray(body.streams) ? body.streams : [];
  const streams = rawStreams.slice(0, 24).map((value, index) => {
    const stream = record(value);
    const duration = finiteNumber(stream.durationMs ?? stream.duration, 0);
    const progress = finiteNumber(stream.progressMs ?? stream.progress, 0);
    const isTranscode = Boolean(stream.isTranscode) || String(stream.videoDecision ?? "").toLowerCase() === "transcode";
    const videoDecision = String(stream.videoDecision ?? "").toLowerCase();
    const audioDecision = String(stream.audioDecision ?? "").toLowerCase();
    const isCopy = !isTranscode && (videoDecision === "copy" || audioDecision === "copy");
    const resolution = boundedText(stream.videoResolution ?? stream.resolution ?? "", 30);
    const playbackState = String(stream.state ?? "").toLowerCase();
    const transcodeInfo = record(stream.transcodeInfo);
    const hardwareDecode = hasHardwareEngine(transcodeInfo.hwDecoding);
    const hardwareEncode = hasHardwareEngine(transcodeInfo.hwEncoding);
    const transcodeMode = !isTranscode
      ? "none" as const
      : hardwareDecode && hardwareEncode
        ? "hardware" as const
        : hardwareDecode || hardwareEncode
          ? "partial" as const
          : "software" as const;
    const decisionLabel = !isTranscode
      ? isCopy ? "Direct stream" : "Direct play"
      : transcodeMode === "hardware"
        ? "HW transcode"
        : hardwareDecode
          ? "HW decode · SW encode"
          : hardwareEncode
            ? "SW decode · HW encode"
            : "Software transcode";
    const presentation = streamPresentation(stream);
    return {
      id: boundedText(stream.id ?? stream.sessionId ?? `stream-${index}`, 160),
      user: boundedText(stream.username ?? stream.user ?? "unknown viewer", 80),
      title: presentation.title,
      context: presentation.context,
      progressPercent: duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0,
      playbackMode: isTranscode ? "transcode" as const : isCopy ? "copy" as const : "direct" as const,
      transcodeMode,
      playbackLabel: boundedText(`${playbackState === "paused" ? "Paused · " : playbackState === "buffering" ? "Buffering · " : ""}${decisionLabel}${resolution ? ` · ${resolution}` : ""}`, 80),
      bitrateMbps: Math.max(0, finiteNumber(stream.bitrate, 0) / 1000),
      platform: boundedText(stream.platform ?? "", 60) || null,
      location: coarseLocation(stream, homeLocation),
    };
  });
  const summary = record(body.summary);
  const summaryBitrateMbps = formattedSummaryBitrate(summary.totalBitrate);
  return streamsDataSchema.parse({
    total: streams.length,
    transcodes: Number.isFinite(Number(summary.transcodes))
      ? Number(summary.transcodes)
      : streams.filter((stream) => stream.playbackMode === "transcode").length,
    totalBitrateMbps: summaryBitrateMbps !== null
      ? summaryBitrateMbps
      : Number.isFinite(Number(summary.totalBitrate))
      ? Math.max(0, Number(summary.totalBitrate) / 1000)
      : streams.reduce((total, stream) => total + stream.bitrateMbps, 0),
    streams,
  });
}

export function createTracearrCollector(options: TracearrOptions): Collector<"streams"> {
  const request = options.request ?? fetchJson;
  return {
    name: "Tracearr live streams",
    panel: "streams",
    source: "Tracearr",
    intervalMs: 5_000,
    staleAfterMs: 20_000,
    timeoutMs: 3_000,
    required: true,
    enabled: options.token.length > 0,
    schema: streamsDataSchema,
    collect: async ({ signal }) => normalizeTracearr(await request(
      `${options.baseUrl.replace(/\/$/, "")}/api/v1/public/streams?includeLocation=true`,
      { signal, headers: { authorization: `Bearer ${options.token}`, accept: "application/json" } },
      options.allowInsecureTls,
    ), options.homeLocation),
  };
}
