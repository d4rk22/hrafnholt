import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createEmporiaCollector } from "../src/collectors/emporia.js";

test("Emporia collector exposes configured billing terms for rack estimates", async () => {
  const collector = createEmporiaCollector("http://energy", true, async () => ({}), false,
    { tax_rate: 0.0725, fixed_monthly: 77.98 });
  const data = await collector.collect({ signal: new AbortController().signal });
  assert.equal(data.taxRate, 0.0725);
  assert.equal(data.fixedMonthly, 77.98);
});

const energy = {
  rate: 0.0782, taxRate: 0.0725, fixedMonthly: 77.98,
  serverTodayKwh: 14.2, houseTodayKwh: 43.4,
};

test("rack estimate taxes 24-hour run-rate and the server-room share of the fixed fee", async () => {
  const { estimateRackCost } = await import("../public/rack-energy.js");
  // Screenshot: 672.3 kWh electricity plus 14.2/43.4 of the monthly fee.
  assert.equal(estimateRackCost(672.3, energy)?.toFixed(2), "83.75");
});

test("fixed allocation follows today's server-room share, not rack usage or homelab AC", async () => {
  const { estimateRackCost } = await import("../public/rack-energy.js");
  assert.equal(estimateRackCost(0, energy)?.toFixed(2), "27.36");
  assert.equal(estimateRackCost(0, { ...energy, serverTodayKwh: 0 }), 0);
});

test("missing billing terms or household usage makes the estimate unavailable", async () => {
  const { estimateRackCost } = await import("../public/rack-energy.js");
  for (const data of [null, { ...energy, taxRate: null }, { ...energy, fixedMonthly: null },
    { ...energy, houseTodayKwh: 0 }]) {
    assert.equal(estimateRackCost(672.3, data), null);
  }
  assert.equal(estimateRackCost(null, energy), null);
});

test("zero fixed fee needs no allocation and zero tax remains valid", async () => {
  const { estimateRackCost } = await import("../public/rack-energy.js");
  assert.equal(estimateRackCost(100, { ...energy, rate: 0.1, taxRate: 0, fixedMonthly: 0, houseTodayKwh: 0 }), 10);
});


test("rack renderer allocates the taxed total across the five outlets and remainder", async () => {
  const { estimateRackCost } = await import("../public/rack-energy.js");
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const render = source.slice(source.indexOf("function renderRackPower("), source.indexOf("\nfunction renderPbsVault("));
  const text: Record<string, string> = {};
  const list = { innerHTML: "" };
  runInNewContext(`${render}; renderRackPower(panel, energyPanel);`, {
    estimateRackCost,
    panel: { status: "ok", data: {
      currentWatts: 1000, rolling24hAverageWatts: 1000, rolling24hSampleMinutes: 1440,
      capacityWatts: 1875, meteredOutlets: 6,
      outlets: [400, 200, 150, 100, 100, 50].map((watts, index) => ({ name: `Outlet ${index}`, index, watts })),
    } },
    energyPanel: { data: { ...energy, rate: 0.1, taxRate: 0.1, fixedMonthly: 100, serverTodayKwh: 5, houseTodayKwh: 20 } },
    setPanelState() {},
    setText: (id: string, value: string) => { text[id] = value; },
    number: (value: number, digits = 0) => value.toFixed(digits),
    money: (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" }),
    moneyRate: (value: number) => `$${value.toFixed(4)}`,
    escapeHtml: String,
    document: { querySelector: (id: string) => id === "#rack-load-list" ? list : null },
  });
  // 720 kWh at $0.10 plus $25 fixed, both taxed 10% = $106.70.
  assert.equal(text["#rack-power-cost"], "$106.70");
  assert.equal(text["#rack-power-kwh"], "720.0 kWh");
  assert.deepEqual([...list.innerHTML.matchAll(/class="rack-load-est">([^<]+)/g)].map((match) => match[1]),
    ["$42.68", "$21.34", "$16.01", "$10.67", "$10.67", "$5.34"]);
});
