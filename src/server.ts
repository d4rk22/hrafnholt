import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { CollectorScheduler } from "./cache/scheduler.js";
import { SnapshotStore } from "./cache/snapshot-store.js";
import { loadConfig, type ConfigLoaderDependencies } from "./config.js";
import { createCollectorRuntime } from "./collectors/index.js";
import { collectSonarrDate, type SonarrInstance } from "./collectors/sonarr.js";
import { addDerivedWatchlist } from "./collectors/watchlist.js";
import { dashboardSnapshotSchema, type DashboardSnapshot } from "./contracts/dashboard.js";
import { createDemoSnapshot } from "./demo.js";
import { loggerOptions } from "./logging.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerConfigurationRoutes } from "./routes/configuration.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerRadarrPosterRoutes } from "./routes/posters.js";

const projectRoot = process.cwd();

function loadFixtureSnapshot(): DashboardSnapshot {
  const path = join(projectRoot, "fixtures", "dashboard-snapshot.json");
  return dashboardSnapshotSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export async function buildServer(
  environment: NodeJS.ProcessEnv = process.env,
  configDependencies: ConfigLoaderDependencies = {},
) {
  const config = loadConfig(environment, configDependencies);
  const document = config.document;
  const demoMode = document.mode === "demo";
  const app = Fastify({ logger: { level: document.server.log_level, ...loggerOptions } });
  const fixture = loadFixtureSnapshot();
  const demoSnapshot = demoMode ? createDemoSnapshot(fixture, document.demo.state) : null;
  const runtime = demoMode
    ? { collectors: [], sonarrInstances: [] as SonarrInstance[], radarrPosterSources: {} }
    : createCollectorRuntime(config);
  const { collectors, sonarrInstances, radarrPosterSources } = runtime;
  const initialPanels = structuredClone(fixture.panels);
  if (!demoMode) {
    const collectorByPanel = new Map(collectors.map((collector) => [collector.panel, collector]));
    for (const [key, panel] of Object.entries(initialPanels)) {
      const collector = collectorByPanel.get(key as keyof typeof initialPanels);
      panel.status = collector ? "error" : "disabled";
      panel.lastAttemptAt = null;
      panel.lastSuccessAt = null;
      panel.ageSeconds = null;
      panel.message = collector ? "Awaiting first collector attempt" : "Collector not configured";
      panel.data = null;
      panel.source = collector ? collector.source : "Not configured";
      if (collector) {
        panel.staleAfterSeconds = collector.staleAfterMs / 1_000;
      }
    }
  }
  const store = new SnapshotStore(initialPanels);
  const scheduler = new CollectorScheduler(collectors, store);

  await app.register(fastifyStatic, {
    root: join(projectRoot, "public"),
    prefix: "/",
    wildcard: false,
  });

  registerConfigurationRoutes(app, document);

  registerDashboardRoutes(
    app,
    (state) => demoMode
      ? createDemoSnapshot(fixture, state ?? document.demo.state)
      : addDerivedWatchlist(store.snapshot("live")),
    async (date, signal) => {
      if (!demoMode && sonarrInstances.length) return collectSonarrDate(sonarrInstances, date, new Date(), signal);
      const fixtureEpisodes = demoSnapshot?.panels.episodes.data;
      return demoMode && fixtureEpisodes?.localDate === date ? fixtureEpisodes : { localDate: date, episodes: [] };
    },
    { allowDemoStateOverride: demoMode },
  );
  registerRadarrPosterRoutes(app, radarrPosterSources);
  registerHealthRoutes(app, () => {
    const state = demoMode
      ? { ready: true, attemptedCollectors: 0, requiredCollectors: 0 }
      : scheduler.readiness(true);
    return { ...state, mode: demoMode ? "fixture" : "live", configurationErrors: [] };
  });

  if (!demoMode) scheduler.start();
  app.addHook("onClose", async () => scheduler.stop());

  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: "Not found" }));
  return { app, config };
}

async function main() {
  const { app, config } = await buildServer();
  await app.listen({
    host: config.document.server.host,
    port: config.document.server.port,
    listenTextResolver: () => "Server listening",
  });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutdown requested");
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`dashboard failed to start: ${String(error)}\n`);
    process.exit(1);
  });
}
