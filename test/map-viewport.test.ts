import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_LABEL_GAP,
  MAP_VIEWBOX,
  MINIMUM_VIEWPORT_WIDTH,
  calculateActiveMapViewport,
  calculateMapLabelWidth,
  calculateMapViewport,
  calculateRouteControlPoint,
  groupLocatedStreamsByCity,
  isValidMapLocation,
  isRegionalMapLocation,
  layoutMapLabels,
  mapMarkerObstacle,
  projectMapLocation,
  projectWorldLocation,
  selectMapMode,
} from "../public/map-viewport.js";

const TEST_HOME = { label: "Demo Home · QA · US", countryCode: "US", latitude: 38.25, longitude: -102.75 };

test("map labels group sessions with the same coarse city location", () => {
  const teston = { label: "Teston · QA · US", countryCode: "US", latitude: 39.1, longitude: -100.2 };
  const groups = groupLocatedStreamsByCity([
    { id: "1", playbackMode: "direct", location: teston },
    { id: "2", playbackMode: "transcode", location: { ...teston, label: "teston · qa · us" } },
    { id: "3", playbackMode: "direct", location: { label: "Westford · QB · US", countryCode: "US", latitude: 39.6, longitude: -101.1 } },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].city, "Teston");
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].label, "TESTON (2)");
  assert.deepEqual(groups[0].streams.map(({ id }) => id), ["1", "2"]);
  assert.equal(groups[1].city, "Westford");
  assert.equal(groups[1].count, 1);
  assert.equal(groups[1].label, "WESTFORD");
});

