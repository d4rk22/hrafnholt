import type { PanelKey } from "../contracts/dashboard.js";
import type { Collector } from "../collectors/collector.js";
import { sanitizeOperatorMessage } from "../logging.js";
import { SnapshotStore } from "./snapshot-store.js";

export type SchedulerClock = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (timer: unknown) => void;
  random: () => number;
};

const systemClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
  random: () => Math.random(),
};

export class CollectorScheduler {
  private readonly running = new Map<PanelKey, AbortController>();
  private readonly timers = new Map<PanelKey, unknown>();
  private stopping = false;

  constructor(
    private readonly collectors: Collector[],
    private readonly store: SnapshotStore,
    private readonly clock: SchedulerClock = systemClock,
  ) {}

  start(): void {
    this.stopping = false;
    for (const collector of this.collectors) {
      if (!collector.enabled) {
        this.store.recordDisabled(collector.panel, `${collector.source} is not configured`);
        continue;
      }
      const jitter = Math.min(1_000, Math.floor(collector.intervalMs * 0.1 * this.clock.random()));
      this.schedule(collector, jitter);
    }
  }

  async runOnce(collector: Collector): Promise<boolean> {
    if (!collector.enabled) {
      this.store.recordDisabled(collector.panel, `${collector.source} is not configured`);
      return false;
    }
    if (this.running.has(collector.panel)) return false;

    const controller = new AbortController();
    this.running.set(collector.panel, controller);
    const attemptedAt = this.clock.now();
    this.store.recordAttempt(collector.panel, attemptedAt);
    let timeout: unknown;

    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = this.clock.setTimeout(() => {
          controller.abort();
          reject(new Error(`${collector.name} timed out`));
        }, collector.timeoutMs);
      });
      const raw = await Promise.race([
        collector.collect({ signal: controller.signal, now: new Date(attemptedAt) }),
        timeoutPromise,
      ]);
      const parsed = collector.schema.parse(raw);
      this.store.recordSuccess(collector.panel, parsed as never, attemptedAt);
      return true;
    } catch (error) {
      this.store.recordFailure(collector.panel, sanitizeOperatorMessage(error), attemptedAt);
      return false;
    } finally {
      if (timeout !== undefined) this.clock.clearTimeout(timeout);
      this.running.delete(collector.panel);
    }
  }

  readiness(configurationValid: boolean): {
    ready: boolean;
    attemptedCollectors: number;
    requiredCollectors: number;
  } {
    const required = this.collectors.filter((collector) => collector.required && collector.enabled);
    const attemptedCollectors = this.store.attemptedCount(required.map((collector) => collector.panel));
    return {
      ready: configurationValid && attemptedCollectors === required.length,
      attemptedCollectors,
      requiredCollectors: required.length,
    };
  }

  stop(): void {
    this.stopping = true;
    for (const timer of this.timers.values()) this.clock.clearTimeout(timer);
    this.timers.clear();
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
  }

  private schedule(collector: Collector, delayMs: number): void {
    const timer = this.clock.setTimeout(() => {
      void this.runOnce(collector).finally(() => {
        if (!this.stopping) {
          const jitterFactor = 0.95 + this.clock.random() * 0.1;
          this.schedule(collector, Math.floor(collector.intervalMs * jitterFactor));
        }
      });
    }, delayMs);
    this.timers.set(collector.panel, timer);
  }
}
