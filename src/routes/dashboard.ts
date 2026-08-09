import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  dashboardSnapshotSchema,
  demoStateSchema,
  episodesDataSchema,
  type DashboardSnapshot,
  type DemoState,
  type PanelData,
} from "../contracts/dashboard.js";

export type SnapshotProvider = (demoState?: DemoState) => DashboardSnapshot;
export type EpisodesProvider = (date: string, signal: AbortSignal) => Promise<PanelData<"episodes">>;

const episodesQuerySchema = z.object({ date: z.iso.date() }).strict();
const dashboardQuerySchema = z.object({ demo: demoStateSchema.optional() }).strict();

export function registerDashboardRoutes(
  app: FastifyInstance,
  snapshot: SnapshotProvider,
  episodes: EpisodesProvider,
  options: { allowDemoStateOverride?: boolean } = {},
) {
  app.get("/api/v1/dashboard", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const query = dashboardQuerySchema.safeParse(request.query);
    if (!query.success || (query.data.demo && !options.allowDemoStateOverride)) {
      return reply.code(400).send({ error: "Demo state selection is available only in demo mode" });
    }
    return dashboardSnapshotSchema.parse(snapshot(query.data.demo));
  });

  app.get("/api/v1/episodes", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const query = episodesQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "A valid date in YYYY-MM-DD format is required" });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      return episodesDataSchema.parse(await episodes(query.data.date, controller.signal));
    } catch {
      return reply.code(502).send({ error: "Sonarr calendars are unavailable" });
    } finally {
      clearTimeout(timeout);
    }
  });
}
