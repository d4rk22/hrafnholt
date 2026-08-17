import { powerDataSchema, type PanelData } from "../contracts/dashboard.js";
import { boundedText, fetchJson, finiteNumber, type Collector, type JsonRequest } from "./collector.js";

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function normalizeMovers(input: unknown): { windowMinutes: number; circuits: unknown[] } {
  const movers = record(input);
  const windowMinutes = Math.min(1_440, Math.max(0, Math.trunc(finiteNumber(movers.window_minutes))));
  const circuits = (Array.isArray(movers.circuits) ? movers.circuits : [])
    .slice(0, 5)
    .map((entry) => {
      const circuit = record(entry);
      return {
        name: boundedText(circuit.name ?? "", 40),
        watts: Math.max(0, finiteNumber(circuit.w)),
        deltaWatts: finiteNumber(circuit.delta_w),
      };
    })
    .filter((circuit) => circuit.name.length > 0 && circuit.deltaWatts !== 0);
  return { windowMinutes, circuits };
}

export function normalizeEmporia(input: unknown): PanelData<"power"> {
  const data = record(input);
  const movers = normalizeMovers(data.movers);
  return powerDataSchema.parse({
    serverWatts: finiteNumber(data.server_w),
    acWatts: finiteNumber(data.ac_w),
    houseWatts: finiteNumber(data.house_w),
    totalWatts: finiteNumber(data.total_w),
    serverTodayKwh: finiteNumber(data.server_today),
    acTodayKwh: finiteNumber(data.ac_today),
    todayKwh: finiteNumber(data.total_today),
    houseTodayKwh: finiteNumber(data.house_today),
    serverMonthKwh: finiteNumber(data.server_month),
    acMonthKwh: finiteNumber(data.ac_month),
    monthKwh: finiteNumber(data.total_month),
    houseMonthKwh: finiteNumber(data.house_month),
    projectedKwh: finiteNumber(data.projected_kwh),
    projectedHouseKwh: finiteNumber(data.house_projected_kwh),
    monthCost: finiteNumber(data.month_cost),
    projectedCost: finiteNumber(data.projected_cost),
    projectedHouseCost: finiteNumber(data.house_projected_cost),
    rate: finiteNumber(data.rate),
    rateLabel: boundedText(data.rate_label ?? "unknown", 80),
    daysInMonth: Math.min(31, Math.max(28, Math.trunc(finiteNumber(data.days_in_month, 30)))),
    serverPercentOfHouse: Math.min(100, Math.max(0, finiteNumber(data.pct_of_house))),
    moversWindowMinutes: movers.windowMinutes,
    movers: movers.circuits,
  });
}

export function createEmporiaCollector(
  baseUrl: string,
  enabled: boolean,
  request: JsonRequest = fetchJson,
  allowInsecureTls = false,
): Collector<"power"> {
  return {
    name: "Emporia energy sidecar",
    panel: "power",
    source: "Emporia Vue",
    intervalMs: 60_000,
    staleAfterMs: 180_000,
    timeoutMs: 10_000,
    required: true,
    enabled,
    schema: powerDataSchema,
    collect: async ({ signal }) => normalizeEmporia(await request(
      new URL("/energy", baseUrl).toString(),
      { signal, headers: { accept: "application/json" } },
      allowInsecureTls,
    )),
  };
}
