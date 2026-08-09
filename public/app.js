import {
  MAP_VIEWBOX,
  calculateActiveMapViewport,
  calculateMapLabelWidth,
  calculateRouteControlPoint,
  groupLocatedStreamsByCity,
  isValidMapLocation,
  layoutMapLabels,
  mapMarkerObstacle,
  projectMapLocation,
  projectWorldLocation,
  selectMapMode,
} from "./map-viewport.js";
import {
  createPrivacyAliasRegistry,
  displayedPlexUsername,
  privacyModeKeyAction,
} from "./privacy-mode.js";

const MAP_HOME_DECORATION_MARGIN = 54;
const DEFAULT_CONFIGURATION = Object.freeze({
  branding: { title: "Ravenhill", subtitle: "Operations dashboard", home_label: "Home" },
  locale: "en-US",
  timezone: "UTC",
  currency: "USD",
  home: null,
  privacy: { default_mode: "public", allow_private_toggle: false },
  units: { temperature: "celsius" },
  associations: { plex_host_proxmox_node: null },
});
const TRAFFIC_PLOT = { left: 78, right: 299, baseline: 39, downloadTop: 6, downloadZero: 36, uploadZero: 42, uploadBottom: 72 };
const CAPACITY_PLOT = { left: 48, right: 696, top: 16, bottom: 164 };
const WORKLOAD_PLOT = { left: 48, right: 696, top: 8, bottom: 62 };
let trafficPoints = [];
let trafficFocusIndex = -1;
let capacityPoints = [];
let capacityFocusIndex = -1;
let capacityPointerRatio = null;
let currentEpisodesPanel = null;
let currentEpisodeDate = null;
let selectedEpisodeDate = null;
const privacyAliasRegistry = createPrivacyAliasRegistry();
let privacyMode = "public";
let latestStreamsPanel = null;
let presentation = DEFAULT_CONFIGURATION;
let syntheticClock = null;
const requestedDemoState = new URLSearchParams(window.location.search).get("demo");

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const number = (value, digits = 0) => Number(value ?? 0).toLocaleString(presentation.locale, { maximumFractionDigits: digits });
const percent = (value) => `${number(value)}%`;
const countValue = (value, digits = 0) => Number.isFinite(value) ? number(value, digits) : "—";
const gigabytes = (value) => `${number(Number(value ?? 0) / 1_000_000_000, 1)} GB`;
const dataSize = (value) => {
  const bytes = Math.max(0, Number(value ?? 0));
  if (bytes < 2 ** 10) return `${number(bytes)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(2 ** 10)), units.length);
  const size = bytes / (2 ** (10 * exponent));
  return `${number(size, size < 10 ? 1 : 0)} ${units[exponent - 1]}`;
};
const memoryGigabytes = (value) => `${number(Number(value ?? 0) / 2 ** 30)} GB`;
const tebibytes = (value) => `${number(Number(value ?? 0) / 2 ** 40, 2)} TiB`;
const money = (value) => Number(value ?? 0).toLocaleString(presentation.locale, { style: "currency", currency: presentation.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyRate = (value) => Number(value ?? 0).toLocaleString(presentation.locale, { style: "currency", currency: presentation.currency, minimumFractionDigits: 4, maximumFractionDigits: 4 });
const temperature = (value) => presentation.units.temperature === "fahrenheit" ? Number(value ?? 0) * 9 / 5 + 32 : Number(value ?? 0);
const temperatureSuffix = () => presentation.units.temperature === "fahrenheit" ? "°F" : "°C";
const capacityPair = (used, total) => {
  const divisor = Number(total ?? 0) >= 1_000_000_000_000 ? 1_000_000_000_000 : 1_000_000_000;
  const unit = divisor === 1_000_000_000_000 ? "TB" : "GB";
  const format = (value) => number(Number(value ?? 0) / divisor, Number(value ?? 0) / divisor < 10 ? 1 : 0);
  return `${format(used)} / ${format(total)} ${unit}`;
};
const memoryPair = (used, total) => `${number(Number(used ?? 0) / 2 ** 30)} / ${number(Number(total ?? 0) / 2 ** 30)} GB`;
const duration = (seconds) => {
  const total = Math.max(0, Number(seconds ?? 0));
  if (total >= 3600) return `${Math.floor(total / 3600)}h ${Math.round((total % 3600) / 60)}m`;
  return `${Math.round(total / 60)}m`;
};
const backupDuration = (seconds) => Number(seconds ?? 0) < 60 ? `${number(Math.max(0, Number(seconds ?? 0)))}s` : duration(seconds);
const clockTime = (value) => new Date(value).toLocaleTimeString(presentation.locale, { timeZone: presentation.timezone, hour: "numeric", minute: "2-digit" });
const shortTimestamp = (value) => {
  if (!value) return "not recorded";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "not recorded";
  const date = timestamp.toLocaleDateString(presentation.locale, { timeZone: presentation.timezone, month: "short", day: "numeric" });
  const time = timestamp.toLocaleTimeString(presentation.locale, { timeZone: presentation.timezone, hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
};
const ageLabel = (panel) => panel.ageSeconds === null ? "not collected" : panel.ageSeconds < 60 ? `${Math.round(panel.ageSeconds)}s ago` : `${Math.round(panel.ageSeconds / 60)}m ago`;
const updatedAgeLabel = (panel) => panel.ageSeconds === null ? "not collected" : `updated ${ageLabel(panel).replace(" ago", "")}`;

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function setFill(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.style.setProperty("--fill", `${Math.min(100, Math.max(0, Number(value ?? 0)))}%`);
}

function setPanelState(selector, panel) {
  const element = document.querySelector(selector);
  if (!element) return;
  element.dataset.state = panel.status;
  element.title = panel.message ? `${panel.source}: ${panel.message}` : `${panel.source} · ${ageLabel(panel)}`;
}

function emptyState(panel, healthyEmptyMessage) {
  if (panel.data) return "";
  const title = panel.status === "disabled" ? "Not configured" : panel.status === "error" ? "Source unavailable" : "No current data";
  return `<div class="panel-state panel-state--${escapeHtml(panel.status)}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(panel.message ?? healthyEmptyMessage)}</span></div>`;
}

function trafficPath(points) {
  return points.map((point, index) => `${index ? "L" : "M"}${number(point.x, 2)},${number(point.y, 2)}`).join(" ");
}

function setTrafficFocus(index, announce = false) {
  const chart = document.querySelector("#traffic-chart");
  const tooltip = document.querySelector("#traffic-tooltip");
  const focus = chart?.querySelector(".traffic-chart__focus");
  if (!chart || !tooltip || !focus || !trafficPoints.length) return;
  trafficFocusIndex = Math.max(0, Math.min(trafficPoints.length - 1, index));
  const point = trafficPoints[trafficFocusIndex];
  focus.toggleAttribute("hidden", false);
  focus.querySelector(".traffic-chart__crosshair")?.setAttribute("x1", point.x);
  focus.querySelector(".traffic-chart__crosshair")?.setAttribute("x2", point.x);
  const downloadPoint = focus.querySelector(".traffic-chart__point--download");
  downloadPoint?.setAttribute("cx", point.x);
  downloadPoint?.setAttribute("cy", point.downloadY);
  const uploadPoint = focus.querySelector(".traffic-chart__point--upload");
  uploadPoint?.setAttribute("cx", point.x);
  uploadPoint?.setAttribute("cy", point.uploadY);
  const sampledAt = new Date(point.sample.sampledAt);
  const time = Number.isNaN(sampledAt.getTime()) ? "Time unavailable" : sampledAt.toLocaleTimeString(presentation.locale, {
    timeZone: presentation.timezone, hour: "numeric", minute: "2-digit", second: "2-digit",
  });
  tooltip.innerHTML = `<time>${escapeHtml(time)}</time><span class="traffic-tooltip__download">↓ ${escapeHtml(number(point.sample.downloadMbps, 3))} Mbps</span><span class="traffic-tooltip__upload">↑ ${escapeHtml(number(point.sample.uploadMbps, 3))} Mbps</span>`;
  tooltip.style.setProperty("--tooltip-x", `${Math.max(36, Math.min(82, point.x / 3))}%`);
  tooltip.toggleAttribute("hidden", false);
  if (announce) tooltip.setAttribute("aria-live", "polite");
}

function hideTrafficFocus() {
  document.querySelector("#traffic-chart .traffic-chart__focus")?.toggleAttribute("hidden", true);
  document.querySelector("#traffic-tooltip")?.toggleAttribute("hidden", true);
}

