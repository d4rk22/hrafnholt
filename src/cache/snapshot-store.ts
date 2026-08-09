import type { DashboardSnapshot, PanelData, PanelKey } from "../contracts/dashboard.js";
import { sanitizeOperatorMessage } from "../logging.js";

export type SnapshotClock = { now: () => number };

const systemClock: SnapshotClock = { now: () => Date.now() };

export class SnapshotStore {
  private readonly panels: DashboardSnapshot["panels"];
  private readonly attempted = new Set<PanelKey>();

  constructor(initialPanels: DashboardSnapshot["panels"], private readonly clock: SnapshotClock = systemClock) {
    this.panels = structuredClone(initialPanels);
  }

  recordAttempt(key: PanelKey, attemptedAt = this.clock.now()): void {
    this.attempted.add(key);
    this.panels[key].lastAttemptAt = new Date(attemptedAt).toISOString();
  }

  recordSuccess<K extends PanelKey>(key: K, data: PanelData<K>, attemptedAt = this.clock.now()): void {
    const panel = this.panels[key];
    const timestamp = new Date(attemptedAt).toISOString();
    panel.status = "ok";
    panel.lastAttemptAt = timestamp;
    panel.lastSuccessAt = timestamp;
    panel.ageSeconds = 0;
    panel.message = null;
    panel.data = data as never;
    this.attempted.add(key);
  }

  recordFailure(key: PanelKey, error: unknown, attemptedAt = this.clock.now()): void {
    const panel = this.panels[key];
    panel.lastAttemptAt = new Date(attemptedAt).toISOString();
    panel.message = sanitizeOperatorMessage(error);
    panel.status = panel.data === null ? "error" : this.statusFromAge(panel, attemptedAt);
    this.attempted.add(key);
  }

  recordDisabled(key: PanelKey, message: string): void {
    const panel = this.panels[key];
    panel.status = "disabled";
    panel.data = null;
    panel.message = sanitizeOperatorMessage(message);
    panel.lastAttemptAt = null;
    panel.lastSuccessAt = null;
    panel.ageSeconds = null;
    this.attempted.add(key);
  }

  hasAttempted(key: PanelKey): boolean {
    return this.attempted.has(key);
  }

  attemptedCount(keys?: PanelKey[]): number {
    return keys ? keys.filter((key) => this.attempted.has(key)).length : this.attempted.size;
  }

  snapshot(mode: DashboardSnapshot["mode"]): DashboardSnapshot {
    const now = this.clock.now();
    const panels = structuredClone(this.panels);
    for (const panel of Object.values(panels)) {
      if (panel.lastSuccessAt) {
        panel.ageSeconds = Math.max(0, (now - Date.parse(panel.lastSuccessAt)) / 1000);
        if (panel.status !== "disabled" && panel.status !== "error") {
          panel.status = this.statusFromAge(panel, now);
        }
      }
    }
    return {
      schemaVersion: "1.0.0",
      generatedAt: new Date(now).toISOString(),
      mode,
      demoState: null,
      panels,
    };
  }

  private statusFromAge(
    panel: DashboardSnapshot["panels"][PanelKey],
    now: number,
  ): "ok" | "stale" {
    if (!panel.lastSuccessAt) return "ok";
    const ageSeconds = Math.max(0, (now - Date.parse(panel.lastSuccessAt)) / 1000);
    return ageSeconds > panel.staleAfterSeconds ? "stale" : "ok";
  }
}
