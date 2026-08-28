# Capacity Time-Window Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four real Netdata-backed capacity windows while keeping the upgrade verdict authoritative to thirty days.

**Architecture:** Parameterize the existing Netdata history normalizer, cache each configured range independently, and expose a bounded four-window contract with a separate thirty-day verdict. Keep selection and rendering in the dependency-free browser application, with no client-side range derivation or persistence.

**Tech Stack:** TypeScript 7, Zod 4, Node test runner, Fastify static UI, dependency-free HTML/CSS/JavaScript.

**Spec:** `docs/superpowers/specs/2026-08-28-capacity-time-window-selector-design.md`

## Global Constraints

- Run every shell command through `rtk`.
- Keep `1h`, `1d`, `1w`, and `1m` display histories at or below 240 points.
- Query each range directly from Netdata and keep all history in memory.
- Refresh `1h` every 45 seconds without delaying the five-second live collector.
- Derive `upgradePressure30d` only from `1m`.
- Preserve existing pointer and keyboard chart inspection.
- Do not deploy.

---

### Task 1: Range-aware history normalization and contract

**Files:**
- Modify: `src/contracts/dashboard.ts`
- Modify: `src/collectors/netdata.ts`
- Test: `test/contracts.test.ts`
- Test: `test/collectors/normalizers.test.ts`

**Interfaces:**
- Produces: `NETDATA_HISTORY_RANGES`, `NetdataHistoryRangeKey`, range-parameterized `normalizeNetdataHistory(...)`, and `history.windows` plus `history.upgradePressure30d`.
- Consumes: existing Netdata v1 chart responses and `plexHostDataSchema`.

- [ ] **Step 1: Write failing contract and normalizer tests**