function renderTraffic(panel) {
  setPanelState(".signal-metric--network", panel);
  const chart = document.querySelector("#traffic-chart");
  if (!chart) return;
  const samples = (panel.data?.samples ?? []).filter((sample) => sample
    && Number.isFinite(sample.downloadMbps) && Number.isFinite(sample.uploadMbps));
  const span = TRAFFIC_PLOT.right - TRAFFIC_PLOT.left;
  const downloadMax = Math.max(1, ...samples.map((sample) => sample.downloadMbps));
  const uploadMax = Math.max(1, ...samples.map((sample) => sample.uploadMbps));
  trafficPoints = samples.map((sample, index) => {
    const x = samples.length === 1 ? TRAFFIC_PLOT.right : TRAFFIC_PLOT.left + index / (samples.length - 1) * span;
    return {
      sample,
      x,
      downloadY: TRAFFIC_PLOT.downloadZero - sample.downloadMbps / downloadMax * (TRAFFIC_PLOT.downloadZero - TRAFFIC_PLOT.downloadTop),
      uploadY: TRAFFIC_PLOT.uploadZero + sample.uploadMbps / uploadMax * (TRAFFIC_PLOT.uploadBottom - TRAFFIC_PLOT.uploadZero),
    };
  });
  const download = trafficPoints.map((point) => ({ x: point.x, y: point.downloadY }));
  const upload = trafficPoints.map((point) => ({ x: point.x, y: point.uploadY }));
  const downloadLine = trafficPath(download);
  const uploadLine = trafficPath(upload);
  chart.querySelector(".traffic-chart__line--download")?.setAttribute("d", downloadLine);
  chart.querySelector(".traffic-chart__line--upload")?.setAttribute("d", uploadLine);
  chart.querySelector(".traffic-chart__area--download")?.setAttribute("d", download.length ? `M${download[0].x},${TRAFFIC_PLOT.baseline} ${downloadLine.replace(/^M/, "L")} L${download.at(-1).x},${TRAFFIC_PLOT.baseline} Z` : "");
  chart.querySelector(".traffic-chart__area--upload")?.setAttribute("d", upload.length ? `M${upload[0].x},${TRAFFIC_PLOT.baseline} ${uploadLine.replace(/^M/, "L")} L${upload.at(-1).x},${TRAFFIC_PLOT.baseline} Z` : "");
  document.querySelector("#traffic-empty")?.toggleAttribute("hidden", samples.length > 0);
  chart.setAttribute("aria-label", samples.length
    ? `House traffic history with ${samples.length} aligned samples. Current download ${number(panel.data.downloadMbps, 3)} megabits per second and upload ${number(panel.data.uploadMbps, 3)} megabits per second.`
    : `House traffic ${panel.status === "error" ? "unavailable" : "waiting for samples"}.`);
  hideTrafficFocus();
}

function initializeTrafficChart() {
  const chart = document.querySelector("#traffic-chart");
  if (!chart) return;
  chart.addEventListener("pointermove", (event) => {
    if (!trafficPoints.length) return;
    const rect = chart.getBoundingClientRect();
    const viewX = (event.clientX - rect.left) / rect.width * 300;
    const ratio = (viewX - TRAFFIC_PLOT.left) / (TRAFFIC_PLOT.right - TRAFFIC_PLOT.left);
    setTrafficFocus(Math.round(Math.max(0, Math.min(1, ratio)) * (trafficPoints.length - 1)));
  });
  chart.addEventListener("pointerleave", hideTrafficFocus);
  chart.addEventListener("focus", () => setTrafficFocus(trafficFocusIndex < 0 ? trafficPoints.length - 1 : trafficFocusIndex, true));
  chart.addEventListener("blur", hideTrafficFocus);
  chart.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setTrafficFocus((trafficFocusIndex < 0 ? trafficPoints.length - 1 : trafficFocusIndex) + (event.key === "ArrowLeft" ? -1 : 1), true);
  });
}

const capacityY = (value) => CAPACITY_PLOT.bottom - Math.min(100, Math.max(0, Number(value ?? 0))) / 100 * (CAPACITY_PLOT.bottom - CAPACITY_PLOT.top);
const workloadY = (value, maximum) => Number.isFinite(value)
  ? WORKLOAD_PLOT.bottom - Math.min(maximum, Math.max(0, Number(value))) / maximum * (WORKLOAD_PLOT.bottom - WORKLOAD_PLOT.top)
  : null;

function steppedCapacityPath(points, key) {
  let path = "";
  let previous = null;
  points.forEach((point) => {
    const y = point[key];
    if (!Number.isFinite(y)) {
      previous = null;
      return;
    }
    if (!previous) path += `M${point.x},${y}`;
    else path += ` L${point.x},${previous.y} L${point.x},${y}`;
    previous = { x: point.x, y };
  });
  return path;
}

function hideCapacityFocus() {
  document.querySelector("#capacity-chart .capacity-chart__focus")?.toggleAttribute("hidden", true);
  document.querySelector("#capacity-workload-chart .capacity-workload__focus")?.toggleAttribute("hidden", true);
  document.querySelector("#capacity-tooltip")?.toggleAttribute("hidden", true);
}

