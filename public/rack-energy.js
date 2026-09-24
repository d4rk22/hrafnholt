export function estimateRackCost(estimatedKwh, energy) {
  const nonnegative = (value) => Number.isFinite(value) && value >= 0;
  if (!nonnegative(estimatedKwh) || !energy
    || ![energy.rate, energy.taxRate, energy.fixedMonthly].every(nonnegative)) return null;

  // Match Emporia's Server Room row: today's circuit share of household usage.
  // The energy charge still uses the PDU's rolling 24-hour, 30-day projection.
  let fixedShare = 0;
  if (energy.fixedMonthly > 0) {
    if (!nonnegative(energy.serverTodayKwh) || !nonnegative(energy.houseTodayKwh)
      || energy.houseTodayKwh === 0) return null;
    fixedShare = energy.fixedMonthly * energy.serverTodayKwh / energy.houseTodayKwh;
  }
  return (estimatedKwh * energy.rate + fixedShare) * (1 + energy.taxRate);
}
