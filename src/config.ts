import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { demoStateSchema } from "./contracts/dashboard.js";
import { resolveSecretReferences, type SecretFileReader } from "./secrets.js";

export class RavenhillConfigurationError extends Error {
  override readonly name = "RavenhillConfigurationError";
}

const identifierSchema = z.string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9-]*$/, "must use lowercase letters, numbers, and hyphens");
const labelSchema = z.string().trim().min(1).max(80);
const secretReferenceSchema = z.string()
  .min(1)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_]*$/, "must be an uppercase environment variable name")
  .refine((value) => !value.endsWith("_FILE"), "must name the secret, not its _FILE variable");
const httpUrlSchema = z.url().max(2_048).refine((value) => {
  const url = new URL(value);
  return (url.protocol === "http:" || url.protocol === "https:")
    && url.username === ""
    && url.password === ""
    && url.search === ""
    && url.hash === "";
}, "must be an http or https base URL without credentials, query, or fragment");
const absolutePathSchema = z.string().min(1).max(512).startsWith("/", "must be an absolute path");
const hostnameSchema = z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/);
const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);
const localeSchema = z.string().trim().min(2).max(35).refine((value) => {
  try {
    new Intl.Locale(value);
    return true;
  } catch {
    return false;
  }
}, "must be a valid locale");
const timezoneSchema = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "must be a valid IANA timezone");

const panelOptionsSchema = z.object({
  title: labelSchema.optional(),
}).strict().default({});

const collectorCommon = {
  id: identifierSchema,
  name: labelSchema,
  required: z.boolean().default(true),
  poll_interval_seconds: z.number().int().min(1).max(86_400).default(30),
  timeout_seconds: z.number().int().min(1).max(300).default(5),
  stale_after_seconds: z.number().int().min(2).max(604_800).default(120),
  panel: panelOptionsSchema,
};
const httpCollectorCommon = {
  ...collectorCommon,
  tls_verify: z.boolean().default(true),
};
const netdataMetricSelectorSchema = z.object({
  chart: z.string().trim().min(1).max(200),
  dimension: z.string().trim().min(1).max(120),
}).strict();
const netdataMetricsSchema = z.object({
  gpu_utilization: netdataMetricSelectorSchema,
  encoder_utilization: netdataMetricSelectorSchema,
  decoder_utilization: netdataMetricSelectorSchema,
  vram_used: netdataMetricSelectorSchema,
  vram_free: netdataMetricSelectorSchema,
  temperature: netdataMetricSelectorSchema,
  power: netdataMetricSelectorSchema,
  cpu: netdataMetricSelectorSchema,
  ram_used: netdataMetricSelectorSchema,
  ram_free: netdataMetricSelectorSchema,
  ram_cached: netdataMetricSelectorSchema,
  ram_buffers: netdataMetricSelectorSchema,
}).strict();

const collectorSchemas = [
  z.object({
    ...httpCollectorCommon,
    type: z.literal("tracearr"),
    url: httpUrlSchema,
    token_ref: secretReferenceSchema,
  }).strict(),
  z.object({
    ...httpCollectorCommon,
    type: z.literal("unifi"),
    url: httpUrlSchema,
    username_ref: secretReferenceSchema,
    password_ref: secretReferenceSchema,
    site: identifierSchema.default("default"),
    pdu: z.object({
      mac_address: z.string().regex(/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/),
      state_path: absolutePathSchema.optional(),
    }).strict().optional(),
  }).strict(),
  z.object({
    ...httpCollectorCommon,
    type: z.literal("netdata"),
    url: httpUrlSchema,
    metrics: netdataMetricsSchema,
    gpu: z.object({
      name: labelSchema.default("GPU"),
      tensor_cores: z.number().int().positive().optional(),
    }).strict().default({ name: "GPU" }),
    workload: z.object({
      chart: z.string().trim().min(1).max(200),
      start_at: z.iso.datetime().optional(),
    }).strict().optional(),
    proxmox_node: hostnameSchema.optional(),
  }).strict(),
  z.object({
    ...httpCollectorCommon,
    type: z.literal("energy"),
    url: httpUrlSchema,
  }).strict(),
  z.object({
    ...collectorCommon,
    type: z.literal("ups"),
    host: hostnameSchema,
    username_ref: secretReferenceSchema,
    auth_password_ref: secretReferenceSchema,
    privacy_password_ref: secretReferenceSchema,
  }).strict(),
  z.object({
    ...httpCollectorCommon,
    type: z.literal("sabnzbd"),
    url: httpUrlSchema,
    api_key_ref: secretReferenceSchema,
  }).strict(),
  z.object({
    ...httpCollectorCommon,
    type: z.literal("qbittorrent"),
    url: httpUrlSchema,
    username_ref: secretReferenceSchema,
    password_ref: secretReferenceSchema,
  }).strict(),
  z.object({
    ...httpCollectorCommon,
    type: z.literal("sonarr"),
    url: httpUrlSchema,
    api_key_ref: secretReferenceSchema,
  }).strict(),
  z.object({
    ...httpCollectorCommon,
    type: z.literal("radarr"),
    url: httpUrlSchema,
    api_key_ref: secretReferenceSchema,
  }).strict(),
  z.object({
    ...httpCollectorCommon,
    type: z.literal("arcane"),
    url: httpUrlSchema,
    api_key_ref: secretReferenceSchema,
  }).strict(),
  z.object({
    ...httpCollectorCommon,
    type: z.literal("proxmox"),
    url: httpUrlSchema,
    api_token_ref: secretReferenceSchema,
    storage_id: identifierSchema,
    exclude_nodes: z.array(hostnameSchema).max(100).default([]),
    node_roles: z.record(hostnameSchema, labelSchema).default({}),
  }).strict(),
  z.object({
    ...httpCollectorCommon,
    type: z.literal("truenas"),
    url: httpUrlSchema,
    api_key_ref: secretReferenceSchema,
  }).strict(),
  z.object({
    ...httpCollectorCommon,
    type: z.literal("backups"),
    pve: z.object({
      url: httpUrlSchema,
      api_token_ref: secretReferenceSchema,
    }).strict(),
    pbs: z.object({
      url: httpUrlSchema,
      api_token_ref: secretReferenceSchema,
    }).strict().optional(),
  }).strict(),
  z.object({
    ...httpCollectorCommon,
    type: z.literal("uptime_kuma"),
    url: httpUrlSchema,
    status_page_slug: identifierSchema,
  }).strict(),
] as const;