```ts
const hour = normalizeNetdataHistory(metrics, undefined, Number.NEGATIVE_INFINITY, "1h");
assert.equal(hour?.requestedWindowSeconds, 3_600);
assert.equal(hour?.bucketSeconds, 15);
assert.equal(hour?.summary.ramPeakAt, "2030-01-01T00:30:00.000Z");

fixture.panels.plexHost.data.history = {
  windows: { "1h": hour, "1d": day, "1w": week, "1m": month },
  upgradePressure30d: { pressure: "comfortable", constraint: null },
};
assert.equal(dashboardSnapshotSchema.safeParse(fixture).success, true);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `rtk npm test -- --test-name-pattern='Netdata history|Plex capacity history'`

Expected: failures because range keys, peak timestamps, and the new history container are not implemented.

- [ ] **Step 3: Implement parameterized normalization and strict schemas**

```ts
export const NETDATA_HISTORY_RANGES = {
  "1h": { windowSeconds: 3_600, analysisPoints: 240, refreshMs: 45_000 },
  "1d": { windowSeconds: 86_400, analysisPoints: 288, refreshMs: 300_000 },
  "1w": { windowSeconds: 604_800, analysisPoints: 336, refreshMs: 300_000 },
  "1m": { windowSeconds: 2_592_000, analysisPoints: 1_440, refreshMs: 300_000 },
} as const;
```

Use proportional bucket boundaries for downsampling, add `ramPeakAt`, `vramPeakAt`, and `temperaturePeakAt`, and move pressure/constraint into the explicit thirty-day verdict schema.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `rtk npm test -- --test-name-pattern='Netdata history|Plex capacity history'`

- [ ] **Step 5: Commit the unit**

Run: `rtk git add src/contracts/dashboard.ts src/collectors/netdata.ts test/contracts.test.ts test/collectors/normalizers.test.ts && rtk git commit -m "feat: add range-aware capacity history contract"`

### Task 2: Independent Netdata history caches and fixture windows

**Files:**
- Modify: `src/collectors/netdata.ts`
- Modify: `fixtures/dashboard-snapshot.json`
- Test: `test/collectors/normalizers.test.ts`
- Test: `test/contracts.test.ts`

**Interfaces:**
- Consumes: `NETDATA_HISTORY_RANGES` and the new contract from Task 1.
- Produces: independent range requests/caches and a deterministic four-window demo fixture.

- [ ] **Step 1: Write a failing cache behavior test**

```ts
assert.equal(historyRequests("1h").every((url) => query(url, "after") === "-3600"), true);
assert.equal(historyRequests("1h").every((url) => query(url, "points") === "240"), true);
assert.equal(second.history?.windows["1h"]?.points.at(-1)?.streamPeak, 6);
assert.deepEqual(second.history?.upgradePressure30d, { pressure: "pressured", constraint: "gpu_encoder" });
```

- [ ] **Step 2: Run the collector test and verify RED**

Run: `rtk npm test -- --test-name-pattern='Netdata history refreshes'`

Expected: the collector only requests and returns one thirty-day history.

- [ ] **Step 3: Implement per-range cache state**

Maintain cache, workload source, last-attempt, and in-flight refresh state by range. Start due refreshes in the background on each live collection and build `upgradePressure30d` only from cached `1m` data.

- [ ] **Step 4: Migrate the synthetic fixture**

Add all four window keys with bounded synthetic points and peak timestamps. Make the month verdict intentionally independent from the shorter summaries.

- [ ] **Step 5: Run collector and contract tests and verify GREEN**

Run: `rtk npm test -- --test-name-pattern='Netdata|Plex capacity|approved sanitized fixture'`

- [ ] **Step 6: Commit the unit**

Run: `rtk git add src/collectors/netdata.ts fixtures/dashboard-snapshot.json test/collectors/normalizers.test.ts test/contracts.test.ts && rtk git commit -m "feat: cache four Netdata capacity windows"`

### Task 3: Accessible selected-window panel

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `panel.data.history.windows[selectedCapacityWindow]` and `panel.data.history.upgradePressure30d`.
- Produces: `TIME WINDOW` selector, selected-window chart/copy, five responsive x-axis labels, and unchanged chart inspection behavior.

- [ ] **Step 1: Write failing static integration assertions**

```ts
assert.match(index.body, /aria-label="Capacity time window"/);
assert.match(index.body, /data-capacity-window="1m"[^>]*aria-pressed="true"/);
assert.match(index.body, /Upgrade pressure · 30D/);
assert.match(client.body, /history\.windows\[selectedCapacityWindow\]/);
assert.match(client.body, /capacityPointerRatio !== null/);
```

- [ ] **Step 2: Run the server test and verify RED**

Run: `rtk npm test -- --test-name-pattern='fixture mode serves health'`

- [ ] **Step 3: Implement markup, styles, and selection state**

Add native buttons with `aria-pressed`, square borders, teal active/focus states, and a responsive capacity header grid. Store the latest panel and re-render when selection changes; do not mutate or filter history points.

- [ ] **Step 4: Implement selected-window labels**

Render range-specific eyebrow text, interval/coverage footer copy, workload interval, summary peak timestamps, tooltips, and five x-axis labels. End `1h` with `NOW`; render the verdict exclusively from `upgradePressure30d` and label it `UPGRADE PRESSURE · 30D`.

- [ ] **Step 5: Run server and browser checks and verify GREEN**

Run: `rtk npm test -- --test-name-pattern='fixture mode serves health' && rtk npm run check:browser`

- [ ] **Step 6: Commit the unit**

Run: `rtk git add public/index.html public/styles.css public/app.js test/server.test.ts && rtk git commit -m "feat: add capacity time-window selector"`

### Task 4: Verification and visual review

**Files:**
- Modify only if verification exposes a tested defect.

**Interfaces:**
- Consumes: the complete feature branch.
- Produces: fresh automated and visual evidence suitable for handoff.

- [ ] **Step 1: Run the focused tests**

Run: `rtk npm test -- --test-name-pattern='Netdata|Plex capacity|fixture mode serves health'`

- [ ] **Step 2: Run full type/build/browser verification**

Run: `rtk npm test && rtk npm run lint && rtk npm run build && rtk npm run check:browser`

- [ ] **Step 3: Run demo mode and inspect desktop and narrow layouts**

Start the fixture server without deploying, capture a desktop screenshot and a 390-pixel-wide screenshot, exercise all four buttons, keyboard focus, and chart arrow inspection, and check console errors plus horizontal overflow.

- [ ] **Step 4: Review the complete diff against the spec**

Confirm all four ranges are direct Netdata requests, all payloads are bounded, short-range failures preserve last good data, and the verdict is month-only.

- [ ] **Step 5: Commit any verification fixes and report**

Run: `rtk git status --short --branch && rtk git log -1 --oneline`
