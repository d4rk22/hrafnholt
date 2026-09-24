import { Agent, WebSocket as UndiciWebSocket } from "undici";
import { truenasIoDataSchema, type PanelData } from "../contracts/dashboard.js";
import { finiteNumber, type Collector } from "./collector.js";

type UnknownRecord = Record<string, unknown>;
type IoData = PanelData<"truenasIo">;
type HistoryPoint = IoData["history"]["points"][number];

export type RealtimeSample = {
  readBytesPerSecond: number;
  writeBytesPerSecond: number;
  iops: number;
  busyPercent: number;
  arcHits: number;
  arcAccesses: number;
};

export type RealtimeSocket = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send: (data: string) => void;
  close: () => void;
};

export type FeedClock = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (timer: unknown) => void;
};

const systemClock: FeedClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

const BUCKET_SECONDS = 5;
const HISTORY_POINTS = 180;
const STALE_EVENT_MS = 20_000;
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;
const MAX_BUFFERED_SAMPLES = 120;
const insecureInternalAgent = new Agent({ connect: { rejectUnauthorized: false } });

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function rate(value: unknown): number {
  return Math.max(0, finiteNumber(value));
}

export function normalizeRealtimeSample(fieldsValue: unknown): RealtimeSample | null {
  const fields = record(fieldsValue);
  if (!fields.disks || typeof fields.disks !== "object") return null;
  const disks = record(fields.disks);
  const zfs = record(fields.zfs);
  return {
    readBytesPerSecond: rate(disks.read_bytes),
    writeBytesPerSecond: rate(disks.write_bytes),
    iops: rate(disks.read_ops) + rate(disks.write_ops),
    busyPercent: Math.min(100, rate(disks.busy)),
    // TrueNAS 25.10 reports every *_percentage field as 0, so derive the ratio from the rates.
    arcHits: rate(zfs.demand_data_hits_per_second) + rate(zfs.demand_metadata_hits_per_second),
    arcAccesses: rate(zfs.demand_accesses_per_second),
  };
}

export function summarizeSamples(samples: RealtimeSample[]): Omit<IoData, "history"> {
  const mean = (pick: (sample: RealtimeSample) => number) =>
    samples.reduce((sum, sample) => sum + pick(sample), 0) / Math.max(1, samples.length);
  const hits = samples.reduce((sum, sample) => sum + sample.arcHits, 0);
  const accesses = samples.reduce((sum, sample) => sum + sample.arcAccesses, 0);
  return {
    readBytesPerSecond: mean((sample) => sample.readBytesPerSecond),
    writeBytesPerSecond: mean((sample) => sample.writeBytesPerSecond),
    iops: mean((sample) => sample.iops),
    busyPercent: mean((sample) => sample.busyPercent),
    arcHitPercent: accesses > 0 ? Math.min(100, (hits / accesses) * 100) : null,
  };
}

