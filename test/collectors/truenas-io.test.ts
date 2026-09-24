import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTrueNasIoCollector,
  normalizeRealtimeSample,
  summarizeSamples,
  TrueNasRealtimeFeed,
  type RealtimeSocket,
} from "../../src/collectors/truenas-io.js";
import { truenasIoDataSchema } from "../../src/contracts/dashboard.js";

function realtimeFields(overrides: { readBytes?: number; writeBytes?: number; busy?: number; hits?: number; accesses?: number } = {}) {
  return {
    zfs: {
      demand_accesses_per_second: overrides.accesses ?? 1_000,
      demand_data_hits_per_second: (overrides.hits ?? 990) - 100,
      demand_metadata_hits_per_second: 100,
      demand_data_hit_percentage: 0,
    },
    disks: {
      read_ops: 900,
      read_bytes: overrides.readBytes ?? 100_000_000,
      write_ops: 100,
      write_bytes: overrides.writeBytes ?? 4_000_000,
      busy: overrides.busy ?? 50,
    },
    interfaces: {},
    pools: {},
  };
}

class FakeSocket implements RealtimeSocket {
  static instances: FakeSocket[] = [];
  sent: Array<{ id: number; method: string; params: unknown[] }> = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }

  reply(id: number, result: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id, result }) });
  }

  emit(fields: unknown): void {
    this.onmessage?.({
      data: JSON.stringify({ jsonrpc: "2.0", method: "collection_update", params: { msg: "changed", collection: "reporting.realtime", fields } }),
    });
  }
}