export const collectorConfigSchema = z.discriminatedUnion("type", collectorSchemas);

const serverSchema = z.object({
  host: z.string().trim().min(1).max(253).default("0.0.0.0"),
  port: z.number().int().min(1).max(65_535).default(3_000),
  log_level: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
}).strict();

const presentationSchema = z.object({
  branding: z.object({
    title: labelSchema.default("Ravenhill"),
    subtitle: z.string().trim().min(1).max(120).default("Operations dashboard"),
    home_label: labelSchema.default("Home"),
  }).strict().default({ title: "Ravenhill", subtitle: "Operations dashboard", home_label: "Home" }),
  locale: localeSchema.default("en-US"),
  timezone: timezoneSchema.default("UTC"),
  home: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    country_code: countryCodeSchema.optional(),
  }).strict().nullable().default(null),
  privacy: z.object({
    default_mode: z.enum(["public", "private"]).default("public"),
    allow_private_toggle: z.boolean().default(false),
    aliases: z.array(z.string().trim().min(1).max(40)).max(64).default([])
      .refine((aliases) => aliases.length !== 1, "one alias cannot mask distinct viewers; provide at least two or omit the list")
      .refine(
        (aliases) => new Set(aliases.map((alias) => alias.toLocaleLowerCase("en-US"))).size === aliases.length,
        "aliases must be unique ignoring case",
      ),
  }).strict().default({ default_mode: "public", allow_private_toggle: false, aliases: [] }),
  units: z.object({
    temperature: z.enum(["celsius", "fahrenheit"]).default("celsius"),
  }).strict().default({ temperature: "celsius" }),
}).strict();

const energySchema = z.object({
  provider: z.literal("emporia"),
  username_ref: secretReferenceSchema,
  password_ref: secretReferenceSchema,
  device_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  channels: z.object({
    server: z.string().trim().min(1).max(40),
    climate: z.string().trim().min(1).max(40).optional(),
    mains: z.string().trim().min(1).max(40),
  }).strict().superRefine((channels, context) => {
    const selectors = [channels.server, channels.climate, channels.mains]
      .filter((value): value is string => value !== undefined);
    if (new Set(selectors).size !== selectors.length) {
      context.addIssue({ code: "custom", message: "channel selectors must be unique" });
    }
  }),
  rates: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    tax_rate: z.number().min(0).max(1),
    fixed_monthly: z.number().nonnegative(),
    seasons: z.array(z.object({
      name: labelSchema,
      months: z.array(z.number().int().min(1).max(12)).min(1).max(12),
      price_per_kwh: z.number().nonnegative(),
    }).strict()).min(1).max(12),
  }).strict(),
  cache_ttl_seconds: z.number().int().min(1).max(3_600).default(60),
}).strict().superRefine((energy, context) => {
  const months = energy.rates.seasons.flatMap((season) => season.months);
  if (months.length !== 12 || new Set(months).size !== 12) {
    context.addIssue({
      code: "custom",
      path: ["rates", "seasons"],
      message: "must assign every calendar month exactly once",
    });
  }
});

const repeatableCollectorTypes = new Set(["sabnzbd", "qbittorrent", "sonarr", "radarr"]);