function setCapacityFocus(index, announce = false) {
  const chart = document.querySelector("#capacity-chart");
  const tooltip = document.querySelector("#capacity-tooltip");
  const focus = chart?.querySelector(".capacity-chart__focus");
  const workloadFocus = document.querySelector("#capacity-workload-chart .capacity-workload__focus");
  if (!chart || !tooltip || !focus || !capacityPoints.length) return;
  capacityFocusIndex = Math.max(0, Math.min(capacityPoints.length - 1, index));
  const point = capacityPoints[capacityFocusIndex];
  focus.toggleAttribute("hidden", false);
  focus.querySelector(".capacity-chart__crosshair")?.setAttribute("x1", point.x);
  focus.querySelector(".capacity-chart__crosshair")?.setAttribute("x2", point.x);
  ["encode", "decode", "cpu", "ram", "vram"].forEach((metric) => {
    const marker = focus.querySelector(`.capacity-chart__point--${metric}`);
    marker?.setAttribute("cx", point.x);
    marker?.setAttribute("cy", point[`${metric}Y`]);
  });
  const workloadMetrics = [
    ["streams", point.streamAverageY],
    ["video-transcodes", point.videoTranscodeAverageY],
  ];
  const hasWorkload = workloadMetrics.some(([, y]) => Number.isFinite(y));
  workloadFocus?.toggleAttribute("hidden", !hasWorkload);
  workloadFocus?.querySelector(".capacity-chart__crosshair")?.setAttribute("x1", point.x);
  workloadFocus?.querySelector(".capacity-chart__crosshair")?.setAttribute("x2", point.x);
  workloadMetrics.forEach(([metric, y]) => {
    const marker = workloadFocus?.querySelector(`.capacity-workload__point--${metric}`);
    marker?.toggleAttribute("hidden", !Number.isFinite(y));
    if (Number.isFinite(y)) {
      marker?.setAttribute("cx", point.x);
      marker?.setAttribute("cy", y);
    }
  });
  const sampledAt = new Date(point.sample.sampledAt);
  const time = Number.isNaN(sampledAt.getTime()) ? "Time unavailable" : sampledAt.toLocaleString(presentation.locale, {
    timeZone: presentation.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const workloadRows = hasWorkload
    ? `<span class="capacity-tooltip__workload capacity-tooltip__streams">Streams avg ${escapeHtml(countValue(point.sample.streamAverage, 1))} · peak ${escapeHtml(countValue(point.sample.streamPeak))}</span><span class="capacity-tooltip__workload capacity-tooltip__video-transcodes">Video transcodes avg ${escapeHtml(countValue(point.sample.videoTranscodeAverage, 1))} · peak ${escapeHtml(countValue(point.sample.videoTranscodePeak))}</span>`
    : `<span class="capacity-tooltip__workload capacity-tooltip__collecting">Workload history collecting from deployment</span>`;
  tooltip.innerHTML = `<time>${escapeHtml(time)}</time><span class="capacity-tooltip__encode">GPU encode ${escapeHtml(percent(point.sample.encodePercent))}</span><span class="capacity-tooltip__decode">GPU decode ${escapeHtml(percent(point.sample.decodePercent))}</span><span class="capacity-tooltip__cpu">CPU ${escapeHtml(percent(point.sample.cpuPercent))}</span><span class="capacity-tooltip__ram">RAM ${escapeHtml(percent(point.sample.ramPercent))}</span><span class="capacity-tooltip__vram">VRAM ${escapeHtml(percent(point.sample.vramPercent))}</span>${workloadRows}`;
  tooltip.style.setProperty("--tooltip-x", `${Math.max(16, Math.min(84, point.x / 7.2))}%`);
  tooltip.toggleAttribute("hidden", false);
  if (announce) tooltip.setAttribute("aria-live", "polite");
}

function restoreCapacityFocusAfterRender() {
  const chart = document.querySelector("#capacity-chart");
  const workloadChart = document.querySelector("#capacity-workload-chart");
  const pointerStillHovering = capacityPointerRatio !== null
    && [chart, workloadChart].some((interactiveChart) => interactiveChart?.matches(":hover"));
  if (pointerStillHovering && capacityPoints.length) {
    setCapacityFocus(Math.round(capacityPointerRatio * (capacityPoints.length - 1)));
    return;
  }
  if (document.activeElement === chart && capacityFocusIndex >= 0 && capacityPoints.length) {
    setCapacityFocus(capacityFocusIndex);
    return;
  }
  capacityPointerRatio = null;
  hideCapacityFocus();
}

function renderPlexCapacity(panel) {
  setPanelState(".panel--plex-capacity", panel);
  document.querySelector(".panel--plex-capacity")?.removeAttribute("title");
  const chart = document.querySelector("#capacity-chart");
  const workloadChart = document.querySelector("#capacity-workload-chart");
  const history = panel.data?.history;
  const samples = (history?.points ?? []).filter((sample) => sample && [sample.encodePercent, sample.decodePercent, sample.cpuPercent, sample.ramPercent, sample.vramPercent].every(Number.isFinite));
  const span = CAPACITY_PLOT.right - CAPACITY_PLOT.left;
  const workloadValues = samples.flatMap((sample) => [sample.streamAverage, sample.streamPeak, sample.videoTranscodeAverage, sample.videoTranscodePeak]).filter(Number.isFinite);
  const workloadMaximum = Math.max(1, Math.ceil(Math.max(0, ...workloadValues)));
  capacityPoints = samples.map((sample, index) => ({
    sample,
    x: samples.length === 1 ? CAPACITY_PLOT.right : CAPACITY_PLOT.left + index / (samples.length - 1) * span,
    encodeY: capacityY(sample.encodePercent),
    decodeY: capacityY(sample.decodePercent),
    cpuY: capacityY(sample.cpuPercent),
    ramY: capacityY(sample.ramPercent),
    vramY: capacityY(sample.vramPercent),
    streamAverageY: workloadY(sample.streamAverage, workloadMaximum),
    videoTranscodeAverageY: workloadY(sample.videoTranscodeAverage, workloadMaximum),
  }));
  const metricPath = (metric) => trafficPath(capacityPoints.map((point) => ({ x: point.x, y: point[`${metric}Y`] })));
  ["encode", "decode", "cpu", "ram", "vram"].forEach((metric) => chart?.querySelector(`.capacity-chart__line--${metric}`)?.setAttribute("d", metricPath(metric)));
  const encodeLine = metricPath("encode");
  chart?.querySelector(".capacity-chart__area--encode")?.setAttribute("d", capacityPoints.length ? `M${capacityPoints[0].x},${CAPACITY_PLOT.bottom} ${encodeLine.replace(/^M/, "L")} L${capacityPoints.at(-1).x},${CAPACITY_PLOT.bottom} Z` : "");
  workloadChart?.querySelector(".capacity-workload__line--streams")?.setAttribute("d", steppedCapacityPath(capacityPoints, "streamAverageY"));
  workloadChart?.querySelector(".capacity-workload__line--video-transcodes")?.setAttribute("d", steppedCapacityPath(capacityPoints, "videoTranscodeAverageY"));
  const workloadSamples = capacityPoints.filter((point) => Number.isFinite(point.streamAverageY) || Number.isFinite(point.videoTranscodeAverageY));
  setText("#capacity-workload-max", workloadSamples.length ? number(workloadMaximum) : "—");
  document.querySelector("#capacity-workload-empty")?.toggleAttribute("hidden", workloadSamples.length > 0);
  document.querySelector("#capacity-empty")?.toggleAttribute("hidden", samples.length > 0);

  const summary = history?.summary;
  setText("#capacity-encode-p95", summary ? percent(summary.encodeP95Percent) : "—");
  setText("#capacity-decode-p95", summary ? percent(summary.decodeP95Percent) : "—");
  setText("#capacity-cpu-p95", summary ? percent(summary.cpuP95Percent) : "—");
  setText("#capacity-ram-peak", summary ? percent(summary.ramPeakPercent) : "—");
  setText("#capacity-vram-peak", summary ? percent(summary.vramPeakPercent) : "—");
  setText("#capacity-temp-peak", summary ? `${number(temperature(summary.temperaturePeakC))}${temperatureSuffix()}` : "—");
  const constraintLabels = { gpu_encoder: "GPU encoder", cpu: "CPU", host_ram: "host RAM", vram: "VRAM", cooling: "cooling" };
  const pressureLabels = { comfortable: "comfortable", watch: "watch", pressured: "review" };
  setText("#capacity-state", summary ? pressureLabels[summary.pressure] : "waiting");
  setText("#capacity-constraint", summary ? (summary.constraint ? `${constraintLabels[summary.constraint]} leads` : "no sustained limit") : "history not loaded");
  const verdict = document.querySelector("#capacity-verdict");
  verdict?.setAttribute("data-pressure", summary?.pressure ?? "unavailable");

  const from = history ? new Date(history.sampledFrom) : null;
  const to = history ? new Date(history.sampledTo) : null;
  const dateLabel = (date) => date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(presentation.locale, { timeZone: presentation.timezone, month: "short", day: "numeric" }) : "—";
  setText("#capacity-from", dateLabel(from));
  setText("#capacity-to", dateLabel(to));
  const coverageSeconds = from && to ? Math.max(0, (to.getTime() - from.getTime()) / 1_000) : 0;
  const coverageAmount = coverageSeconds >= 86_400
    ? `${number(coverageSeconds / 86_400, coverageSeconds < 864_000 ? 1 : 0)} days`
    : coverageSeconds ? `${number(coverageSeconds / 3_600, 1)} hours` : "waiting for history";
  const coverageLabel = coverageSeconds ? `${coverageAmount} of history` : coverageAmount;
  const intervalMinutes = Number(history?.bucketSeconds ?? 0) / 60;
  const intervalLabel = intervalMinutes === 30
    ? "half-hour"
    : intervalMinutes === 60 ? "hourly" : `${number(intervalMinutes)}-minute`;
  setText("#capacity-analysis", history ? `${number(history.analysisSamples)} ${intervalLabel} samples · ${coverageLabel}` : "Netdata history");
  setText("#capacity-updated", updatedAgeLabel(panel));
  const workloadDescription = workloadSamples.length
    ? ` Workload context is available for ${number(workloadSamples.length)} half-hour samples; use pointer or arrow keys for average and peak concurrent stream counts.`
    : " Workload context is collecting from deployment and does not affect upgrade pressure.";
  chart?.setAttribute("aria-label", summary
    ? `Plex capacity history over ${coverageLabel}. GPU encoder 95th percentile ${number(summary.encodeP95Percent)} percent, GPU decoder 95th percentile ${number(summary.decodeP95Percent)} percent, CPU 95th percentile ${number(summary.cpuP95Percent)} percent, peak host memory ${number(summary.ramPeakPercent)} percent, and peak video memory ${number(summary.vramPeakPercent)} percent.${workloadDescription}`
    : "Plex capacity history unavailable. Live telemetry remains available separately.");
  restoreCapacityFocusAfterRender();
}

function initializeCapacityChart() {
  const chart = document.querySelector("#capacity-chart");
  if (!chart) return;
  [chart, document.querySelector("#capacity-workload-chart")].filter(Boolean).forEach((interactiveChart) => {
    interactiveChart.addEventListener("pointermove", (event) => {
      if (!capacityPoints.length) return;
      const rect = interactiveChart.getBoundingClientRect();
      const viewX = (event.clientX - rect.left) / rect.width * 720;
      const ratio = (viewX - CAPACITY_PLOT.left) / (CAPACITY_PLOT.right - CAPACITY_PLOT.left);
      capacityPointerRatio = Math.max(0, Math.min(1, ratio));
      setCapacityFocus(Math.round(capacityPointerRatio * (capacityPoints.length - 1)));
    });
    const clearPointerFocus = () => {
      capacityPointerRatio = null;
      hideCapacityFocus();
    };
    interactiveChart.addEventListener("pointerleave", clearPointerFocus);
    interactiveChart.addEventListener("pointercancel", clearPointerFocus);
  });
  chart.addEventListener("focus", () => setCapacityFocus(capacityFocusIndex < 0 ? capacityPoints.length - 1 : capacityFocusIndex, true));
  chart.addEventListener("blur", hideCapacityFocus);
  chart.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setCapacityFocus((capacityFocusIndex < 0 ? capacityPoints.length - 1 : capacityFocusIndex) + (event.key === "ArrowLeft" ? -1 : 1), true);
  });
}

function renderHeadline(snapshot) {
  const { bandwidth, power, ups, servicePosture } = snapshot.panels;
  setText("#bandwidth-source", bandwidth.source);
  setText("#power-source", power.source);
  setText("#ups-source", ups.source);
  setText("#posture-source", servicePosture.source);
  setText("#bandwidth-down", bandwidth.data ? number(bandwidth.data.downloadMbps, 1) : "—");
  setText("#bandwidth-up", bandwidth.data ? number(bandwidth.data.uploadMbps, 1) : "—");
  renderTraffic(bandwidth);
  setText("#rack-draw", power.data ? number(power.data.serverWatts / 1000, 2) : "—");
  setText("#rack-today", power.data ? number(power.data.serverTodayKwh, 1) : "—");
  setText("#ups-runtime", ups.data ? number(ups.data.runtimeMinutes) : "—");
  setText("#ups-charge", ups.data ? number(ups.data.chargePercent) : "—");
  const runway = document.querySelector("#ups-runway");
  runway?.querySelector("span")?.style.setProperty("width", `${ups.data?.chargePercent ?? 0}%`);
  runway?.setAttribute("aria-label", ups.data ? `UPS battery charge ${number(ups.data.chargePercent)} percent` : "UPS battery charge unavailable");
  setText("#posture-healthy", servicePosture.data ? number(servicePosture.data.healthy) : "—");
  setText("#posture-down", servicePosture.data ? number(servicePosture.data.down) : "—");
  document.querySelector("#posture-down")?.closest("b")?.classList.toggle("metric-bad", (servicePosture.data?.down ?? 0) > 0);
}