function manualClock(start = Date.parse("2030-01-15T12:00:00.000Z")) {
  let now = start;
  const timers: Array<{ at: number; callback: () => void }> = [];
  return {
    now: () => now,
    setTimeout: (callback: () => void, delayMs: number) => {
      const timer = { at: now + delayMs, callback };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer: unknown) => {
      const index = timers.indexOf(timer as never);
      if (index >= 0) timers.splice(index, 1);
    },
    advance: (ms: number) => {
      now += ms;
      for (const timer of timers.filter((entry) => entry.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
    },
    pending: () => timers.length,
  };
}

test("normalizes a reporting.realtime event into an IO sample", () => {
  assert.deepEqual(normalizeRealtimeSample(realtimeFields()), {
    readBytesPerSecond: 100_000_000,
    writeBytesPerSecond: 4_000_000,
    iops: 1_000,
    busyPercent: 50,
    arcHits: 990,
    arcAccesses: 1_000,
  });
  assert.equal(normalizeRealtimeSample({ zfs: {}, memory: {} }), null);
  const clamped = normalizeRealtimeSample({ disks: { read_bytes: -5, write_bytes: "7", read_ops: null, write_ops: 2, busy: 140 } });
  assert.deepEqual(clamped, { readBytesPerSecond: 0, writeBytesPerSecond: 7, iops: 2, busyPercent: 100, arcHits: 0, arcAccesses: 0 });
});

test("summarizes samples as averages with an access-weighted ARC hit ratio", () => {
  const summary = summarizeSamples([
    normalizeRealtimeSample(realtimeFields({ readBytes: 100, writeBytes: 10, busy: 40, hits: 900, accesses: 1_000 }))!,
    normalizeRealtimeSample(realtimeFields({ readBytes: 300, writeBytes: 30, busy: 60, hits: 3_000, accesses: 3_000 }))!,
  ]);
  assert.equal(summary.readBytesPerSecond, 200);
  assert.equal(summary.writeBytesPerSecond, 20);
  assert.equal(summary.busyPercent, 50);
  assert.equal(summary.iops, 1_000);
  assert.equal(summary.arcHitPercent, 97.5);
  const idle = summarizeSamples([{ readBytesPerSecond: 0, writeBytesPerSecond: 0, iops: 0, busyPercent: 0, arcHits: 0, arcAccesses: 0 }]);
  assert.equal(idle.arcHitPercent, null);
});

test("feed authenticates, subscribes, buffers events, and reconnects with backoff", () => {
  FakeSocket.instances = [];
  const clock = manualClock();
  const feed = new TrueNasRealtimeFeed("https://truenas.example/", "concealed", {
    createSocket: (url) => new FakeSocket(url),
    clock,
  });
  feed.start();
  const socket = FakeSocket.instances[0]!;
  assert.equal(socket.url, "wss://truenas.example/api/current");
  socket.onopen?.();
  assert.deepEqual(socket.sent[0], { jsonrpc: "2.0", id: 1, method: "auth.login_with_api_key", params: ["concealed"] });
  socket.reply(1, true);
  assert.deepEqual(socket.sent[1], { jsonrpc: "2.0", id: 2, method: "core.subscribe", params: ["reporting.realtime"] });

  socket.emit(realtimeFields());
  socket.emit({ zfs: {} });
  assert.equal(feed.lastEventAt, clock.now());
  assert.equal(feed.drain().length, 1);
  assert.equal(feed.drain().length, 0);

  socket.onclose?.();
  assert.equal(FakeSocket.instances.length, 1);
  clock.advance(5_000);
  assert.equal(FakeSocket.instances.length, 2);
  FakeSocket.instances[1]!.onclose?.();
  clock.advance(5_000);
  assert.equal(FakeSocket.instances.length, 2, "second retry backs off past 5s");
  clock.advance(5_000);
  assert.equal(FakeSocket.instances.length, 3);

  feed.close();
  assert.equal(FakeSocket.instances[2]!.closed, true);
  clock.advance(120_000);
  assert.equal(FakeSocket.instances.length, 3, "closed feed does not reconnect");
});

test("feed drops the connection when API key login is rejected", () => {
  FakeSocket.instances = [];
  const clock = manualClock();
  const feed = new TrueNasRealtimeFeed("https://truenas.example", "concealed", { createSocket: (url) => new FakeSocket(url), clock });
  feed.start();
  const socket = FakeSocket.instances[0]!;
  socket.onopen?.();
  socket.reply(1, false);
  assert.equal(socket.closed, true);
  assert.match(feed.lastError ?? "", /login/i);
  feed.close();
});

test("collector returns averaged IO with a bounded 15-minute history", async () => {
  FakeSocket.instances = [];
  const clock = manualClock();
  const feed = new TrueNasRealtimeFeed("https://truenas.example", "concealed", { createSocket: (url) => new FakeSocket(url), clock });
  const collector = createTrueNasIoCollector("https://truenas.example", "concealed", { feed, clock });
  assert.equal(collector.panel, "truenasIo");
  assert.equal(collector.intervalMs, 5_000);
  assert.equal(collector.required, false);
  const context = { signal: new AbortController().signal, now: new Date(clock.now()) };

  await assert.rejects(collector.collect(context), /waiting/i);
  const socket = FakeSocket.instances[0]!;
  socket.onopen?.();
  socket.reply(1, true);

  for (let index = 0; index < 200; index += 1) {
    socket.emit(realtimeFields({ readBytes: 100 + index }));
    socket.emit(realtimeFields({ readBytes: 300 + index }));
    clock.advance(5_000);
    socket.emit(realtimeFields({ readBytes: 200 + index }));
    const data = truenasIoDataSchema.parse(await collector.collect(context));
    if (index === 0) {
      assert.equal(data.readBytesPerSecond, 200);
      assert.equal(data.history.points.length, 1);
    }
    if (index === 199) {
      assert.equal(data.history.points.length, 180);
      assert.equal(data.history.bucketSeconds, 5);
      assert.equal(data.history.points.at(-1)!.readBytesPerSecond, data.readBytesPerSecond);
      assert.equal(data.history.points.at(-1)!.busyPercent, data.busyPercent);
    }
  }

  clock.advance(25_000);
  await assert.rejects(collector.collect(context), /no realtime events/i);
  collector.stop?.();
  assert.equal(socket.closed, true);
});
