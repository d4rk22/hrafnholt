export const MAP_VIEWBOX = Object.freeze({ width: 760, height: 420 });
export const MAP_PROJECTION = Object.freeze({
  minLongitude: -125,
  maxLongitude: -66,
  minLatitude: 24,
  maxLatitude: 50,
  left: 58,
  right: 674,
  top: 70,
  bottom: 410,
});
export const WORLD_PROJECTION = Object.freeze({
  minLongitude: -180,
  maxLongitude: 180,
  minLatitude: -60,
  maxLatitude: 85,
  left: 24,
  right: 736,
  top: 32,
  bottom: 388,
});

// These dimensions cap the local zoom at a readable regional view.
export const MAXIMUM_MAP_ZOOM = 3.2;
export const MINIMUM_VIEWPORT_WIDTH = MAP_VIEWBOX.width / MAXIMUM_MAP_ZOOM;
export const MINIMUM_VIEWPORT_HEIGHT = MAP_VIEWBOX.height / MAXIMUM_MAP_ZOOM;
export const VIEWPORT_PADDING = 38;
export const MAP_LABEL_HEIGHT = 28;
export const MAP_LABEL_EDGE_PADDING = 12;
export const MAP_LABEL_VISIBLE_GAP = 7;
export const MAP_LABEL_GAP = 16 + MAP_LABEL_VISIBLE_GAP;
export const MAP_MARKER_LABEL_CLEARANCE = 2.5;
export const MAP_LABEL_MIN_WIDTH = 50;
export const MAP_LABEL_MAX_WIDTH = 150;

export function calculateMapLabelWidth(text) {
  return Math.min(MAP_LABEL_MAX_WIDTH, Math.max(MAP_LABEL_MIN_WIDTH, String(text ?? "").length * 6.4 + 24));
}

function boxesOverlap(a, b, padding = 0) {
  return a.left < b.right + padding
    && a.right > b.left - padding
    && a.top < b.bottom + padding
    && a.bottom > b.top - padding;
}

// Places fixed-size SVG labels around their markers without allowing nearby
// locations (or the home-core tag) to collapse into the same visual stack.
// Callers can bias the first choice left/right so labels radiate away from the
// home core instead of accumulating on one side of the map.
export function layoutMapLabels(items, viewport, overlayScale, obstacles = []) {
  const edge = MAP_LABEL_EDGE_PADDING * overlayScale;
  const labelHeight = MAP_LABEL_HEIGHT * overlayScale;
  const baselineInset = 17 * overlayScale;
  const rowStep = (MAP_LABEL_HEIGHT + 8) * overlayScale;
  const verticalOffsets = [0, -rowStep, rowStep, -2 * rowStep, 2 * rowStep, -3 * rowStep, 3 * rowStep];
  const occupied = [...obstacles];

  return items.map(({ x, y, width, preferredSide, markerRadius = 16 }) => {
    const gap = (markerRadius + MAP_LABEL_VISIBLE_GAP) * overlayScale;
    const labelWidth = width * overlayScale;
    const minX = viewport.x + edge;
    const maxX = viewport.x + viewport.width - edge - labelWidth;
    const minTop = viewport.y + edge;
    const maxTop = viewport.y + viewport.height - edge - labelHeight;
    const preferred = preferredSide ?? (x <= viewport.x + viewport.width / 2 ? "right" : "left");
    const sideX = {
      right: x + gap,
      left: x - gap - labelWidth,
    };
    const sideOrder = preferred === "left" ? ["left", "right"] : ["right", "left"];
    const createCandidate = (candidateX, candidateTop) => {
      const left = Math.min(maxX, Math.max(minX, candidateX));
      const top = Math.min(maxTop, Math.max(minTop, candidateTop));
      return {
        x: left,
        y: top + baselineInset,
        box: { left, right: left + labelWidth, top, bottom: top + labelHeight },
      };
    };
    const sideCandidates = verticalOffsets.flatMap((offset) => sideOrder.map((side) => createCandidate(
      sideX[side],
      y - labelHeight / 2 + offset,
    )));
    const centeredCandidates = [
      createCandidate(x - labelWidth / 2, y - gap - labelHeight),
      createCandidate(x - labelWidth / 2, y + gap),
    ];
    const candidates = [...sideCandidates.slice(0, 6), ...centeredCandidates, ...sideCandidates.slice(6)];
    const safeCandidates = candidates.filter(({ box }) => obstacles.every((obstacle) => !boxesOverlap(box, obstacle, 4 * overlayScale)));
    if (!safeCandidates.length) return { x, y, box: null, hidden: true };
    const collisionFree = safeCandidates.find(({ box }) => occupied.every((other) => !boxesOverlap(box, other, 4 * overlayScale)));
    if (!collisionFree) return { x, y, box: null, hidden: true };
    occupied.push(collisionFree.box);
    return { x: collisionFree.x, y: collisionFree.y, box: collisionFree.box };
  });
}

export function mapMarkerObstacle({ x, y }, radius, overlayScale) {
  const extent = (radius + MAP_MARKER_LABEL_CLEARANCE) * overlayScale;
  return { left: x - extent, right: x + extent, top: y - extent, bottom: y + extent };
}

