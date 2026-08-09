import type { FastifyInstance } from "fastify";
import type { RavenhillConfigDocument } from "../config.js";

export function publicConfiguration(config: RavenhillConfigDocument) {
  const netdata = config.collectors.find((collector) => collector.type === "netdata");
  return {
    schemaVersion: "1.0.0" as const,
    branding: config.presentation.branding,
    locale: config.presentation.locale,
    timezone: config.presentation.timezone,
    currency: config.energy?.rates.currency ?? "USD",
    home: config.presentation.home,
    privacy: config.presentation.privacy,
    units: config.presentation.units,
    associations: {
      plex_host_proxmox_node: netdata?.proxmox_node ?? null,
    },
  };
}

export function registerConfigurationRoutes(app: FastifyInstance, config: RavenhillConfigDocument) {
  const response = publicConfiguration(config);
  app.get("/api/v1/configuration", async () => response);
}
