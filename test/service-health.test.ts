import assert from "node:assert/strict";
import { test } from "node:test";
import { serviceHealthSummary } from "../public/service-health.js";

const mixed = {
  status: "ok",
  data: {
    healthy: 4,
    down: 3,
    monitors: ["up", "up", "up", "up", "down", "down", "down"].map((status, i) => ({
      id: String(i), name: `Service ${i + 1}`, status, pingMs: null, observedAt: null,
    })),
  },
};

test("mixed service health allocates the entire bar between up and down", () => {
  const summary = serviceHealthSummary(mixed);
  assert.equal(summary.healthy, 4);
  assert.equal(summary.down, 3);
  assert.equal(summary.total, 7);
  assert.ok(Math.abs(summary.upPercent - 57.142857) < 0.000001);
  assert.ok(Math.abs(summary.downPercent - 42.857143) < 0.000001);
  assert.equal(summary.otherPercent, 0);
  assert.equal(summary.state, "down");
});

test("pending, maintenance, and unknown monitors take a neutral share rather than appearing up", () => {
  const panel = structuredClone(mixed);
  for (const status of ["pending", "maintenance", "unknown"]) {
    panel.data.monitors.push({ id: status, name: status, status, pingMs: null, observedAt: null });
  }
  const summary = serviceHealthSummary(panel);
  assert.equal(summary.total, 10);
  assert.equal(summary.other, 3);
  assert.deepEqual([summary.upPercent, summary.downPercent, summary.otherPercent], [40, 30, 30]);
});

test("the bar supports all-up and all-down endpoints without a phantom opposite segment", () => {
  for (const [healthy, down, state, upPercent, downPercent] of [
    [7, 0, "up", 100, 0], [0, 7, "down", 0, 100],
  ] as const) {
    const monitors = mixed.data.monitors.map((monitor) => ({ ...monitor, status: healthy ? "up" : "down" }));
    const summary = serviceHealthSummary({ ...mixed, data: { healthy, down, monitors } });
    assert.equal(summary.state, state);
    assert.deepEqual([summary.upPercent, summary.downPercent, summary.otherPercent], [upPercent, downPercent, 0]);
  }
});

test("zero monitors produces an empty neutral bar rather than all operational", () => {
  const summary = serviceHealthSummary({ status: "ok", data: { healthy: 0, down: 0, monitors: [] } });
  assert.equal(summary.total, 0);
  assert.equal(summary.state, "empty");
  assert.deepEqual([summary.upPercent, summary.downPercent, summary.otherPercent], [0, 0, 0]);
});

test("a monitor with unknown status prevents an all-operational summary", () => {
  const summary = serviceHealthSummary({ status: "ok", data: { healthy: 0, down: 0, monitors: [{ ...mixed.data.monitors[0], status: "unknown" }] } });
  assert.equal(summary.state, "other");
  assert.equal(summary.otherPercent, 100);
});

test("stale or failed collection cannot display last-good counts as current health", () => {
  for (const status of ["stale", "error", "disabled"]) {
    const summary = serviceHealthSummary({ ...mixed, status });
    assert.equal(summary.healthy, null);
    assert.equal(summary.down, null);
    assert.equal(summary.state, status);
    assert.deepEqual([summary.upPercent, summary.downPercent, summary.otherPercent], [0, 0, 0]);
  }
});

test("missing data displays unavailable rather than zero healthy services", () => {
  const summary = serviceHealthSummary({ status: "ok", data: null });
  assert.equal(summary.healthy, null);
  assert.equal(summary.down, null);
  assert.equal(summary.state, "error");
});
