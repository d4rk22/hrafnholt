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

function labelOverlapsObstacle(box, obstacle, padding) {
  if (!obstacle.circle) return boxesOverlap(box, obstacle, padding);
  const { x, y, radius } = obstacle.circle;
  const nearestX = Math.max(box.left, Math.min(box.right, x));
  const nearestY = Math.max(box.top, Math.min(box.bottom, y));
  return Math.hypot(x - nearestX, y - nearestY) < radius + padding;
}

function mapLabelConnector({ x, y, markerRadius = 16 }, box, overlayScale, obstacles) {
  const targetX = Math.max(box.left, Math.min(box.right, x));
  const targetY = Math.max(box.top, Math.min(box.bottom, y));
  const distance = Math.hypot(targetX - x, targetY - y);
  if (distance <= (markerRadius + MAP_LABEL_VISIBLE_GAP + 12) * overlayScale) return null;
  const dx = (targetX - x) / distance;
  const dy = (targetY - y) / distance;
  let startDistance = (markerRadius + 2) * overlayScale;
  // Keep the line outside any larger halo enclosing the session marker.
  obstacles.forEach(({ circle }) => {
    if (!circle || Math.hypot(circle.x - x, circle.y - y) > circle.radius) return;
    const cx = circle.x - x;
    const cy = circle.y - y;
    const along = cx * dx + cy * dy;
    const across = cx * dy - cy * dx;
    startDistance = Math.max(startDistance, along + Math.sqrt(Math.max(0, circle.radius ** 2 - across ** 2)) + overlayScale);
  });
  const endDistance = distance - 2 * overlayScale;
  if (startDistance >= endDistance) return null;
  return {
    start: { x: x + dx * startDistance, y: y + dy * startDistance },
    end: { x: x + dx * endDistance, y: y + dy * endDistance },
  };
}

