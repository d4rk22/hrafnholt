import { episodesDataSchema, type PanelData } from "../contracts/dashboard.js";
import { boundedText, fetchJson, type Collector, type JsonRequest } from "./collector.js";

export type SonarrInstance = { library: string; baseUrl: string; apiKey: string; allowInsecureTls?: boolean };
type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function followingDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function normalizeSonarr(input: unknown, instance: SonarrInstance, now: Date): PanelData<"episodes">["episodes"] {
  if (!Array.isArray(input)) throw new Error(`${instance.library} calendar response is malformed`);
  return input.slice(0, 30).map((value, index) => {
    const episode = record(value);
    const series = record(episode.series);
    const file = record(episode.episodeFile);
    const airAt = new Date(String(episode.airDateUtc ?? episode.airDate ?? now.toISOString()));
    const hasFile = Boolean(episode.hasFile) || Number(episode.episodeFileId ?? 0) > 0;
    const isAiring = !hasFile && now.getTime() >= airAt.getTime() && now.getTime() <= airAt.getTime() + 3_600_000;
    const monitored = episode.monitored !== false;
    return {
      id: boundedText(episode.id ?? `${instance.library}-${index}`, 120),
      library: instance.library,
      show: boundedText(series.title ?? episode.seriesTitle ?? "Unknown series", 160),
      context: boundedText(`S${String(episode.seasonNumber ?? 0).padStart(2, "0")}E${String(episode.episodeNumber ?? 0).padStart(2, "0")} · ${String(episode.title ?? "")}`, 180),
      airAt: Number.isNaN(airAt.getTime()) ? now.toISOString() : airAt.toISOString(),
      quality: boundedText(record(file.quality).quality ? record(record(file.quality).quality).name : "pending", 80),
      state: hasFile ? "grabbed" as const : isAiring ? "airing" as const : monitored ? "waiting" as const : "missing" as const,
    };
  });
}

export async function collectSonarrDate(
  instances: SonarrInstance[],
  date: string,
  now: Date,
  signal: AbortSignal,
  request: JsonRequest = fetchJson,
): Promise<PanelData<"episodes">> {
  const results = await Promise.all(instances.map(async (instance) => {
    const url = new URL("/api/v3/calendar", instance.baseUrl);
    url.searchParams.set("start", date);
    url.searchParams.set("end", followingDate(date));
    url.searchParams.set("includeSeries", "true");
    url.searchParams.set("includeEpisodeFile", "true");
    return normalizeSonarr(await request(
      url.toString(),
      { signal, headers: { "x-api-key": instance.apiKey, accept: "application/json" } },
      instance.allowInsecureTls,
    ), instance, now);
  }));
  return episodesDataSchema.parse({ localDate: date, episodes: results.flat().sort((a, b) => a.airAt.localeCompare(b.airAt)).slice(0, 30) });
}

export function createSonarrCollector(
  instances: SonarrInstance[],
  request: JsonRequest = fetchJson,
  timeZone = "UTC",
): Collector<"episodes"> {
  return {
    name: "Sonarr calendars",
    panel: "episodes",
    source: instances.map(({ library }) => library).join(" + ").slice(0, 120) || "Sonarr",
    intervalMs: 60_000,
    staleAfterMs: 300_000,
    timeoutMs: 5_000,
    required: true,
    enabled: instances.length > 0 && instances.every((instance) => Boolean(instance.apiKey)),
    schema: episodesDataSchema,
    collect: async ({ signal, now }) => {
      const date = localDate(now, timeZone);
      return collectSonarrDate(instances, date, now, signal, request);
    },
  };
}
