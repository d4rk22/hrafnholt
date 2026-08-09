import type { FastifyInstance } from "fastify";
import { Agent, fetch as undiciFetch } from "undici";

type RadarrPosterSource = { baseUrl: string; apiKey: string; allowInsecureTls?: boolean };
export type RadarrPosterSources = Readonly<Record<string, RadarrPosterSource>>;
type ImageFetch = (input: string | URL, init?: RequestInit, allowInsecureTls?: boolean) => Promise<Response>;

const maxPosterBytes = 2 * 1024 * 1024;
const insecurePosterAgent = new Agent({ connect: { rejectUnauthorized: false } });
const fetchPoster: ImageFetch = async (input, init, allowInsecureTls = false) => {
  const request = allowInsecureTls
    ? ({ ...init, dispatcher: insecurePosterAgent } as RequestInit)
    : init;
  return undiciFetch(input, request as Parameters<typeof undiciFetch>[1]) as unknown as Response;
};

export function registerRadarrPosterRoutes(app: FastifyInstance, sources: RadarrPosterSources, imageFetch: ImageFetch = fetchPoster) {
  app.get<{ Params: { instance: string; id: string } }>("/api/posters/radarr/:instance/:id", async (request, reply) => {
    const { instance, id } = request.params;
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(instance) || !/^\d{1,10}$/.test(id)) {
      return reply.code(404).send({ error: "Poster not found" });
    }

    const source = sources[instance];
    if (!source?.baseUrl || !source.apiKey) return reply.code(404).send({ error: "Poster not found" });

    try {
      const upstream = await imageFetch(new URL(`/api/v3/mediacover/${id}/poster-500.jpg`, source.baseUrl), {
        headers: { "x-api-key": source.apiKey, accept: "image/avif,image/webp,image/jpeg,image/png" },
        redirect: "error",
        signal: AbortSignal.timeout(4_000),
      }, source.allowInsecureTls);
      if (!upstream.ok) return reply.code(upstream.status === 404 ? 404 : 502).send({ error: "Poster unavailable" });

      const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      const declaredLength = Number(upstream.headers.get("content-length") ?? 0);
      if (!/^image\/(?:avif|jpeg|png|webp)$/.test(contentType) || declaredLength > maxPosterBytes) {
        return reply.code(502).send({ error: "Invalid poster response" });
      }

      const poster = Buffer.from(await upstream.arrayBuffer());
      if (poster.byteLength > maxPosterBytes) return reply.code(502).send({ error: "Invalid poster response" });

      return reply
        .header("cache-control", "public, max-age=3600, stale-while-revalidate=86400")
        .type(contentType)
        .send(poster);
    } catch {
      return reply.code(502).send({ error: "Poster unavailable" });
    }
  });
}
