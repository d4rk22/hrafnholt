import type { DashboardSnapshot, DemoState, PanelKey } from "./contracts/dashboard.js";

const SYNTHETIC_NOW = "2030-01-15T12:00:00.000Z";
const SYNTHETIC_STALE_SUCCESS = "2030-01-15T11:40:00.000Z";
const PANEL_KEYS: PanelKey[] = [
  "streams",
  "bandwidth",
  "plexHost",
  "power",
  "rackPower",
  "ups",
  "sabQueues",
  "episodes",
  "movies",
  "arcane",
  "proxmox",
  "truenasStorage",
  "backups",
  "servicePosture",
  "watchlist",
];

function markStale(snapshot: DashboardSnapshot, key: PanelKey, message: string): void {
  const panel = snapshot.panels[key];
  panel.status = "stale";
  panel.lastAttemptAt = SYNTHETIC_NOW;
  panel.lastSuccessAt = SYNTHETIC_STALE_SUCCESS;
  panel.ageSeconds = 1_200;
  panel.staleAfterSeconds = Math.min(panel.staleAfterSeconds, 300);
  panel.message = message;
}

export function createDemoSnapshot(healthyFixture: DashboardSnapshot, state: DemoState): DashboardSnapshot {
  const snapshot = structuredClone(healthyFixture);
  snapshot.generatedAt = SYNTHETIC_NOW;
  snapshot.mode = "fixture";
  snapshot.demoState = state;

  if (state === "empty") {
    for (const key of PANEL_KEYS) {
      const panel = snapshot.panels[key];
      panel.status = "disabled";
      panel.source = "Synthetic empty fixture";
      panel.lastAttemptAt = null;
      panel.lastSuccessAt = null;
      panel.ageSeconds = null;
      panel.message = "No records are present in this synthetic scenario";
      panel.data = null;
    }
  }

  if (state === "stale") {
    for (const key of PANEL_KEYS) {
      markStale(snapshot, key, "Synthetic last-good data is outside its freshness window");
    }
  }

  if (state === "degraded") {
    markStale(snapshot, "power", "Synthetic energy samples are delayed");
    markStale(snapshot, "backups", "Synthetic verification detail is delayed");
    snapshot.panels.backups.data!.pbs!.status = "degraded";
    snapshot.panels.backups.data!.pbs!.verificationResult = "warning";
    snapshot.panels.truenasStorage.data!.health = "degraded";
    snapshot.panels.servicePosture.data!.healthy = 4;
    snapshot.panels.servicePosture.data!.down = 1;
    snapshot.panels.servicePosture.data!.monitors[1]!.status = "down";
    snapshot.panels.watchlist.data!.items = [{
      id: "demo-delayed-energy",
      severity: "warning",
      title: "Synthetic telemetry delay",
      detail: "One bounded demo source is reporting delayed samples.",
      ageLabel: "demo state",
    }];
  }

  if (state === "collector-failure") {
    const failed = snapshot.panels.sabQueues;
    failed.status = "error";
    failed.source = "Synthetic download collector";
    failed.lastAttemptAt = SYNTHETIC_NOW;
    failed.lastSuccessAt = null;
    failed.ageSeconds = null;
    failed.message = "Synthetic collector unavailable";
    failed.data = null;
    snapshot.panels.watchlist.data!.items = [{
      id: "demo-collector-failure",
      severity: "critical",
      title: "Synthetic collector failure",
      detail: "The download fixture failed while independent panels stayed healthy.",
      ageLabel: "demo state",
    }];
  }

  return snapshot;
}

export const syntheticDemoTimestamp = SYNTHETIC_NOW;