// One long-lived subscription: TrueNAS audits every API-key login, so reconnecting per poll would flood the audit log.
export class TrueNasRealtimeFeed {
  lastEventAt: number | null = null;
  lastError: string | null = null;
  private socket: RealtimeSocket | null = null;
  private samples: RealtimeSample[] = [];
  private reconnectTimer: unknown;
  private reconnectDelayMs = RECONNECT_MIN_MS;
  private started = false;
  private closed = false;
  private readonly url: string;
  private readonly createSocket: (url: string) => RealtimeSocket;
  private readonly clock: FeedClock;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    options: { allowInsecureTls?: boolean; createSocket?: (url: string) => RealtimeSocket; clock?: FeedClock } = {},
  ) {
    this.url = `${baseUrl.replace(/\/$/, "").replace(/^http/, "ws")}/api/current`;
    this.clock = options.clock ?? systemClock;
    this.createSocket = options.createSocket ?? ((url) => new UndiciWebSocket(
      url,
      options.allowInsecureTls ? { dispatcher: insecureInternalAgent } : {},
    ) as unknown as RealtimeSocket);
  }

  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    this.connect();
  }

  drain(): RealtimeSample[] {
    const samples = this.samples;
    this.samples = [];
    return samples;
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== undefined) this.clock.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private connect(): void {
    const socket = this.createSocket(this.url);
    this.socket = socket;
    const send = (id: number, method: string, params: unknown[]) =>
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));

    socket.onopen = () => send(1, "auth.login_with_api_key", [this.apiKey]);
    socket.onmessage = (event) => {
      let message: UnknownRecord;
      try {
        message = record(JSON.parse(String(event.data)));
      } catch {
        return;
      }
      if (message.id === 1) {
        if (message.result === true) {
          send(2, "core.subscribe", ["reporting.realtime"]);
        } else {
          this.lastError = "TrueNAS rejected the API key login";
          socket.close();
        }
        return;
      }
      if (message.id === 2 && message.error) {
        this.lastError = "TrueNAS rejected the reporting.realtime subscription";
        socket.close();
        return;
      }
      const params = record(message.params);
      if (message.method !== "collection_update" || params.collection !== "reporting.realtime") return;
      const sample = normalizeRealtimeSample(params.fields);
      if (!sample) return;
      this.lastEventAt = this.clock.now();
      this.lastError = null;
      this.reconnectDelayMs = RECONNECT_MIN_MS;
      this.samples.push(sample);
      if (this.samples.length > MAX_BUFFERED_SAMPLES) this.samples.shift();
    };
    socket.onerror = () => {
      this.lastError ??= "TrueNAS realtime connection failed";
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.closed) return;
      const delay = this.reconnectDelayMs;
      this.reconnectDelayMs = Math.min(RECONNECT_MAX_MS, this.reconnectDelayMs * 2);
      this.reconnectTimer = this.clock.setTimeout(() => {
        this.reconnectTimer = undefined;
        if (!this.closed) this.connect();
      }, delay);
    };
  }
}

export function createTrueNasIoCollector(
  baseUrl: string,
  apiKey: string,
  options: { allowInsecureTls?: boolean; feed?: TrueNasRealtimeFeed; clock?: FeedClock } = {},
): Collector<"truenasIo"> {
  const clock = options.clock ?? systemClock;
  const feed = options.feed ?? new TrueNasRealtimeFeed(baseUrl, apiKey, { allowInsecureTls: options.allowInsecureTls ?? false, clock });
  const history: HistoryPoint[] = [];
  let latest: Omit<IoData, "history"> | null = null;

  return {
    name: "TrueNAS realtime IO",
    panel: "truenasIo",
    source: "TrueNAS",
    intervalMs: BUCKET_SECONDS * 1_000,
    staleAfterMs: 20_000,
    timeoutMs: 5_000,
    required: false,
    enabled: Boolean(baseUrl && apiKey),
    schema: truenasIoDataSchema,
    stop: () => feed.close(),
    collect: async () => {
      feed.start();
      const now = clock.now();
      if (feed.lastEventAt === null) {
        throw new Error(feed.lastError ?? "Waiting for TrueNAS realtime events");
      }
      const idleSeconds = Math.round((now - feed.lastEventAt) / 1_000);
      if (now - feed.lastEventAt > STALE_EVENT_MS) {
        throw new Error(feed.lastError ?? `TrueNAS sent no realtime events for ${idleSeconds}s`);
      }
      const samples = feed.drain();
      if (samples.length || !latest) {
        latest = summarizeSamples(samples);
        history.push({
          sampledAt: new Date(now).toISOString(),
          readBytesPerSecond: latest.readBytesPerSecond,
          writeBytesPerSecond: latest.writeBytesPerSecond,
        });
        if (history.length > HISTORY_POINTS) history.splice(0, history.length - HISTORY_POINTS);
      }
      return truenasIoDataSchema.parse({ ...latest, history: { bucketSeconds: BUCKET_SECONDS, points: history } });
    },
  };
}