function renderMap(streams) {
  const map = document.querySelector(".stream-map");
  const stage = document.querySelector("#map-stage");
  if (!map || !stage) return;
  const located = streams.filter((stream) => isValidMapLocation(stream.location));
  const configuredHome = isValidMapLocation(presentation.home)
    ? { ...presentation.home, label: presentation.branding.home_label }
    : null;
  const mapLocations = [
    ...located.map((stream) => stream.location),
    ...(configuredHome ? [configuredHome] : []),
  ];
  const mode = selectMapMode(mapLocations);
  const global = mode === "global";
  const viewport = global
    ? { x: 0, y: 0, width: MAP_VIEWBOX.width, height: MAP_VIEWBOX.height, zoom: 1 }
    : calculateActiveMapViewport(located.map((stream) => stream.location), configuredHome);
  const project = global ? projectWorldLocation : projectMapLocation;
  stage.dataset.mapMode = mode;
  map.setAttribute("viewBox", `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`);
  const cssScale = MAP_VIEWBOX.width / Math.max(1, map.getBoundingClientRect().width);
  const overlayScale = Math.max(1, Math.min(2.2, cssScale)) / viewport.zoom;
  const home = configuredHome
    ? { ...configuredHome, ...project(configuredHome.latitude, configuredHome.longitude) }
    : null;
  const pointIsVisible = ({ x, y }) => x >= viewport.x + MAP_HOME_DECORATION_MARGIN * overlayScale
    && x <= viewport.x + viewport.width - MAP_HOME_DECORATION_MARGIN * overlayScale
    && y >= viewport.y + MAP_HOME_DECORATION_MARGIN * overlayScale
    && y <= viewport.y + viewport.height - MAP_HOME_DECORATION_MARGIN * overlayScale;
  const homeVisible = Boolean(home && pointIsVisible(home));
  const homeNode = map.querySelector(".map-node--home");
  const homeLabel = document.querySelector(".map-label--home");
  setText("#map-home-location", presentation.branding.home_label);
  homeNode?.toggleAttribute("hidden", !homeVisible);
  homeLabel?.toggleAttribute("hidden", !homeVisible);
  if (home) homeNode?.setAttribute("transform", `translate(${number(home.x, 1)} ${number(home.y, 1)}) scale(${overlayScale})`);
  const remote = home ? located.filter((stream) => Math.abs(stream.location.latitude - home.latitude) > .3
    || Math.abs(stream.location.longitude - home.longitude) > .3) : [];
  const svg = "http://www.w3.org/2000/svg";
  const routeLayerEnd = map.querySelector(".map-node--home");
  while (map.querySelectorAll(".route").length < remote.length) {
    const route = document.createElementNS(svg, "path");
    route.setAttribute("class", "route");
    map.insertBefore(route, map.querySelector(".route-pulse") ?? routeLayerEnd);
  }
  while (map.querySelectorAll(".route-pulse").length < remote.length) {
    const pulse = document.createElementNS(svg, "path");
    pulse.setAttribute("class", "route-pulse");
    map.insertBefore(pulse, routeLayerEnd);
  }
  while (map.querySelectorAll(".map-node:not(.map-node--home)").length < located.length) {
    const node = document.createElementNS(svg, "g");
    node.setAttribute("class", "map-node");
    node.innerHTML = "<circle r=\"16\" class=\"node-halo\"></circle><circle r=\"10\" class=\"node-ring\"></circle><circle r=\"4\" class=\"node-core\"></circle>";
    map.insertBefore(node, map.querySelector(".map-city-label"));
  }
  const routes = [...map.querySelectorAll(".route")];
  const routePulses = [...map.querySelectorAll(".route-pulse")];
  const nodes = [...map.querySelectorAll(".map-node:not(.map-node--home)")];
  const cityGroups = groupLocatedStreamsByCity(located);
  while (map.querySelectorAll(".map-city-label").length < cityGroups.length) {
    const label = document.createElementNS(svg, "g");
    label.setAttribute("class", "map-city-label");
    label.innerHTML = "<rect rx=\"8\"></rect><text class=\"map-city\"></text>";
    map.appendChild(label);
  }
  const labels = [...map.querySelectorAll(".map-city-label")];
  const labelItems = cityGroups.map((group) => {
    const point = project(group.location.latitude, group.location.longitude);
    const text = group.label;
    const isHomeLocation = Boolean(home
      && Math.abs(group.location.latitude - home.latitude) < .001
      && Math.abs(group.location.longitude - home.longitude) < .001);
    return {
      ...point,
      text,
      width: calculateMapLabelWidth(text),
      preferredSide: point.x < (home?.x ?? MAP_VIEWBOX.width / 2) ? "left" : "right",
      markerRadius: isHomeLocation ? 25 : 16,
    };
  });
  const protectedMarkers = [
    ...(homeVisible && home ? [mapMarkerObstacle(home, 25, overlayScale)] : []),
    ...located.map((stream) => mapMarkerObstacle(
      project(stream.location.latitude, stream.location.longitude),
      16,
      overlayScale,
    )),
  ];
  const labelPositions = layoutMapLabels(labelItems, viewport, overlayScale, protectedMarkers);
  const mapEmpty = document.querySelector("#map-empty");
  const mapScale = document.querySelector(".map-scale");
  const mapLegend = document.querySelector(".map-legend");
  if (mapEmpty) mapEmpty.hidden = located.length > 0;
  if (mapScale) mapScale.hidden = located.length === 0;
  if (mapLegend) mapLegend.hidden = located.length === 0;
  map.setAttribute("aria-label", located.length > 0
    ? `${global ? "World" : "Regional"} active-stream map with ${located.length} coarse viewer ${located.length === 1 ? "location" : "locations"}`
    : "Regional map with no located live streams in the current response");
  stage.setAttribute("aria-label", located.length > 0
    ? `${global ? "World" : "Regional"} map showing ${located.length} coarse active stream ${located.length === 1 ? "location" : "locations"}`
    : "Regional map showing no located active streams");
  routes.forEach((route, index) => {
    const stream = remote[index];
    const pulse = routePulses[index];
    const hidden = !stream || !homeVisible || !home;
    route.toggleAttribute("hidden", hidden);
    pulse?.toggleAttribute("hidden", hidden);
    if (!stream) return;
    const { x, y } = project(stream.location.latitude, stream.location.longitude);
    const control = calculateRouteControlPoint(home, { x, y }, global ? { maxCurve: 64, curveRatio: .14 } : undefined);
    const path = `M${home.x} ${home.y} Q${number(control.x, 1)} ${number(control.y, 1)} ${number(x, 1)} ${number(y, 1)}`;
    const transcode = stream.playbackMode === "transcode";
    route.setAttribute("d", path);
    route.classList.toggle("route--transcode", transcode);
    pulse?.setAttribute("d", path);
    pulse?.classList.toggle("route--transcode", transcode);
    pulse?.style.setProperty("--route-delay", `${-index * .85}s`);
  });
  nodes.forEach((node, index) => {
    const stream = located[index];
    node.toggleAttribute("hidden", !stream);
    if (!stream) return;
    const { x, y } = project(stream.location.latitude, stream.location.longitude);
    node.classList.toggle("map-node--transcode", stream.playbackMode === "transcode");
    node.setAttribute("transform", `translate(${number(x, 1)} ${number(y, 1)}) scale(${overlayScale})`);
  });
  labels.forEach((labelNode, index) => {
    const group = cityGroups[index];
    const position = labelPositions[index];
    labelNode.toggleAttribute("hidden", Boolean(!group || position?.hidden));
    if (!group) return;
    const { text: label, width } = labelItems[index];
    const { x: labelX, y: labelY } = position;
    labelNode.classList.toggle("map-city-label--transcode", group.count === 1 && group.streams[0].playbackMode === "transcode");
    labelNode.setAttribute("transform", `translate(${number(labelX, 1)} ${number(labelY, 1)}) scale(${overlayScale})`);
    const rect = labelNode.querySelector("rect");
    const text = labelNode.querySelector("text");
    rect?.setAttribute("width", String(width));
    rect?.setAttribute("height", "28");
    rect?.setAttribute("y", "-17");
    text?.setAttribute("x", "12");
    text?.setAttribute("y", "1");
    if (text) text.textContent = label;
  });
  if (mapScale && located.length > 0) {
    if (global) {
      const countries = new Set(located.map((stream) => stream.location.countryCode).filter(Boolean));
      mapScale.textContent = `world view · ${countries.size || "—"} ${countries.size === 1 ? "country" : "countries"}`;
      return;
    }
    const radians = (value) => value * Math.PI / 180;
    const milesBetweenLocations = located.flatMap((stream, index) => located.slice(index + 1).map((other) => {
      const latitudeDelta = radians(stream.location.latitude - other.location.latitude);
      const longitudeDelta = radians(stream.location.longitude - other.location.longitude);
      const a = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(radians(stream.location.latitude)) * Math.cos(radians(other.location.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
      return 3_958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }));
    mapScale.textContent = milesBetweenLocations.length ? `${number(Math.max(...milesBetweenLocations))} mi active span` : "local active view";
  }
}

function renderStreams(panel) {
  latestStreamsPanel = panel;
  setPanelState(".panel--streams", panel);
  setText("#stream-count", panel.data ? number(panel.data.total) : "—");
  setText("#transcode-count", panel.data ? number(panel.data.transcodes) : "—");
  setText("#direct-play-count", panel.data ? number(panel.data.streams.filter((stream) => stream.playbackMode === "direct").length) : "—");
  setText("#stream-bitrate", panel.data ? number(panel.data.totalBitrateMbps, 1) : "—");
  const feed = document.querySelector("#stream-feed");
  if (!panel.data) {
    feed.innerHTML = emptyState(panel, "Tracearr has not supplied a stream snapshot.");
    renderMap([]);
    return;
  }
  if (panel.data.streams.length === 0) {
    feed.innerHTML = '<div class="panel-state"><strong>No active streams</strong><span>Tracearr is healthy and Plex is idle.</span></div>';
    renderMap([]);
    return;
  }
  feed.innerHTML = panel.data.streams.map((stream) => {
    const displayUsername = displayedPlexUsername(stream.user, privacyMode, privacyAliasRegistry);
    return `
    <article class="stream-item ${stream.playbackMode === "transcode" ? "stream-item--transcode" : ""}">
      <div class="stream-top"><span class="stream-user">${escapeHtml(displayUsername)}</span><span class="stream-meta"><span class="stream-location">${escapeHtml(stream.location.label)}</span>${stream.platform ? `<span class="stream-platform">${escapeHtml(stream.platform)}</span>` : ""}</span></div>
      <p class="stream-title">${escapeHtml(stream.title)}</p>
      <div class="stream-episode">${escapeHtml(stream.context)}</div>
      <div class="stream-progress" aria-label="${number(stream.progressPercent)} percent watched"><span style="width:${stream.progressPercent}%"></span></div>
      <div class="stream-tech"><span>${escapeHtml(stream.playbackLabel)}</span><span>${number(stream.bitrateMbps, 1)} Mbps</span></div>
    </article>`;
  }).join("");
  renderMap(panel.data.streams);
}

function renderPlexHost(panel, proxmoxPanel) {
  setPanelState(".panel--plex-host", panel);
  const data = panel.data;
  const cpuNode = proxmoxPanel?.data?.nodes?.find(
    (node) => node.name === presentation.associations.plex_host_proxmox_node,
  );
  setText("#plex-host-health", panel.status);
  setText("#plex-host-eyebrow", `PLEX HOST · ${data?.host ?? "LINUX TARGET"}`.toUpperCase());
  setText("#gpu-percent", data ? number(data.gpuPercent) : "—");
  document.querySelector(".gpu-dial")?.style.setProperty("--value", data?.gpuPercent ?? 0);
  setText("#gpu-name", data?.gpuName ?? "GPU MODEL UNAVAILABLE");
  setText("#gpu-tensor-cores", data?.gpuTensorCores ? `${number(data.gpuTensorCores)} TENSOR CORES` : "TENSOR CORES —");
  setText("#cpu-percent", data ? number(data.cpuPercent) : "—");
  document.querySelector(".cpu-dial")?.style.setProperty("--value", data?.cpuPercent ?? 0);
  setText("#cpu-name", cpuNode?.cpuModel ?? "CPU MODEL UNAVAILABLE");
  setText("#cpu-cores", data ? `${number(data.cpuCores)} VCPU` : "— VCPU");
  const metrics = [
    { id: "gpu-encode", value: data?.encodePercent, suffix: "%" },
    { id: "gpu-decode", value: data?.decodePercent, suffix: "%" },
    { id: "gpu-temp", value: data ? temperature(data.temperatureC) : undefined, fill: data?.temperatureC, suffix: temperatureSuffix() },
    { id: "gpu-draw", value: data?.powerWatts, suffix: " W" },
  ];
  metrics.forEach(({ id, value, fill = value, suffix }) => { setText(`#${id}`, data ? `${number(value)}${suffix}` : "—"); setFill(`#${id}-bar`, fill); });
  const vramPercent = data ? data.vramUsedBytes / data.vramTotalBytes * 100 : 0;
  setText("#gpu-vram", data ? `${number(data.vramUsedBytes / 1_000_000_000, 1)} / ${number(data.vramTotalBytes / 1_000_000_000, 1)} GB` : "—");
  setFill("#gpu-vram-bar", vramPercent);
  const ramPercent = data ? data.ramUsedBytes / data.ramTotalBytes * 100 : 0;
  setText("#host-ram", data ? `${number(data.ramUsedBytes / 1_000_000_000, 1)} / ${number(data.ramTotalBytes / 1_000_000_000, 1)} GB` : "—");
  setFill("#host-ram-bar", ramPercent);
  renderPlexCapacity(panel);
}

function episodeDateBy(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function episodeDateTitle(date) {
  if (!currentEpisodeDate || date === currentEpisodeDate) return "Today’s episodes";
  if (date === episodeDateBy(currentEpisodeDate, -1)) return "Yesterday’s episodes";
  if (date === episodeDateBy(currentEpisodeDate, 1)) return "Tomorrow’s episodes";
  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString(presentation.locale, { weekday: "long" });
  return `${weekday}’s episodes`;
}

function updateEpisodeNavigationLabels(date) {
  const format = (value) => new Date(`${value}T12:00:00`).toLocaleDateString(presentation.locale, { weekday: "long", month: "long", day: "numeric" });
  const previous = document.querySelector("#episodes-previous-day");
  const next = document.querySelector("#episodes-next-day");
  previous?.setAttribute("aria-label", `Show episodes for ${format(episodeDateBy(date, -1))}`);
  next?.setAttribute("aria-label", `Show episodes for ${format(episodeDateBy(date, 1))}`);
}

function renderEpisodes(panel, date = panel.data?.localDate ?? selectedEpisodeDate ?? currentEpisodeDate) {
  setPanelState(".panel--calendar", panel);
  const list = document.querySelector("#episode-list");
  if (!panel.data || panel.data.episodes.length === 0) {
    list.innerHTML = panel.data ? '<div class="panel-state"><strong>No episodes this day</strong><span>Both Sonarr calendars are healthy and empty.</span></div>' : emptyState(panel, "Sonarr calendars are unavailable.");
  } else {
    list.innerHTML = panel.data.episodes.map((episode) => `<article class="episode-item"><time class="episode-time">${escapeHtml(clockTime(episode.airAt))}</time><div class="episode-name"><strong>${escapeHtml(episode.show)}</strong><span>${escapeHtml(episode.context)} · ${escapeHtml(episode.library)}</span></div><div class="episode-meta"><span class="episode-quality">${escapeHtml(episode.quality)}</span><i class="episode-status episode-status--${escapeHtml(episode.state)}" title="${escapeHtml(episode.state)}"></i></div></article>`).join("");
  }
  const displayedDate = date ?? new Date().toISOString().slice(0, 10);
  const dateValue = new Date(`${displayedDate}T12:00:00`);
  setText("#calendar-title", episodeDateTitle(displayedDate));
  setText("#calendar-day", String(dateValue.getDate()).padStart(2, "0"));
  setText("#calendar-label", dateValue.toLocaleDateString(presentation.locale, { month: "short", weekday: "short" }).replace(" ", " · ").toUpperCase());
  setText("#episode-count", `${panel.data?.episodes.length ?? 0} episodes`);
  updateEpisodeNavigationLabels(displayedDate);
}

async function navigateEpisodes(days) {
  if (!selectedEpisodeDate) return;
  const targetDate = episodeDateBy(selectedEpisodeDate, days);
  const panel = document.querySelector(".panel--calendar");
  const buttons = document.querySelectorAll(".calendar-navigation__button");
  selectedEpisodeDate = targetDate;
  panel?.setAttribute("data-navigation-state", "loading");
  panel?.setAttribute("aria-busy", "true");
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const response = await fetch(`/api/v1/episodes?date=${encodeURIComponent(targetDate)}`, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`Episode calendar request failed with HTTP ${response.status}`);
    renderEpisodes({ status: "ok", source: currentEpisodesPanel?.source ?? "Sonarr", message: null, data: await response.json() }, targetDate);
  } catch (error) {
    renderEpisodes({ status: "error", source: currentEpisodesPanel?.source ?? "Sonarr", message: error instanceof Error ? error.message : "Episode calendar request failed", data: null }, targetDate);
  } finally {
    panel?.removeAttribute("data-navigation-state");
    panel?.removeAttribute("aria-busy");
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function renderQueues(panel) {
  setPanelState(".panel--queues", panel);
  const list = document.querySelector("#queue-list");
  if (!panel.data) {
    list.innerHTML = emptyState(panel, "Download queues are unavailable.");
    return;
  }
  list.innerHTML = panel.data.instances.map((queue, index, queues) => `${index === 0 || queue.client !== queues[index - 1].client ? `<div class="queue-client">${queue.client === "sabnzbd" ? "Usenet · SABnzbd" : "Torrents · qBittorrent"}</div>` : ""}<section class="queue-instance"><div class="queue-instance__top"><strong>${escapeHtml(queue.name)}</strong><span>${queue.paused ? "paused" : `${number(queue.speedBytesPerSecond / 1_000_000, 1)} MB/s · ${duration(queue.timeLeftSeconds)} left`}</span></div>${queue.items.length ? queue.items.map((file) => `<div class="queue-file"><div class="queue-file__meta"><span>${escapeHtml(file.name)}</span><span>${gigabytes(file.remainingBytes)}</span></div><div class="queue-bar"><span style="--progress:${file.progressPercent}%;width:${file.progressPercent}%"></span></div></div>`).join("") : '<div class="queue-empty">idle · queue empty</div>'}</section>`).join("");
  const items = panel.data.instances.flatMap((queue) => queue.items);
  const totalRate = panel.data.instances.reduce((sum, queue) => sum + queue.speedBytesPerSecond, 0);
  setText("#queue-rate", number(totalRate / 1_000_000, 1));
  setText("#queue-items", number(items.length));
  setText("#queue-remaining", gigabytes(items.reduce((sum, item) => sum + item.remainingBytes, 0)));
  setText("#queue-time", duration(Math.max(...panel.data.instances.map((queue) => queue.timeLeftSeconds), 0)));
}

function renderMovies(panel) {
  setPanelState(".panel--movies", panel);
  const shelf = document.querySelector("#movie-shelf");
  if (!panel.data || panel.data.movies.length === 0) {
    shelf.innerHTML = panel.data ? '<div class="panel-state"><strong>No recent additions</strong><span>No movies were recently added.</span></div>' : emptyState(panel, "Radarr libraries are unavailable.");
    return;
  }
  const backgrounds = ["linear-gradient(155deg,#695f68,#172128 58%,#0a1014)", "linear-gradient(155deg,#6a332d,#251a1c 56%,#0a1014)", "linear-gradient(155deg,#304d55,#17242a 59%,#0a1014)", "linear-gradient(155deg,#34464c,#24272b 56%,#0a1014)"];
  shelf.innerHTML = panel.data.movies.map((movie, index) => `<article class="movie-card" data-monogram="${escapeHtml(movie.title.charAt(0))}" style="--movie-bg:${backgrounds[index % backgrounds.length]}">${movie.posterUrl ? `<img class="movie-poster" src="${escapeHtml(movie.posterUrl)}" alt="" loading="lazy" decoding="async">` : ""}<span class="movie-format">${escapeHtml(movie.format)}</span><div class="movie-info">${movie.year ? `<span>${escapeHtml(movie.year)}</span>` : ""}<strong>${escapeHtml(movie.title)}</strong></div></article>`).join("");
  shelf.querySelectorAll(".movie-poster").forEach((poster) => poster.addEventListener("error", () => { poster.hidden = true; }, { once: true }));
}

function hostStat(label, text, value) {
  return `<div class="host-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(text)}</strong><div class="host-bar"><i style="--fill:${value}%;width:${value}%"></i></div></div>`;
}

function renderProxmox(panel) {
  setPanelState(".panel--cluster", panel);
  const table = document.querySelector("#cluster-table");
  if (!panel.data) { table.innerHTML = emptyState(panel, "Proxmox audit data is unavailable."); return; }
  table.innerHTML = panel.data.nodes.map((host) => {
    const memory = host.memoryTotalBytes ? host.memoryUsedBytes / host.memoryTotalBytes * 100 : 0;
    const storage = host.storageTotalBytes ? host.storageUsedBytes / host.storageTotalBytes * 100 : 0;
    return `<div class="cluster-row" role="row"><div class="host-name" role="cell"><i class="host-status host-status--${escapeHtml(host.status)}"></i><div><strong>${escapeHtml(host.name)}</strong><span>${escapeHtml(host.role)}</span></div></div>${hostStat("CPU", percent(host.cpuPercent), host.cpuPercent)}${hostStat("Memory", memoryPair(host.memoryUsedBytes, host.memoryTotalBytes), memory)}${hostStat("Storage", capacityPair(host.storageUsedBytes, host.storageTotalBytes), storage)}<div class="host-guests" role="cell"><strong>${host.guests}</strong> guests</div></div>`;
  }).join("");
  setText("#cluster-nodes", `${panel.data.nodes.length} nodes`);
  setText("#cluster-memory", memoryGigabytes(panel.data.totalMemoryBytes));
}

function renderTrueNasStorage(panel) {
  setPanelState(".panel--truenas", panel);
  const data = panel.data;
  if (!data) {
    setText("#truenas-title", "Storage");
    setText("#truenas-health", panel.status);
    setText("#truenas-used", "—");
    setText("#truenas-free", "—");
    setText("#truenas-total", "—");
    setText("#truenas-percent", "—");
    setText("#truenas-pools", "—");
    const rail = document.querySelector("#truenas-rail");
    rail?.style.setProperty("--fill", "0%");
    rail?.setAttribute("aria-valuenow", "0");
    rail?.setAttribute("aria-label", panel.message ?? "TrueNAS storage data is unavailable");
    return;
  }
  const usedPercent = data.totalBytes ? data.usedBytes / data.totalBytes * 100 : 0;
  setText("#truenas-title", data.serverName);
  setText("#truenas-health", data.health);
  setText("#truenas-used", tebibytes(data.usedBytes));
  setText("#truenas-free", tebibytes(data.availableBytes));
  setText("#truenas-total", tebibytes(data.totalBytes));
  setText("#truenas-percent", percent(usedPercent));
  setText("#truenas-pools", `${number(data.poolsOnline)} / ${number(data.poolsTotal)}`);
  const rail = document.querySelector("#truenas-rail");
  rail?.style.setProperty("--fill", `${Math.min(100, Math.max(0, usedPercent))}%`);
  rail?.setAttribute("aria-valuenow", number(usedPercent));
  rail?.setAttribute("aria-label", `${number(usedPercent)} percent of TrueNAS capacity used`);
}

function renderArcane(panel) {
  setPanelState(".panel--arcane", panel);
  const fleet = document.querySelector("#fleet-grid");
  if (!panel.data) { fleet.innerHTML = emptyState(panel, "Arcane environment data is unavailable."); return; }
  fleet.innerHTML = panel.data.environments.flatMap((environment) => environment.containers).map((container) => `<div class="fleet-cell ${container.state !== "running" ? "fleet-cell--warn" : ""}"><strong>${escapeHtml(container.name)}</strong><span>${escapeHtml(container.state)}</span></div>`).join("") || '<div class="panel-state"><strong>No container records</strong><span>Arcane returned no connected environment containers.</span></div>';
  setText("#fleet-running", number(panel.data.running));
  setText("#fleet-total", `/ ${number(panel.data.total)} running`);
  const unavailable = panel.data.environments.find((environment) => !environment.connected);
  const alert = document.querySelector("#fleet-alert");
  alert.hidden = !unavailable;
  if (unavailable) alert.querySelector("strong").textContent = unavailable.name;
}

function renderEnergy(panel) {
  setPanelState(".panel--energy", panel);
  const data = panel.data;
  setText("#energy-health", panel.status);
  const fields = {
    "energy-server-watts": data ? `${number(data.serverWatts)}W` : "—",
    "energy-ac-watts": data ? `${number(data.acWatts)}W` : "—",
    "energy-total-watts": data ? `${number(data.totalWatts)}W` : "—",
    "energy-house-watts": data ? `${number(data.houseWatts)}W` : "—",
    "energy-server-today": data ? number(data.serverTodayKwh, 1) : "—",
    "energy-ac-today": data ? number(data.acTodayKwh, 1) : "—",
    "energy-total-today": data ? number(data.todayKwh, 1) : "—",
    "energy-house-today": data ? number(data.houseTodayKwh, 1) : "—",
    "energy-month-kwh": data ? `${number(data.monthKwh, 1)} kWh` : "—",
    "energy-month-cost": data ? money(data.monthCost) : "—",
    "energy-server-month": data ? number(data.serverMonthKwh, 1) : "—",
    "energy-ac-month": data ? number(data.acMonthKwh, 1) : "—",
    "energy-house-month": data ? number(data.houseMonthKwh, 1) : "—",
    "energy-projected-cost": data ? money(data.projectedCost) : "—",
    "energy-projected-kwh": data ? number(data.projectedKwh) : "—",
    "energy-house-projected-cost": data ? money(data.projectedHouseCost) : "—",
    "energy-house-projected-kwh": data ? number(data.projectedHouseKwh) : "—",
    "energy-share-label": data ? percent(data.serverPercentOfHouse) : "—",
  };
  Object.entries(fields).forEach(([id, value]) => setText(`#${id}`, value));
  const rate = data ? Number(data.rate).toLocaleString(presentation.locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : "";
  setText("#energy-rate", data ? `($${rate}/kWh ${data.rateLabel})` : "");
  document.querySelectorAll(".energy-days").forEach((element) => { element.textContent = data ? number(data.daysInMonth) : "—"; });
  const share = document.querySelector("#energy-share");
  const sharePercent = data?.serverPercentOfHouse ?? 0;
  share?.style.setProperty("--fill", `${sharePercent}%`);
  share?.setAttribute("aria-valuenow", number(sharePercent));
  share?.setAttribute("aria-label", data ? `Homelab uses ${number(sharePercent)} percent of household energy month to date` : "Homelab household energy share unavailable");
}

function renderRackPower(panel, energyPanel) {
  setPanelState(".panel--rack-power", panel);
  const data = panel.data;
  const rate = energyPanel.data?.rate;
  const estimatedKwh = data ? data.rolling24hAverageWatts / 1_000 * 24 * 30 : null;
  const estimatedCost = estimatedKwh !== null && rate !== undefined ? estimatedKwh * rate : null;
  const capacityPercent = data ? Math.min(100, data.currentWatts / data.capacityWatts * 100) : 0;
  const currentKilowatts = data ? data.currentWatts / 1_000 : null;

  setText("#rack-power-health", panel.status);
  setText("#rack-power-eyebrow", data ? `UNIFI PDU · ${number(data.meteredOutlets)} METERED OUTLETS` : "UNIFI PDU");
  setText("#rack-power-current", currentKilowatts === null ? "—" : number(currentKilowatts, 3));
  setText("#rack-power-kwh", estimatedKwh === null ? "—" : `${number(estimatedKwh, 1)} kWh`);
  setText("#rack-power-cost", estimatedCost === null ? "—" : money(estimatedCost));
  setText("#rack-power-budget-label", data ? `${number(capacityPercent)}% of ${number(data.capacityWatts / 1_000, 3)} kW` : "—");
  setText("#rack-power-rate", rate === undefined ? "Rate unavailable" : `${moneyRate(rate)}/kWh · ${energyPanel.data.rateLabel}`);
  const sampledMinutes = data?.rolling24hSampleMinutes ?? 0;
  const sampleCoverage = sampledMinutes >= 1_440
    ? "Estimate uses rolling 24h average"
    : `24h average warming up · ${sampledMinutes < 1 ? "<1m" : sampledMinutes < 60 ? `${number(sampledMinutes)}m` : `${number(sampledMinutes / 60, 1)}h`} sampled`;
  setText("#rack-power-method", data ? sampleCoverage : "Rolling average unavailable");
  const budget = document.querySelector("#rack-power-budget");
  budget?.style.setProperty("--fill", `${capacityPercent}%`);
  budget?.setAttribute("aria-valuenow", number(capacityPercent));
  budget?.setAttribute("aria-label", data ? `Rack PDU is using ${number(capacityPercent)} percent of rated capacity` : "Rack PDU capacity unavailable");

  const list = document.querySelector("#rack-load-list");
  if (!data) {
    list.innerHTML = emptyState(panel, "UniFi has not supplied a rack PDU snapshot.");
    return;
  }
  const visible = data.outlets.slice(0, 5);
  const remainder = data.outlets.slice(5);
  const remainderWatts = remainder.reduce((sum, outlet) => sum + outlet.watts, 0);
  const rows = remainder.length ? [...visible, { index: 0, name: `Remaining ${remainder.length} outlets`, watts: remainderWatts }] : visible;
  const largestWatts = Math.max(...visible.map((outlet) => outlet.watts), 1);
  list.innerHTML = `<div class="rack-load-head"><span>Outlet load</span><span>Share</span><span>Est</span><span>Now</span></div>${rows.map((outlet) => {
    const share = data.currentWatts > 0 ? outlet.watts / data.currentWatts * 100 : 0;
    const outletEstimatedCost = estimatedCost === null || data.currentWatts <= 0 ? null : estimatedCost * share / 100;
    const bar = Math.min(100, outlet.watts / largestWatts * 100);
    return `<div class="rack-load-row"><div class="rack-load-device"><b>${escapeHtml(outlet.name)}</b><div class="rack-load-bar"><i style="--fill:${bar}%"></i></div></div><span>${escapeHtml(number(share, 1))}%</span><span class="rack-load-est">${outletEstimatedCost === null ? "—" : escapeHtml(money(outletEstimatedCost))}</span><strong>${escapeHtml(number(outlet.watts, 1))} W</strong></div>`;
  }).join("")}`;
}

function renderPbsVault(pbs, mode) {
  const vault = document.querySelector("#pbs-vault");
  if (!vault) return;
  vault.toggleAttribute("hidden", !pbs);
  if (!pbs) return;

  vault.dataset.state = pbs.status;
  setText("#pbs-server-name", pbs.serverName);
  setText("#pbs-source-label", mode === "fixture" ? "PBS · SAMPLE DATA" : "PBS · READ ONLY");

  const totalBytes = pbs.datastores.reduce((sum, datastore) => sum + datastore.totalBytes, 0);
  const usedBytes = pbs.datastores.reduce((sum, datastore) => sum + datastore.usedBytes, 0);
  const availableBytes = pbs.datastores.reduce((sum, datastore) => sum + datastore.availableBytes, 0);
  const freePercent = totalBytes > 0 ? Math.min(100, availableBytes / totalBytes * 100) : 0;
  setText("#pbs-capacity-total", `${tebibytes(usedBytes)} / ${tebibytes(totalBytes)}`);
  setText("#pbs-capacity-free", `${number(freePercent)}% free across ${pbs.datastores.length} datastore${pbs.datastores.length === 1 ? "" : "s"}`);

  const stores = document.querySelector("#pbs-datastores");
  if (stores) {
    stores.innerHTML = pbs.datastores.map((datastore) => {
      const usedPercent = Math.min(100, datastore.usedBytes / datastore.totalBytes * 100);
      return `<div class="pbs-datastore" data-state="${escapeHtml(datastore.status)}"><div class="pbs-datastore__label"><strong>${escapeHtml(datastore.name)}</strong><span><b>${escapeHtml(tebibytes(datastore.availableBytes))} free</b> · ${escapeHtml(number(usedPercent))}% used</span></div><div class="pbs-datastore__rail" role="meter" aria-label="${escapeHtml(datastore.name)} datastore usage, ${escapeHtml(tebibytes(datastore.availableBytes))} free" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeHtml(number(usedPercent))}"><i style="--fill:${escapeHtml(number(usedPercent, 1))}%"></i></div></div>`;
    }).join("");
  }

  const restorePointsKnown = pbs.datastores.every((datastore) => datastore.restorePoints !== null);
  const restorePoints = restorePointsKnown ? pbs.datastores.reduce((sum, datastore) => sum + datastore.restorePoints, 0) : null;
  setText("#pbs-restore-points", restorePoints === null ? "—" : number(restorePoints));
  setText("#pbs-protected-guests", pbs.protectedGuests === null ? "guest coverage unavailable" : `${number(pbs.protectedGuests)} protected guests`);

  const verificationKnown = pbs.verificationTotal !== null && pbs.verifiedSnapshots !== null;
  const pendingVerification = verificationKnown ? Math.max(0, pbs.verificationTotal - pbs.verifiedSnapshots) : null;
  setText("#pbs-verification", verificationKnown && pbs.verificationTotal > 0 ? `${number(pbs.verifiedSnapshots)} / ${number(pbs.verificationTotal)}` : "—");
  setText("#pbs-verification-detail", `${pendingVerification === null ? "coverage unavailable" : pendingVerification ? `${number(pendingVerification)} pending` : "all current"} · ${shortTimestamp(pbs.lastVerificationAt)}`);
  document.querySelector("#pbs-verification")?.closest("section")?.setAttribute("data-state", pbs.verificationResult);

  const garbageCollectionLabel = {
    success: "GC OK",
    warning: "GC review",
    failure: "GC failed",
    running: "GC running",
    unavailable: "GC unknown",
  }[pbs.garbageCollectionResult] ?? "GC unknown";
  setText("#pbs-garbage-collection", garbageCollectionLabel);
  setText("#pbs-garbage-collection-detail", `${shortTimestamp(pbs.lastGarbageCollectionAt)}${pbs.reclaimedBytes === null ? "" : ` · ${dataSize(pbs.reclaimedBytes)} reclaimed`}`);
  document.querySelector("#pbs-garbage-collection")?.closest("section")?.setAttribute("data-state", pbs.garbageCollectionResult);
}

function renderBackups(panel, mode) {
  setPanelState(".panel--backups", panel);
  const list = document.querySelector("#backup-list");
  const ledgerHeading = document.querySelector(".backup-ledger-heading");
  const health = document.querySelector("#backup-health");
  renderPbsVault(panel.data?.pbs, mode);
  ledgerHeading?.toggleAttribute("hidden", !panel.data);
  if (!panel.data) {
    list.innerHTML = emptyState(panel, "Backup task sources are unavailable.");
    if (health) {
      health.textContent = panel.status;
      health.removeAttribute("data-tone");
    }
    return;
  }
  list.innerHTML = panel.data.jobs.map((job) => `<article class="backup-row backup-row--${escapeHtml(job.result)}"><div class="backup-name"><span class="backup-check">${job.result === "success" ? "✓" : job.result === "not_configured" ? "—" : "!"}</span><div><strong>${escapeHtml(job.name)}</strong><span>${escapeHtml(job.detail)} · ${escapeHtml(job.message ?? job.result.replace("_", " "))}</span></div></div><div class="backup-stat"><span>Last run</span><strong>${job.lastRunAt ? escapeHtml(clockTime(job.lastRunAt)) : "Not configured"}</strong></div><div class="backup-stat"><span>Duration</span><strong>${job.durationSeconds === null ? "—" : backupDuration(job.durationSeconds)}</strong></div><div class="backup-stat"><span>Incremental size</span><strong>${job.transferredBytes === null ? "—" : dataSize(job.transferredBytes)}</strong></div></article>`).join("");
  const results = panel.data.jobs.map((job) => job.result);
  const [label, tone] = results.includes("failure")
    ? ["attention", "danger"]
    : results.some((result) => ["warning", "unavailable"].includes(result))
      ? ["review", "warning"]
      : results.includes("running")
        ? ["running", "info"]
        : results.includes("not_configured")
          ? ["planned gap", "muted"]
          : ["protected", "success"];
  if (health) {
    health.textContent = label;
    health.dataset.tone = tone;
  }
}

function renderWatchlist(panel) {
  setPanelState(".panel--watch", panel);
  const items = panel.data?.items ?? [];
  setText("#watch-count", number(items.length));
  document.querySelector("#watch-list").innerHTML = items.length ? items.map((item) => `<li><span class="watch-severity ${item.severity !== "info" ? "watch-severity--warn" : ""}"></span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div><time>${escapeHtml(item.ageLabel)}</time></li>`).join("") : '<li class="watch-clear"><div><strong>No active watch items</strong><p>Normalized source facts are within their current thresholds.</p></div><time>live</time></li>';
}

function renderSnapshot(snapshot) {
  syntheticClock = snapshot.mode === "fixture" ? new Date(snapshot.generatedAt) : null;
  updateClock();
  document.querySelector("#runtime-banner")?.toggleAttribute("hidden", snapshot.mode !== "fixture");
  renderHeadline(snapshot);
  renderStreams(snapshot.panels.streams);
  renderPlexHost(snapshot.panels.plexHost, snapshot.panels.proxmox);
  currentEpisodesPanel = snapshot.panels.episodes;
  currentEpisodeDate = currentEpisodesPanel.data?.localDate ?? currentEpisodeDate;
  selectedEpisodeDate ??= currentEpisodeDate;
  if (!selectedEpisodeDate || selectedEpisodeDate === currentEpisodeDate) renderEpisodes(currentEpisodesPanel, selectedEpisodeDate ?? undefined);
  renderQueues(snapshot.panels.sabQueues);
  renderMovies(snapshot.panels.movies);
  renderProxmox(snapshot.panels.proxmox);
  renderTrueNasStorage(snapshot.panels.truenasStorage);
  renderArcane(snapshot.panels.arcane);
  renderEnergy(snapshot.panels.power);
  renderRackPower(snapshot.panels.rackPower, snapshot.panels.power);
  renderBackups(snapshot.panels.backups, snapshot.mode);
  renderWatchlist(snapshot.panels.watchlist);
  const degraded = Object.values(snapshot.panels).filter((panel) => panel.status !== "ok").length;
  setText("#runtime-mode", snapshot.mode === "fixture" ? `SYNTHETIC DEMO · ${String(snapshot.demoState ?? "healthy").toUpperCase()}` : "LIVE · READ ONLY");
  setText("#runtime-summary", degraded ? `${degraded} panel${degraded === 1 ? "" : "s"} degraded independently.` : "All normalized panels are current.");
  setText("#runtime-freshness", `snapshot ${new Date(snapshot.generatedAt).toLocaleTimeString(presentation.locale, { timeZone: presentation.timezone })}`);
}

function updateClock() {
  const now = syntheticClock ?? new Date();
  setText("#clock-time", now.toLocaleTimeString(presentation.locale, { timeZone: presentation.timezone, hour: "numeric", minute: "2-digit", second: "2-digit" }));
  setText("#clock-date", now.toLocaleDateString(presentation.locale, { timeZone: presentation.timezone, weekday: "short", month: "short", day: "2-digit" }));
}

function setView(view) {
  document.querySelector(".dashboard-grid")?.setAttribute("data-view", view);
  document.querySelectorAll(".view-button").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll(".view-panel").forEach((panel) => {
    const visible = view === "overview" || panel.dataset.category === view;
    panel.classList.toggle("is-hidden", !visible);
    panel.classList.remove("is-revealing");
    if (visible) requestAnimationFrame(() => panel.classList.add("is-revealing"));
  });
}

function setPrivacyMode(nextMode, announce = true) {
  privacyMode = nextMode === "private" ? "private" : "public";
  document.body.dataset.privacyMode = privacyMode;
  const privateMode = privacyMode === "private";
  const status = document.querySelector("#privacy-mode-status");
  if (status) {
    status.dataset.mode = privacyMode;
    status.setAttribute("aria-label", privateMode
      ? "Private mode. Real Plex usernames are visible."
      : "Public mode. Plex usernames are shown as privacy aliases.");
    status.title = privateMode
      ? "Real Plex usernames are visible. Press Shift+P or Escape to veil them."
      : "Plex usernames are replaced with randomized privacy aliases.";
  }
  setText("#privacy-mode-label", privateMode ? "Private mode" : "Public mode");
  setText("#privacy-mode-detail", privateMode ? "Names visible · ⇧P to veil" : "Identities veiled");
  if (announce) {
    setText("#privacy-mode-announcement", privateMode
      ? "Private mode enabled. Real Plex usernames are visible."
      : "Public mode enabled. Plex usernames are shown as privacy aliases.");
  }
  if (latestStreamsPanel) renderStreams(latestStreamsPanel);
}

function initializePrivacyMode() {
  setPrivacyMode(presentation.privacy.default_mode, false);
  const status = document.querySelector("#privacy-mode-status");
  if (!presentation.privacy.allow_private_toggle) status?.removeAttribute("aria-keyshortcuts");
  document.addEventListener("keydown", (event) => {
    const action = privacyModeKeyAction(event);
    if (action === "toggle" && !presentation.privacy.allow_private_toggle) return;
    if (!action || (action === "public" && privacyMode === "public")) return;
    if (action === "toggle") event.preventDefault();
    setPrivacyMode(action === "public" || privacyMode === "private" ? "public" : "private");
  });
}

async function loadPresentationConfiguration() {
  const response = await fetch("/api/v1/configuration", { headers: { accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Configuration request failed with HTTP ${response.status}`);
  presentation = await response.json();
  document.documentElement.lang = presentation.locale;
  document.title = presentation.branding.title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", presentation.branding.subtitle);
  document.querySelector(".brand-lockup")?.setAttribute("aria-label", presentation.branding.title);
  setText("#brand-name", presentation.branding.title);
  setText("#brand-subtitle", presentation.branding.subtitle);
  setText("#footer-home-label", presentation.branding.home_label);
  setText("#map-home-location", presentation.branding.home_label);
}

function initializeInteractions() {
  initializePrivacyMode();
  initializeTrafficChart();
  initializeCapacityChart();
  document.querySelectorAll(".view-button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  document.querySelector("#episodes-previous-day")?.addEventListener("click", () => void navigateEpisodes(-1));
  document.querySelector("#episodes-next-day")?.addEventListener("click", () => void navigateEpisodes(1));
  const sourceDialog = document.querySelector("#source-dialog");
  document.querySelector("#open-sources").addEventListener("click", () => sourceDialog.showModal());
  sourceDialog.addEventListener("click", (event) => { if (event.target === sourceDialog) sourceDialog.close(); });
}

let refreshInFlight = false;
async function refreshDashboard() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const dashboardUrl = requestedDemoState ? `/api/v1/dashboard?demo=${encodeURIComponent(requestedDemoState)}` : "/api/v1/dashboard";
    const response = await fetch(dashboardUrl, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`Snapshot request failed with HTTP ${response.status}`);
    renderSnapshot(await response.json());
  } catch (error) {
    document.querySelector("#runtime-banner")?.setAttribute("hidden", "");
    setText("#runtime-mode", "DASHBOARD ERROR");
    setText("#runtime-summary", error instanceof Error ? error.message : "Snapshot request failed");
    setText("#runtime-freshness", "retrying");
  } finally {
    refreshInFlight = false;
  }
}

async function start() {
  try {
    await loadPresentationConfiguration();
  } catch (error) {
    setText("#runtime-mode", "CONFIGURATION ERROR");
    setText("#runtime-summary", error instanceof Error ? error.message : "Configuration request failed");
  }
  initializeInteractions();
  updateClock();
  setView("overview");
  await refreshDashboard();
  setInterval(updateClock, 1_000);
  setInterval(refreshDashboard, 5_000);
}

void start();
