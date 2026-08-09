import { watchlistDataSchema, type DashboardSnapshot } from "../contracts/dashboard.js";
import { boundedText } from "./collector.js";

const watchlistId = (prefix: string, value: string) => boundedText(`${prefix}-${value}`, 120);

export function addDerivedWatchlist(snapshot: DashboardSnapshot): DashboardSnapshot {
  const items: Array<{ id: string; severity: "info" | "warning" | "critical"; title: string; detail: string; ageLabel: string }> = [];
  for (const [key, panel] of Object.entries(snapshot.panels)) {
    if (key === "watchlist") continue;
    if (panel.status === "error" || panel.status === "stale") {
      items.push({
        id: `panel-${key}`,
        severity: panel.status === "error" ? "critical" : "warning",
        title: `${panel.source} ${panel.status}`,
        detail: panel.message ?? `The ${key} panel has no fresh source data.`,
        ageLabel: panel.ageSeconds === null ? "now" : `${Math.round(panel.ageSeconds)}s`,
      });
    }
  }
  for (const environment of snapshot.panels.arcane.data?.environments ?? []) {
    if (!environment.connected) items.push({ id: watchlistId("arcane", environment.id), severity: "warning", title: `${environment.name} environment unavailable`, detail: "Arcane cannot currently read this environment; it is not reported healthy.", ageLabel: "live" });
  }
  for (const job of snapshot.panels.backups.data?.jobs ?? []) {
    if (job.result === "not_configured") items.push({ id: watchlistId("backup", job.id), severity: "info", title: job.name, detail: job.message ?? "Backup job is not configured.", ageLabel: "planned" });
    if (["warning", "failure", "unavailable"].includes(job.result)) items.push({ id: watchlistId("backup", job.id), severity: job.result === "failure" ? "critical" : "warning", title: `${job.name} ${job.result.replace("_", " ")}`, detail: job.message ?? "Review the selected backup task.", ageLabel: "latest" });
  }
  for (const node of snapshot.panels.proxmox.data?.nodes ?? []) {
    if (node.status !== "online") items.push({ id: watchlistId("pve", node.name), severity: node.status === "down" ? "critical" : "warning", title: `${node.name} ${node.status}`, detail: "The Proxmox audit response does not confirm this node is online.", ageLabel: "live" });
  }
  const down = snapshot.panels.servicePosture.data?.down ?? 0;
  if (down > 0) items.push({ id: "kuma-down", severity: "critical", title: `${down} monitored service${down === 1 ? "" : "s"} down`, detail: "Uptime Kuma reports a failed public status-page monitor.", ageLabel: "live" });

  const now = snapshot.generatedAt;
  snapshot.panels.watchlist = {
    status: "ok",
    source: "Dashboard normalized facts",
    lastAttemptAt: now,
    lastSuccessAt: now,
    ageSeconds: 0,
    staleAfterSeconds: 120,
    message: null,
    data: watchlistDataSchema.parse({ items: items.slice(0, 20) }),
  };
  return snapshot;
}
