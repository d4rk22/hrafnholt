import { moviesDataSchema, type PanelData } from "../contracts/dashboard.js";
import { boundedText, fetchJson, type Collector, type JsonRequest } from "./collector.js";

export type RadarrInstance = {
  id: string;
  library: string;
  baseUrl: string;
  apiKey: string;
  allowInsecureTls?: boolean;
};
type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

export function normalizeRadarr(input: unknown, instance: RadarrInstance): PanelData<"movies">["movies"] {
  if (!Array.isArray(input)) throw new Error(`${instance.library} movie response is malformed`);
  return input.map((value, index) => {
    const movie = record(value);
    const file = record(movie.movieFile);
    const quality = record(record(file.quality).quality);
    const added = new Date(String(movie.added ?? movie.inCinemas ?? 0));
    const id = boundedText(movie.id ?? `${instance.library}-${index}`, 120);
    return {
      id,
      library: instance.library,
      title: boundedText(movie.title ?? "Unknown movie", 160),
      year: Number.isInteger(Number(movie.year)) ? Number(movie.year) : null,
      addedAt: Number.isNaN(added.getTime()) ? new Date(0).toISOString() : added.toISOString(),
      hasFile: Boolean(movie.hasFile),
      format: boundedText(quality.name ?? "Unknown", 80),
      posterUrl: /^\d{1,10}$/.test(id)
        ? `/api/posters/radarr/${instance.id}/${id}`
        : null,
    };
  });
}

export function createRadarrCollector(instances: RadarrInstance[], request: JsonRequest = fetchJson): Collector<"movies"> {
  return {
    name: "Radarr latest additions",
    panel: "movies",
    source: instances.map(({ library }) => library).join(" + ").slice(0, 120) || "Radarr",
    intervalMs: 60_000,
    staleAfterMs: 300_000,
    timeoutMs: 5_000,
    required: true,
    enabled: instances.length > 0 && instances.every((instance) => Boolean(instance.apiKey)),
    schema: moviesDataSchema,
    collect: async ({ signal }) => {
      const movies = (await Promise.all(instances.map(async (instance) => normalizeRadarr(
        await request(
          new URL("/api/v3/movie", instance.baseUrl).toString(),
          { signal, headers: { "x-api-key": instance.apiKey, accept: "application/json" } },
          instance.allowInsecureTls,
        ),
        instance,
      )))).flat().sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 16);
      return moviesDataSchema.parse({ movies });
    },
  };
}
