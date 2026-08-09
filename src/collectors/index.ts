import type { CollectorConfig, DashboardConfig } from "../config.js";
import { sabQueuesDataSchema } from "../contracts/dashboard.js";
import { requireSecret } from "../secrets.js";
import { createArcaneCollector } from "./arcane.js";
import type { Collector } from "./collector.js";
import { createEmporiaCollector } from "./emporia.js";
import { createNetdataCollector } from "./netdata.js";
import { createBackupCollector } from "./pbs.js";
import { createProxmoxCollector } from "./proxmox.js";
import { createQbittorrentRequest, normalizeQbittorrentQueue, type QbittorrentInstance } from "./qbittorrent.js";
import { createRadarrCollector, type RadarrInstance } from "./radarr.js";
import { createSabnzbdCollector, type SabInstance } from "./sabnzbd.js";
import { createSonarrCollector, type SonarrInstance } from "./sonarr.js";
import { createTracearrCollector } from "./tracearr.js";
import { createTrueNasStorageCollector } from "./truenas-storage.js";
import { createUniFiCollector, createUniFiPduCollector } from "./unifi.js";
import { createUniFiReadClient } from "./unifi-client.js";
import { createUptimeKumaCollector } from "./uptime-kuma.js";
import { createUpsCollector } from "./ups.js";

type CollectorType = CollectorConfig["type"];
type CollectorOfType<T extends CollectorType> = Extract<CollectorConfig, { type: T }>;

export type CollectorRuntime = {
  collectors: Collector[];
  sonarrInstances: SonarrInstance[];
  radarrPosterSources: Readonly<Record<string, { baseUrl: string; apiKey: string; allowInsecureTls: boolean }>>;
};

function collectorsOfType<T extends CollectorType>(config: DashboardConfig, type: T): CollectorOfType<T>[] {
  return config.document.collectors.filter(
    (collector): collector is CollectorOfType<T> => collector.type === type,
  );
}

function sourceLabel(instances: CollectorConfig[]): string {
  return instances.map((instance) => instance.panel.title ?? instance.name).join(" + ").slice(0, 120);
}

function applyRuntimeOptions(collector: Collector, instances: CollectorConfig[]): Collector {
  if (instances.length === 0) return collector;
  collector.name = sourceLabel(instances);
  collector.source = sourceLabel(instances);
  collector.intervalMs = Math.min(...instances.map((instance) => instance.poll_interval_seconds * 1_000));
  collector.timeoutMs = Math.max(...instances.map((instance) => instance.timeout_seconds * 1_000));
  collector.staleAfterMs = Math.max(...instances.map((instance) => instance.stale_after_seconds * 1_000));
  collector.required = instances.some((instance) => instance.required);
  collector.enabled = true;
  return collector;
}

function secret(config: DashboardConfig, reference: string): string {
  return requireSecret(config.secrets, reference);
}

function queueCollector(config: DashboardConfig): Collector<"sabQueues"> | null {
  const sabConfigs = collectorsOfType(config, "sabnzbd");
  const qbittorrentConfigs = collectorsOfType(config, "qbittorrent");
  const allConfigs = [...sabConfigs, ...qbittorrentConfigs];
  if (allConfigs.length === 0) return null;

  const sabInstances: SabInstance[] = sabConfigs.map((instance) => ({
    name: instance.name,
    library: instance.name,
    baseUrl: instance.url,
    apiKey: secret(config, instance.api_key_ref),
    allowInsecureTls: !instance.tls_verify,
  }));
  const qbittorrentInstances: QbittorrentInstance[] = qbittorrentConfigs.map((instance) => ({
    name: instance.name,
    library: instance.name,
    baseUrl: instance.url,
    username: secret(config, instance.username_ref),
    password: secret(config, instance.password_ref),
    allowInsecureTls: !instance.tls_verify,
  }));
  const sabCollector = sabInstances.length ? createSabnzbdCollector(sabInstances) : null;
  const qbittorrentRequest = createQbittorrentRequest();
  const collector: Collector<"sabQueues"> = {
    name: "Download queues",
    panel: "sabQueues",
    source: "Download clients",
    intervalMs: 5_000,
    staleAfterMs: 20_000,
    timeoutMs: 5_000,
    required: true,
    enabled: true,
    schema: sabQueuesDataSchema,
    collect: async (context) => {
      const sab = sabCollector ? await sabCollector.collect(context) : { instances: [] };
      const qbittorrent = await Promise.all(qbittorrentInstances.map(async (instance) => normalizeQbittorrentQueue(
        await qbittorrentRequest(instance, context.signal),
        instance,
      )));
      return sabQueuesDataSchema.parse({ instances: [...sab.instances, ...qbittorrent] });
    },
  };
  return applyRuntimeOptions(collector, allConfigs) as Collector<"sabQueues">;
}