// Curves around the direct line between endpoints instead of forcing the
// control point above both of them. That preserves the familiar arch on
// east/west routes and turns a north/south route into a gentle sideways bow
// without overshooting and hooking back into its destination.
export function calculateRouteControlPoint(start, end, options = {}) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  if (!distance) return midpoint;

  let normalX = -dy / distance;
  let normalY = dx / distance;
  if (normalY >= 0) {
    normalX *= -1;
    normalY *= -1;
  }
  const curve = Math.min(options.maxCurve ?? 52, Math.max(4, distance * (options.curveRatio ?? .18)));
  return {
    x: midpoint.x + normalX * curve,
    y: midpoint.y + normalY * curve,
  };
}

export function isValidMapLocation(location) {
  const { latitude, longitude } = location ?? {};
  return typeof latitude === "number"
    && typeof longitude === "number"
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180
    && !(latitude === 0 && longitude === 0);
}

export function isRegionalMapLocation(location) {
  if (!isValidMapLocation(location)) return false;
  return location.latitude >= MAP_PROJECTION.minLatitude
    && location.latitude <= MAP_PROJECTION.maxLatitude
    && location.longitude >= MAP_PROJECTION.minLongitude
    && location.longitude <= MAP_PROJECTION.maxLongitude;
}

export function selectMapMode(locations) {
  const located = locations.filter(isValidMapLocation);
  return located.some((location) => (location.countryCode && location.countryCode !== "US")
    || !isRegionalMapLocation(location)) ? "global" : "regional";
}

export function groupLocatedStreamsByCity(streams) {
  const groups = new Map();
  streams.forEach((stream) => {
    const locationLabel = String(stream.location?.label ?? "").trim();
    const locationParts = locationLabel.split("·").map((part) => part.trim());
    const city = locationParts[0];
    const latitude = stream.location?.latitude;
    const longitude = stream.location?.longitude;
    const country = String(stream.location?.countryCode ?? locationParts.at(-1) ?? "")
      .trim()
      .toLocaleUpperCase("en-US");
    const key = typeof latitude === "number" && Number.isFinite(latitude)
      && typeof longitude === "number" && Number.isFinite(longitude)
      ? [city.toLocaleUpperCase("en-US"), country, latitude, longitude].join("|")
      : locationParts.join("·").toLocaleUpperCase("en-US");
    const existing = groups.get(key);
    if (existing) {
      existing.streams.push(stream);
      existing.count += 1;
      return;
    }
    groups.set(key, { city, location: stream.location, streams: [stream], count: 1 });
  });
  return [...groups.values()].map((group) => ({
    ...group,
    label: group.count > 1 ? `${group.city.toUpperCase()} (${group.count})` : group.city.toUpperCase(),
  }));
}

export function projectMapLocation(latitude, longitude) {
  return {
    x: MAP_PROJECTION.left + ((longitude - MAP_PROJECTION.minLongitude)
      / (MAP_PROJECTION.maxLongitude - MAP_PROJECTION.minLongitude))
      * (MAP_PROJECTION.right - MAP_PROJECTION.left),
    y: MAP_PROJECTION.top + ((MAP_PROJECTION.maxLatitude - latitude)
      / (MAP_PROJECTION.maxLatitude - MAP_PROJECTION.minLatitude))
      * (MAP_PROJECTION.bottom - MAP_PROJECTION.top),
  };
}

export function projectWorldLocation(latitude, longitude) {
  return {
    x: WORLD_PROJECTION.left + ((longitude - WORLD_PROJECTION.minLongitude)
      / (WORLD_PROJECTION.maxLongitude - WORLD_PROJECTION.minLongitude))
      * (WORLD_PROJECTION.right - WORLD_PROJECTION.left),
    y: WORLD_PROJECTION.top + ((WORLD_PROJECTION.maxLatitude - latitude)
      / (WORLD_PROJECTION.maxLatitude - WORLD_PROJECTION.minLatitude))
      * (WORLD_PROJECTION.bottom - WORLD_PROJECTION.top),
  };
}

function fitAspectRatio(width, height) {
  const aspectRatio = MAP_VIEWBOX.width / MAP_VIEWBOX.height;
  if (width / height < aspectRatio) return { width: height * aspectRatio, height };
  return { width, height: width / aspectRatio };
}

export function calculateMapViewport(locations) {
  const points = locations.filter(isRegionalMapLocation)
    .map(({ latitude, longitude }) => projectMapLocation(Number(latitude), Number(longitude)));
  if (!points.length) {
    return { x: 0, y: 0, width: MAP_VIEWBOX.width, height: MAP_VIEWBOX.height, zoom: 1, points };
  }

  const xValues = points.map(({ x }) => x);
  const yValues = points.map(({ y }) => y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const paddedWidth = Math.max(MINIMUM_VIEWPORT_WIDTH, maxX - minX + VIEWPORT_PADDING * 2);
  const paddedHeight = Math.max(MINIMUM_VIEWPORT_HEIGHT, maxY - minY + VIEWPORT_PADDING * 2);
  const { width, height } = fitAspectRatio(paddedWidth, paddedHeight);
  const x = (minX + maxX) / 2 - width / 2;
  const y = (minY + maxY) / 2 - height / 2;
  return { x, y, width, height, zoom: MAP_VIEWBOX.width / width, points };
}

export function calculateActiveMapViewport(locations, homeLocation = null) {
  const located = locations.filter(isValidMapLocation);
  const home = isValidMapLocation(homeLocation) ? [homeLocation] : [];
  return calculateMapViewport(located.length ? [...located, ...home] : []);
}
