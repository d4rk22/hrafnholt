export function serviceHealthSummary(panel) {
  if (panel.status !== "ok" || !panel.data) {
    return {
      healthy: null, down: null, other: 0, total: 0,
      upPercent: 0, downPercent: 0, otherPercent: 0,
      state: panel.status === "ok" ? "error" : panel.status,
    };
  }

  const { healthy, down, monitors } = panel.data;
  const total = Math.max(monitors.length, healthy + down);
  const other = total - healthy - down;
  return {
    healthy, down, other, total,
    upPercent: total ? healthy / total * 100 : 0,
    downPercent: total ? down / total * 100 : 0,
    otherPercent: total ? other / total * 100 : 0,
    state: !total ? "empty" : down ? "down" : other ? "other" : "up",
  };
}