export const ravenhillConfigSchema = z.object({
  schema_version: z.literal(1),
  mode: z.enum(["demo", "live"]).default("demo"),
  demo: z.object({
    state: demoStateSchema.default("healthy"),
  }).strict().default({ state: "healthy" }),
  server: serverSchema.default({ host: "0.0.0.0", port: 3_000, log_level: "info" }),
  presentation: presentationSchema.default({
    branding: { title: "Ravenhill", subtitle: "Operations dashboard", home_label: "Home" },
    locale: "en-US",
    timezone: "UTC",
    home: null,
    privacy: { default_mode: "public", allow_private_toggle: false, aliases: [] },
    units: { temperature: "celsius" },
  }),
  collectors: z.array(collectorConfigSchema).max(100).default([]),
  energy: energySchema.optional(),
}).strict().superRefine((config, context) => {
  const ids = new Set<string>();
  const typeCounts = new Map<string, number>();
  config.collectors.forEach((collector, index) => {
    if (ids.has(collector.id)) {
      context.addIssue({ code: "custom", path: ["collectors", index, "id"], message: "must be unique" });
    }
    ids.add(collector.id);
    typeCounts.set(collector.type, (typeCounts.get(collector.type) ?? 0) + 1);
    if (collector.stale_after_seconds < collector.poll_interval_seconds) {
      context.addIssue({
        code: "custom",
        path: ["collectors", index, "stale_after_seconds"],
        message: "must be greater than or equal to poll_interval_seconds",
      });
    }
  });

  for (const [type, count] of typeCounts) {
    if (count > 1 && !repeatableCollectorTypes.has(type)) {
      context.addIssue({
        code: "custom",
        path: ["collectors"],
        message: `collector type ${type} currently supports one named instance`,
      });
    }
  }
  if (config.mode === "demo" && config.collectors.length > 0) {
    context.addIssue({ code: "custom", path: ["collectors"], message: "must be empty in demo mode" });
  }
  if (config.mode === "live" && config.collectors.some((collector) => collector.type === "tracearr") && !config.presentation.home) {
    context.addIssue({
      code: "custom",
      path: ["presentation", "home"],
      message: "is required when the Tracearr collector is enabled",
    });
  }
  if (config.collectors.some((collector) => collector.type === "energy") && !config.energy) {
    context.addIssue({
      code: "custom",
      path: ["energy"],
      message: "is required when the energy collector is enabled",
    });
  }
});

export type CollectorConfig = z.infer<typeof collectorConfigSchema>;
export type RavenhillConfigDocument = z.infer<typeof ravenhillConfigSchema>;

export type DashboardConfig = {
  document: RavenhillConfigDocument;
  secrets: ReadonlyMap<string, string>;
};

export type ConfigLoaderDependencies = {
  configurationText?: string;
  readConfigurationFile?: (path: string) => string;
  readSecretFile?: SecretFileReader;
};

function formatConfigurationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "configuration"}: ${issue.message}`)
    .join("; ");
}

export function parseConfigDocument(configurationText: string): RavenhillConfigDocument {
  let input: unknown;
  try {
    input = parseYaml(configurationText, { uniqueKeys: true });
  } catch {
    throw new RavenhillConfigurationError("Ravenhill configuration is not valid YAML");
  }
  const result = ravenhillConfigSchema.safeParse(input);
  if (!result.success) {
    throw new RavenhillConfigurationError(`Invalid Ravenhill configuration: ${formatConfigurationIssues(result.error)}`);
  }
  return result.data;
}

function dashboardSecretReferences(config: RavenhillConfigDocument): string[] {
  return config.collectors.flatMap((collector): string[] => {
    switch (collector.type) {
      case "tracearr": return [collector.token_ref];
      case "unifi": return [collector.username_ref, collector.password_ref];
      case "ups": return [collector.username_ref, collector.auth_password_ref, collector.privacy_password_ref];
      case "sabnzbd":
      case "sonarr":
      case "radarr":
      case "arcane":
      case "truenas": return [collector.api_key_ref];
      case "qbittorrent": return [collector.username_ref, collector.password_ref];
      case "proxmox": return [collector.api_token_ref];
      case "backups": return [collector.pve.api_token_ref, ...(collector.pbs ? [collector.pbs.api_token_ref] : [])];
      case "netdata":
      case "energy":
      case "uptime_kuma": return [];
    }
  });
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: ConfigLoaderDependencies = {},
): DashboardConfig {
  let configurationText = dependencies.configurationText;
  if (configurationText === undefined) {
    const configPath = environment.RAVENHILL_CONFIG ?? "ravenhill.yml";
    try {
      configurationText = (dependencies.readConfigurationFile ?? ((path) => readFileSync(path, "utf8")))(configPath);
    } catch {
      throw new RavenhillConfigurationError("Ravenhill configuration file could not be read");
    }
  }

  const document = parseConfigDocument(configurationText);
  const secrets = resolveSecretReferences(
    dashboardSecretReferences(document),
    environment,
    dependencies.readSecretFile,
  );
  return { document, secrets };
}