test("map labels group region aliases at identical city coordinates", () => {
  const groups = groupLocatedStreamsByCity([
    {
      id: "local",
      playbackMode: "direct",
      location: { label: "Teston · QA · US", countryCode: "US", latitude: 39.1, longitude: -100.2 },
    },
    {
      id: "remote",
      playbackMode: "transcode",
      location: { label: "Teston · Quality Area · US", countryCode: "US", latitude: 39.1, longitude: -100.2 },
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "TESTON (2)");
  assert.deepEqual(groups[0].streams.map(({ id }) => id), ["local", "remote"]);
});

test("map labels retain full-label identity without valid coordinates", () => {
  const groups = groupLocatedStreamsByCity([
    {
      id: "short-region",
      playbackMode: "direct",
      location: { label: "Teston · QA · US", countryCode: "US", latitude: null, longitude: null },
    },
    {
      id: "long-region",
      playbackMode: "transcode",
      location: { label: "Teston · Quality Area · US", countryCode: "US", latitude: null, longitude: null },
    },
  ]);

  assert.equal(groups.length, 2);
});

test("map label widths stay compact for short cities and expand with their text", () => {
  assert.equal(calculateMapLabelWidth("NOVA"), 50);
  assert.equal(calculateMapLabelWidth("DELTA"), 56);
  assert.equal(calculateMapLabelWidth("NORTHFIELD"), 88);
  assert.equal(calculateMapLabelWidth("A".repeat(30)), 150);
});

test("map viewport uses the full plate for empty or invalid locations", () => {
  const viewport = calculateMapViewport([
    { latitude: null, longitude: -100.2 },
    { latitude: 95, longitude: 0 },
    { latitude: null, longitude: null },
  ]);
  assert.deepEqual(viewport, { x: 0, y: 0, width: MAP_VIEWBOX.width, height: MAP_VIEWBOX.height, zoom: 1, points: [] });
  assert.equal(isValidMapLocation({ latitude: "not a number", longitude: -100.2 }), false);
  assert.equal(isValidMapLocation({ latitude: 0, longitude: 0 }), false);
  assert.equal(isRegionalMapLocation({ latitude: 0, longitude: 0 }), false);
});

test("map mode stays regional for lower-48 sessions and switches for the rest of the world", () => {
  assert.equal(selectMapMode([]), "regional");
  assert.equal(selectMapMode([{ countryCode: "US", latitude: 39.1, longitude: -100.2 }]), "regional");
  assert.equal(selectMapMode([{ countryCode: "FR", latitude: 46.1, longitude: 3.1 }]), "global");
  assert.equal(selectMapMode([{ countryCode: "US", latitude: 62.3, longitude: -151.4 }]), "global");
  assert.equal(selectMapMode([{ countryCode: "US", latitude: 20.7, longitude: -156.3 }]), "global");
  assert.equal(selectMapMode([{ countryCode: null, latitude: 34.2, longitude: 141.3 }]), "global");
  assert.equal(selectMapMode([{ countryCode: "FR", latitude: null, longitude: null }]), "regional");
  assert.equal(selectMapMode([{ countryCode: null, latitude: 0, longitude: 0 }]), "regional");
});

test("world projection keeps representative and edge locations inside the world plate", () => {
  const locations = [
    { latitude: 46.1, longitude: 3.1 },
    { latitude: 34.2, longitude: 141.3 },
    { latitude: -31.4, longitude: 149.2 },
    { latitude: 62.3, longitude: -151.4 },
    { latitude: 20.7, longitude: -156.3 },
    { latitude: 85, longitude: 180 },
    { latitude: -60, longitude: -180 },
  ];
  locations.map(({ latitude, longitude }) => projectWorldLocation(latitude, longitude)).forEach(({ x, y }) => {
    assert.ok(x >= 24 && x <= 736);
    assert.ok(y >= 32 && y <= 388);
  });
});

test("map labels avoid one another and supplied obstacles for clustered locations", () => {
  const viewport = { x: 200, y: 100, width: 380, height: 210, zoom: 2 };
  const overlayScale = 1 / viewport.zoom;
  const obstacle = { left: 365, right: 406, top: 188, bottom: 202.5 };
  const labels = layoutMapLabels([
    { x: 353.5, y: 190.3, width: 82 },
    { x: 353.5, y: 190.3, width: 82 },
    { x: 349, y: 192, width: 94 },
  ], viewport, overlayScale, [obstacle]);
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  labels.forEach(({ box }) => assert.equal(overlaps(box, obstacle), false));
  labels.forEach(({ box }, index) => labels.slice(index + 1).forEach((other) => assert.equal(overlaps(box, other.box), false)));
});

test("map labels honor radial side preferences when both sides are clear", () => {
  const viewport = { x: 0, y: 0, width: 760, height: 420, zoom: 1 };
  const [left, right] = layoutMapLabels([
    { x: 220, y: 120, width: 90, preferredSide: "left" },
    { x: 520, y: 300, width: 90, preferredSide: "right" },
  ], viewport, 1);

  assert.ok(left.box.right < 220);
  assert.ok(right.box.left > 520);
});

test("map labels keep the tightened visual gap outside the marker halo", () => {
  const viewport = { x: 0, y: 0, width: 760, height: 420, zoom: 1 };
  const marker = mapMarkerObstacle({ x: 200, y: 150 }, 16, 1);
  const [label] = layoutMapLabels([
    { x: 200, y: 150, width: 90, preferredSide: "right" },
  ], viewport, 1, [marker]);

  assert.equal(MAP_LABEL_GAP - 16, 7);
  assert.equal(label.box.left, 223);
  assert.equal(label.box.top, 136);
  assert.ok(label.box.left > marker.right);
});

test("a label at the home core uses the larger halo without falling back to a distant row", () => {
  const viewport = { x: 0, y: 0, width: 760, height: 420, zoom: 1 };
  const homeCore = mapMarkerObstacle({ x: 200, y: 150 }, 25, 1);
  const coLocatedSession = mapMarkerObstacle({ x: 200, y: 150 }, 16, 1);
  const [label] = layoutMapLabels([
    { x: 200, y: 150, width: 94, preferredSide: "right", markerRadius: 25 },
  ], viewport, 1, [homeCore, coLocatedSession]);

  assert.equal(label.box.left, 232);
  assert.equal(label.box.top, 136);
  assert.equal(label.box.left - (200 + 25), 7);
});

test("map labels cannot cover protected application core or home marker circles", () => {
  const viewport = { x: 200, y: 100, width: 380, height: 210, zoom: 2 };
  const overlayScale = 1 / viewport.zoom;
  const plexCore = mapMarkerObstacle({ x: 353.5, y: 190.3 }, 25, overlayScale);
  const nearbySession = mapMarkerObstacle({ x: 368, y: 182 }, 16, overlayScale);
  const labels = layoutMapLabels([
    { x: 353.5, y: 190.3, width: 102 },
    { x: 349, y: 192, width: 88 },
  ], viewport, overlayScale, [plexCore, nearbySession]);
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  labels.forEach(({ box }) => {
    assert.equal(overlaps(box, plexCore), false);
    assert.equal(overlaps(box, nearbySession), false);
  });
});

test("map labels hide instead of covering a protected marker when no safe placement exists", () => {
  const viewport = { x: 0, y: 0, width: 100, height: 60, zoom: 1 };
  const protectedArea = { left: 0, right: 100, top: 0, bottom: 60 };
  const [label] = layoutMapLabels([{ x: 50, y: 30, width: 70 }], viewport, 1, [protectedArea]);

  assert.equal(label.hidden, true);
  assert.equal(label.box, null);
});

test("map label layout stays inside the active viewport near both edges", () => {
  const viewport = { x: 0, y: 0, width: 760, height: 420, zoom: 1 };
  const labels = layoutMapLabels([
    { x: 2, y: 2, width: 110 },
    { x: 758, y: 418, width: 110 },
  ], viewport, 1);

  labels.forEach(({ box }) => {
    assert.ok(box.left >= 12 && box.right <= 748);
    assert.ok(box.top >= 12 && box.bottom <= 408);
  });
});

test("a session inside the home halo stays beside the cluster even with slightly different coordinates", () => {
  const viewport = { x: 0, y: 0, width: 586, height: 447, zoom: 1 };
  // Screen-space geometry from a crowded regional map; no location data needed.
  const items = [
    { x: 129.5, y: 249, width: 81.6, preferredSide: "right" },
    { x: 147.5, y: 293, width: 107.2, preferredSide: "right" },
    { x: 169.5, y: 181.5, width: 94.4, preferredSide: "right" },
    { x: 80, y: 131.5, width: 88, preferredSide: "left" },
    { x: 171, y: 331.5, width: 56, preferredSide: "right" },
    { x: 506, y: 239, width: 88, preferredSide: "right" },
    { x: 117.1, y: 258.6, width: 68.8, preferredSide: "right" },
  ];
  const obstacles = [mapMarkerObstacle({ x: 117, y: 258.5 }, 25, 1), ...items.map((p) => mapMarkerObstacle(p, 16, 1))];
  const labels = layoutMapLabels(items, viewport, 1, obstacles);
  const home = labels[6].box;
  assert.ok(home);
  assert.ok(home.right < 90, "home label sits to the left of the larger halo");
  assert.ok(Math.abs((home.top + home.bottom) / 2 - 258.6) < 5, "home label stays level with its marker");
});

test("a small edge-margin adjustment preserves a clear aligned label beside the home halo", () => {
  const item = { x: 108, y: 250, width: 68.8, preferredSide: "left", markerRadius: 25 };
  const [label] = layoutMapLabels([item], { x: 0, y: 0, width: 580, height: 440 }, 1, [mapMarkerObstacle(item, 25, 1)]);
  assert.ok(label.box.right < 108, "use the available space left of home");
  assert.equal((label.box.top + label.box.bottom) / 2, 250, "stay aligned instead of jumping a row");
  assert.ok(label.box.left >= 6, "retain breathing room at the map edge");
});

test("a crowded marker near the left edge gets a nearby label before flexible neighbors", () => {
  const viewport = { x: 0, y: 0, width: 583, height: 447, zoom: 1 };
  const items = [
    { x: 163, y: 217, width: 94.4, preferredSide: "right" },
    { x: 121, y: 288.5, width: 81.6, preferredSide: "right" },
    { x: 69, y: 165, width: 88, preferredSide: "left" },
    { x: 108, y: 298.5, width: 68.8, preferredSide: "right", markerRadius: 25 },
    { x: 114.5, y: 233.5, width: 81.6, preferredSide: "right" },
    { x: 516.5, y: 278, width: 88, preferredSide: "right" },
  ];
  const obstacles = [mapMarkerObstacle({ x: 108, y: 298.5 }, 25, 1), ...items.map((p) => mapMarkerObstacle(p, 16, 1))];
  const labels = layoutMapLabels(items, viewport, 1, obstacles);
  const crowded = labels[4].box;
  assert.ok(crowded);
  assert.ok(crowded.right < 114.5, "crowded label uses the open space to its left");
  assert.ok(Math.abs((crowded.top + crowded.bottom) / 2 - 233.5) < 45, "label stays within one nearby diagonal");
  assert.ok(labels.every(({ box }) => box), "neighboring labels remain visible");
  const overlaps = (a, b) => a.left < b.right + 4 && a.right > b.left - 4 && a.top < b.bottom + 4 && a.bottom > b.top - 4;
  labels.forEach(({ box }, index) => {
    assert.ok(obstacles.every(({ circle }) => {
      const dx = circle.x - Math.max(box.left, Math.min(box.right, circle.x));
      const dy = circle.y - Math.max(box.top, Math.min(box.bottom, circle.y));
      return Math.hypot(dx, dy) >= circle.radius + 4;
    }), "labels clear the circular halos, including at diagonal positions");
    assert.ok(labels.slice(index + 1).every((other) => !overlaps(box, other.box)));
  });
  const reordered = layoutMapLabels([...items].reverse(), viewport, 1, obstacles).reverse();
  assert.deepEqual(reordered, labels, "stream ordering must not make labels jump");
});

test("displaced labels connect back to their marker while adjacent and hidden labels do not", () => {
  const viewport = { x: 0, y: 0, width: 760, height: 420, zoom: 1 };
  const item = { x: 200, y: 150, width: 90 };
  const [nearby] = layoutMapLabels([item], viewport, 1, [mapMarkerObstacle(item, 16, 1)]);
  assert.equal(nearby.connector, null);
  const [distant] = layoutMapLabels([item], viewport, 1, [{ left: 140, right: 350, top: 80, bottom: 220 }]);
  assert.ok(distant.connector, "a distant label has a leader line");
  const { start, end } = distant.connector;
  assert.ok(Math.hypot(start.x - item.x, start.y - item.y) > 16, "connector starts outside the marker halo");
  assert.ok(Math.hypot(start.x - item.x, start.y - item.y) < 22, "connector remains attached to its own marker");
  assert.ok(Math.min(Math.abs(end.x - distant.box.left), Math.abs(end.x - distant.box.right), Math.abs(end.y - distant.box.top), Math.abs(end.y - distant.box.bottom)) <= 2);
  const [hidden] = layoutMapLabels([item], viewport, 1, [{ left: 0, right: 760, top: 0, bottom: 420 }]);
  assert.equal(hidden.hidden, true);
  assert.equal(hidden.connector, null);
});

test("fallback connectors cannot attach to another city's marker", () => {
  const items = [
    { x: 116, y: 117, width: 98 }, { x: 123, y: 146, width: 109 },
    { x: 173, y: 206, width: 60 }, { x: 260, y: 214, width: 78 },
    { x: 165, y: 223, width: 67 },
  ];
  const labels = layoutMapLabels(items, { x: 0, y: 0, width: 400, height: 340 }, 1, items.map((p) => mapMarkerObstacle(p, 16, 1)));
  assert.ok(labels.every(({ box }) => box), "a clear alternative keeps every label visible");
  labels.forEach(({ connector }, index) => {
    if (!connector) return;
    const { start, end } = connector;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    items.forEach((point, otherIndex) => {
      if (index === otherIndex) return;
      const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
      assert.ok(Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy) >= 18.5, "leader clears unrelated marker halos");
    });
  });
});

test("northbound routes bow sideways without overshooting their destination", () => {
  const control = calculateRouteControlPoint({ x: 360, y: 300 }, { x: 360, y: 100 });

  assert.ok(control.x < 360);
  assert.equal(control.y, 200);
  assert.ok(control.y > 100 && control.y < 300);
});

test("eastbound routes retain an upward arch centered between endpoints", () => {
  const control = calculateRouteControlPoint({ x: 200, y: 240 }, { x: 600, y: 240 });

  assert.equal(control.x, 400);
  assert.ok(control.y < 240);
});

test("map viewport gives one location a capped regional zoom", () => {
  const viewport = calculateMapViewport([{ latitude: 39.1, longitude: -100.2 }]);
  assert.ok(viewport.width >= MINIMUM_VIEWPORT_WIDTH);
  assert.ok(viewport.zoom > 1 && viewport.zoom <= 3.2);
});

test("active map viewport keeps the configured home core visible with one remote stream", () => {
  const viewport = calculateActiveMapViewport([{ latitude: 34.5, longitude: -86.5 }], TEST_HOME);
  const home = projectMapLocation(TEST_HOME.latitude, TEST_HOME.longitude);
  const decorationMargin = 54 / viewport.zoom;

  assert.ok(home.x >= viewport.x + decorationMargin);
  assert.ok(home.x <= viewport.x + viewport.width - decorationMargin);
  assert.ok(home.y >= viewport.y + decorationMargin);
  assert.ok(home.y <= viewport.y + viewport.height - decorationMargin);
});

test("active map viewport stays on the full plate without located streams", () => {
  assert.deepEqual(calculateActiveMapViewport([], TEST_HOME), {
    x: 0,
    y: 0,
    width: MAP_VIEWBOX.width,
    height: MAP_VIEWBOX.height,
    zoom: 1,
    points: [],
  });
});

test("map viewport stays stable for clustered or identical locations", () => {
  const identical = calculateMapViewport([{ latitude: 39.25, longitude: -100.94 }, { latitude: 39.25, longitude: -100.94 }]);
  const cluster = calculateMapViewport([{ latitude: 39.25, longitude: -100.94 }, { latitude: 39.31, longitude: -100.88 }]);
  [identical, cluster].forEach((viewport) => {
    assert.ok(Number.isFinite(viewport.x) && Number.isFinite(viewport.y));
    assert.ok(viewport.zoom > 1 && viewport.zoom <= 3.2);
  });
});

test("map viewport expands for widely separated active locations", () => {
  const viewport = calculateMapViewport([{ latitude: 44.25, longitude: -122.15 }, { latitude: 34.25, longitude: -84.15 }]);
  assert.ok(viewport.width > MINIMUM_VIEWPORT_WIDTH);
  assert.ok(viewport.points.every(({ x, y }) => x >= viewport.x && x <= viewport.x + viewport.width && y >= viewport.y && y <= viewport.y + viewport.height));
});