export function createCollectorRuntime(config: DashboardConfig): CollectorRuntime {
  const collectors: Collector[] = [];
  const home = config.document.presentation.home;
  const homeLocation = home ? {
    label: config.document.presentation.branding.home_label,
    countryCode: home.country_code ?? null,
    latitude: home.latitude,
    longitude: home.longitude,
  } : undefined;

  for (const instance of collectorsOfType(config, "tracearr")) {
    collectors.push(applyRuntimeOptions(createTracearrCollector({
      baseUrl: instance.url,
      token: secret(config, instance.token_ref),
      ...(homeLocation ? { homeLocation } : {}),
      allowInsecureTls: !instance.tls_verify,
    }), [instance]));
  }

  for (const instance of collectorsOfType(config, "unifi")) {
    const options = {
      baseUrl: instance.url,
      username: secret(config, instance.username_ref),
      password: secret(config, instance.password_ref),
      site: instance.site,
      tlsVerify: instance.tls_verify,
    };
    const read = createUniFiReadClient(options);
    collectors.push(applyRuntimeOptions(createUniFiCollector(options, read), [instance]));
    if (instance.pdu) {
      collectors.push(applyRuntimeOptions(createUniFiPduCollector({
        ...options,
        macAddress: instance.pdu.mac_address,
        ...(instance.pdu.state_path ? { statePath: instance.pdu.state_path } : {}),
      }, read), [instance]));
    }
  }

  for (const instance of collectorsOfType(config, "netdata")) {
    collectors.push(applyRuntimeOptions(createNetdataCollector(instance.url, undefined, {
      allowInsecureTls: !instance.tls_verify,
      hostLabel: instance.name,
      gpuName: instance.gpu.name,
      ...(instance.gpu.tensor_cores ? { gpuTensorCores: instance.gpu.tensor_cores } : {}),
      metrics: {
        gpuPercent: instance.metrics.gpu_utilization,
        encodePercent: instance.metrics.encoder_utilization,
        decodePercent: instance.metrics.decoder_utilization,
        vramUsedBytes: instance.metrics.vram_used,
        vramFreeBytes: instance.metrics.vram_free,
        temperatureC: instance.metrics.temperature,
        powerWatts: instance.metrics.power,
        cpuPercent: instance.metrics.cpu,
        ramUsedMiB: instance.metrics.ram_used,
        ramFreeMiB: instance.metrics.ram_free,
        ramCachedMiB: instance.metrics.ram_cached,
        ramBuffersMiB: instance.metrics.ram_buffers,
      },
      ...(instance.workload ? {
        workload: {
          chart: instance.workload.chart,
          ...(instance.workload.start_at ? { startAt: instance.workload.start_at } : {}),
        },
      } : {}),
    }), [instance]));
  }
  for (const instance of collectorsOfType(config, "energy")) {
    collectors.push(applyRuntimeOptions(createEmporiaCollector(
      instance.url,
      true,
      undefined,
      !instance.tls_verify,
    ), [instance]));
  }
  for (const instance of collectorsOfType(config, "ups")) {
    collectors.push(applyRuntimeOptions(createUpsCollector({
      host: instance.host,
      username: secret(config, instance.username_ref),
      authPassword: secret(config, instance.auth_password_ref),
      privacyPassword: secret(config, instance.privacy_password_ref),
    }), [instance]));
  }

  const queues = queueCollector(config);
  if (queues) collectors.push(queues);

  const sonarrConfigs = collectorsOfType(config, "sonarr");
  const sonarrInstances: SonarrInstance[] = sonarrConfigs.map((instance) => ({
    library: instance.name,
    baseUrl: instance.url,
    apiKey: secret(config, instance.api_key_ref),
    allowInsecureTls: !instance.tls_verify,
  }));
  if (sonarrInstances.length) {
    collectors.push(applyRuntimeOptions(createSonarrCollector(
      sonarrInstances,
      undefined,
      config.document.presentation.timezone,
    ), sonarrConfigs));
  }

  const radarrConfigs = collectorsOfType(config, "radarr");
  const radarrInstances: RadarrInstance[] = radarrConfigs.map((instance) => ({
    id: instance.id,
    library: instance.name,
    baseUrl: instance.url,
    apiKey: secret(config, instance.api_key_ref),
    allowInsecureTls: !instance.tls_verify,
  }));
  if (radarrInstances.length) {
    collectors.push(applyRuntimeOptions(createRadarrCollector(radarrInstances), radarrConfigs));
  }
  const radarrPosterSources = Object.fromEntries(radarrInstances.map((instance) => [instance.id, {
    baseUrl: instance.baseUrl,
    apiKey: instance.apiKey,
    allowInsecureTls: Boolean(instance.allowInsecureTls),
  }]));

  for (const instance of collectorsOfType(config, "arcane")) {
    collectors.push(applyRuntimeOptions(createArcaneCollector(
      instance.url,
      secret(config, instance.api_key_ref),
      undefined,
      !instance.tls_verify,
    ), [instance]));
  }
  for (const instance of collectorsOfType(config, "proxmox")) {
    collectors.push(applyRuntimeOptions(createProxmoxCollector(
      instance.url,
      secret(config, instance.api_token_ref),
      undefined,
      {
        storageId: instance.storage_id,
        allowInsecureTls: !instance.tls_verify,
        excludedNodes: instance.exclude_nodes,
        nodeRoles: instance.node_roles,
      },
    ), [instance]));
  }
  for (const instance of collectorsOfType(config, "truenas")) {
    collectors.push(applyRuntimeOptions(createTrueNasStorageCollector(
      instance.url,
      secret(config, instance.api_key_ref),
      undefined,
      { fallbackName: instance.name, allowInsecureTls: !instance.tls_verify },
    ), [instance]));
  }
  for (const instance of collectorsOfType(config, "backups")) {
    collectors.push(applyRuntimeOptions(createBackupCollector({
      pveUrl: instance.pve.url,
      pveToken: secret(config, instance.pve.api_token_ref),
      ...(instance.pbs ? {
        pbs: {
          url: instance.pbs.url,
          token: secret(config, instance.pbs.api_token_ref),
        },
      } : {}),
      allowInsecureTls: !instance.tls_verify,
    }), [instance]));
  }
  for (const instance of collectorsOfType(config, "uptime_kuma")) {
    collectors.push(applyRuntimeOptions(createUptimeKumaCollector(
      instance.url,
      instance.status_page_slug,
      undefined,
      !instance.tls_verify,
    ), [instance]));
  }

  return { collectors, sonarrInstances, radarrPosterSources };
}

export function createCollectors(config: DashboardConfig): Collector[] {
  return createCollectorRuntime(config).collectors;
}
