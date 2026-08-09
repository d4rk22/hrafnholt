import type { FastifyInstance } from "fastify";

export type ReadinessProvider = () => {
  ready: boolean;
  mode: "fixture" | "live";
  attemptedCollectors: number;
  requiredCollectors: number;
  configurationErrors: string[];
};

export function registerHealthRoutes(app: FastifyInstance, readiness: ReadinessProvider) {
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    const state = readiness();
    if (!state.ready) reply.code(503);
    return state;
  });
}
