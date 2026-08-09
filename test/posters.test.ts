import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { registerRadarrPosterRoutes } from "../src/routes/posters.js";

test("Radarr poster proxy keeps credentials server-side and returns a bounded cached image", async () => {
  const app = Fastify({ logger: false });
  let upstreamUrl = "";
  let upstreamApiKey = "";
  let allowInsecureTls = false;
  registerRadarrPosterRoutes(app, {
    movies: { baseUrl: "http://radarr.example:7878", apiKey: "concealed-movies" },
    ultra: { baseUrl: "http://radarr-ultra.example:7879", apiKey: "concealed-ultra", allowInsecureTls: true },
  }, async (input, init, insecure) => {
    upstreamUrl = input.toString();
    upstreamApiKey = new Headers(init?.headers).get("x-api-key") ?? "";
    allowInsecureTls = Boolean(insecure);
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { "content-type": "image/jpeg" } });
  });

  const response = await app.inject({ method: "GET", url: "/api/posters/radarr/ultra/42" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "image/jpeg");
  assert.match(response.headers["cache-control"] ?? "", /max-age=3600/);
  assert.equal(upstreamUrl, "http://radarr-ultra.example:7879/api/v3/mediacover/42/poster-500.jpg");
  assert.equal(upstreamApiKey, "concealed-ultra");
  assert.equal(allowInsecureTls, true);
  assert.doesNotMatch(response.body, /concealed/);

  const invalid = await app.inject({ method: "GET", url: "/api/posters/radarr/movies/not-a-movie" });
  assert.equal(invalid.statusCode, 404);
  await app.close();
});