function connectorOverlapsObstacle({ start, end }, obstacle) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (obstacle.circle) {
    const { x, y, radius } = obstacle.circle;
    const t = Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - start.x - t * dx, y - start.y - t * dy) < radius;
  }
  // Intersect the segment's parameter interval with each rectangle axis.
  let entry = 0;
  let exit = 1;
  for (const [origin, delta, min, max] of [[start.x, dx, obstacle.left, obstacle.right], [start.y, dy, obstacle.top, obstacle.bottom]]) {
    if (delta === 0) {
      if (origin < min || origin > max) return false;
    } else {
      const a = (min - origin) / delta;
      const b = (max - origin) / delta;
      entry = Math.max(entry, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
  }
  return entry <= exit;
}

// Rank nearby positions by marker distance, then place the most constrained
// labels first. Keep results in input order so labels retain their identities.
export function layoutMapLabels(items, viewport, overlayScale, obstacles = []) {
  const edge = MAP_LABEL_EDGE_PADDING * overlayScale;
  const labelHeight = MAP_LABEL_HEIGHT * overlayScale;
  const baselineInset = 17 * overlayScale;
  const rowStep = (MAP_LABEL_HEIGHT + 8) * overlayScale;
  const verticalOffsets = [0, -rowStep, rowStep, -2 * rowStep, 2 * rowStep, -3 * rowStep, 3 * rowStep];
  const padding = 4 * overlayScale;

  const layouts = items.map(({ x, y, width, preferredSide, markerRadius = 16 }, index) => {
    const gap = (markerRadius + MAP_LABEL_VISIBLE_GAP) * overlayScale;
    const labelWidth = width * overlayScale;
    const minX = viewport.x + edge;
    const maxX = viewport.x + viewport.width - edge - labelWidth;
    const minTop = viewport.y + edge;
    const maxTop = viewport.y + viewport.height - edge - labelHeight;
    // Preserve a naturally aligned position that fits with half the preferred
    // margin. Full clamping would push it into its own halo and force a detour.
    const clampX = (candidateX) => candidateX >= viewport.x + edge / 2
      && candidateX + labelWidth <= viewport.x + viewport.width - edge / 2
      ? candidateX : Math.min(maxX, Math.max(minX, candidateX));
    const preferred = preferredSide ?? (x <= viewport.x + viewport.width / 2 ? "right" : "left");
    const sideX = {
      right: x + gap,
      left: x - gap - labelWidth,
    };
    let above = y - gap - labelHeight;
    let below = y + gap;
    // A session can lie inside a larger home halo without sharing its exact
    // coordinates. Its candidates must clear that halo as well as its own.
    obstacles.filter((obstacle) => x >= obstacle.left && x <= obstacle.right
      && y >= obstacle.top && y <= obstacle.bottom).forEach((obstacle) => {
      const clearance = (MAP_LABEL_VISIBLE_GAP - MAP_MARKER_LABEL_CLEARANCE) * overlayScale;
      sideX.right = Math.max(sideX.right, obstacle.right + clearance);
      sideX.left = Math.min(sideX.left, obstacle.left - clearance - labelWidth);
      above = Math.min(above, obstacle.top - clearance - labelHeight);
      below = Math.max(below, obstacle.bottom + clearance);
    });
    const sideOrder = preferred === "left" ? ["left", "right"] : ["right", "left"];
    const createCandidate = (candidateX, candidateTop) => {
      const left = clampX(candidateX);
      const top = Math.min(maxTop, Math.max(minTop, candidateTop));
      return {
        x: left,
        y: top + baselineInset,
        box: { left, right: left + labelWidth, top, bottom: top + labelHeight },
      };
    };
    const sideCandidates = sideOrder.flatMap((side) => {
      const left = clampX(sideX[side]);
      const tops = verticalOffsets.map((offset) => y - labelHeight / 2 + offset);
      // Near an edge, clamping can move a label slightly toward its marker.
      // Try the nearest clear diagonal around each circular halo, rather than
      // jumping whole rows to clear the corners of a bounding rectangle.
      obstacles.forEach((obstacle) => {
        let top = obstacle.top - padding;
        let bottom = obstacle.bottom + padding;
        if (obstacle.circle) {
          const circle = obstacle.circle;
          const dx = circle.x - Math.max(left, Math.min(left + labelWidth, circle.x));
          const radius = circle.radius + padding + .05 * overlayScale;
          if (Math.abs(dx) >= radius) return;
          const dy = Math.sqrt(radius ** 2 - dx ** 2);
          top = circle.y - dy;
          bottom = circle.y + dy;
        } else if (left >= obstacle.right + padding || left + labelWidth <= obstacle.left - padding) return;
        tops.push(top - labelHeight, bottom);
      });
      return tops.map((top) => createCandidate(left, top));
    });
    const centeredCandidates = [
      createCandidate(x - labelWidth / 2, above),
      createCandidate(x - labelWidth / 2, below),
    ];
    const seen = new Set();
    const candidates = [...sideCandidates, ...centeredCandidates].filter(({ box }) => {
      const key = `${box.left}:${box.top}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return minX <= maxX && minTop <= maxTop
        && obstacles.every((obstacle) => !labelOverlapsObstacle(box, obstacle, padding));
    }).map((candidate) => {
      const { box } = candidate;
      const distance = Math.hypot(x - Math.max(box.left, Math.min(box.right, x)), y - Math.max(box.top, Math.min(box.bottom, y)));
      const side = box.right <= x ? "left" : box.left >= x ? "right" : null;
      // A nearby label should not look attached to a different city's marker.
      const ambiguity = obstacles.reduce((penalty, obstacle) => {
        if (!obstacle.circle || (x >= obstacle.left && x <= obstacle.right && y >= obstacle.top && y <= obstacle.bottom)) return penalty;
        const other = obstacle.circle;
        const otherDistance = Math.hypot(other.x - Math.max(box.left, Math.min(box.right, other.x)), other.y - Math.max(box.top, Math.min(box.bottom, other.y)));
        return Math.max(penalty, (distance + padding - otherDistance) / overlayScale * 2);
      }, 0);
      const score = distance / overlayScale + Math.abs((box.top + box.bottom) / 2 - y) / overlayScale * .2
        + (side === preferred ? 0 : 2) + ambiguity;
      return { ...candidate, score, connector: mapLabelConnector(items[index], box, overlayScale, obstacles) };
    }).filter(({ connector }) => !connector || obstacles.every((obstacle) => {
      // A generic protected area can enclose the source; only circular halos
      // have a known boundary at which the connector can start outside it.
      if (!obstacle.circle && x >= obstacle.left && x <= obstacle.right && y >= obstacle.top && y <= obstacle.bottom) return true;
      return !connectorOverlapsObstacle(connector, obstacle);
    })).sort((a, b) => a.score - b.score || a.box.top - b.box.top || a.box.left - b.box.left);
    const nearbyCount = candidates.filter(({ score }) => score <= markerRadius + MAP_LABEL_VISIBLE_GAP + MAP_LABEL_HEIGHT).length;
    return { index, x, y, width, candidates, nearbyCount };
  });
  layouts.sort((a, b) => a.nearbyCount - b.nearbyCount || a.x - b.x || a.y - b.y || b.width - a.width);
  const occupied = [];
  const connectors = [];
  const results = new Array(items.length);
  layouts.forEach(({ index, x, y, candidates }) => {
    const placement = candidates.find(({ box, connector }) => occupied.every((other) => !boxesOverlap(box, other, padding)
      && (!connector || !connectorOverlapsObstacle(connector, other)))
      && connectors.every((other) => !connectorOverlapsObstacle(other, box)));
    if (!placement) {
      results[index] = { x, y, box: null, hidden: true, connector: null };
      return;
    }
    occupied.push(placement.box);
    if (placement.connector) connectors.push(placement.connector);
    results[index] = {
      x: placement.x, y: placement.y, box: placement.box,
      connector: placement.connector,
    };
  });
  return results;
}

export function mapMarkerObstacle({ x, y }, radius, overlayScale) {
  const extent = (radius + MAP_MARKER_LABEL_CLEARANCE) * overlayScale;
  return { left: x - extent, right: x + extent, top: y - extent, bottom: y + extent, circle: { x, y, radius: extent } };
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
