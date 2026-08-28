# Capacity Time-Window Selector Design

## Purpose

Make the capacity-headroom panel useful for both live diagnosis and long-range planning. Operators can inspect one hour, one day, one week, or thirty days of real Netdata history without changing the meaning of the upgrade verdict.

## Data architecture

The Netdata collector owns four independent in-memory histories keyed by `1h`, `1d`, `1w`, and `1m`. Each range is requested directly from Netdata; the browser never derives a short range by filtering the thirty-day display data.

| Key | Requested history | Analysis points | Nominal bucket | Refresh cadence |
| --- | ---: | ---: | ---: | ---: |
| `1h` | 3,600 seconds | 240 | 15 seconds | 45 seconds |
| `1d` | 86,400 seconds | 288 | 5 minutes | 5 minutes |
| `1w` | 604,800 seconds | 336 | 30 minutes | 5 minutes |
| `1m` | 2,592,000 seconds | 1,440 | 30 minutes | 5 minutes |

Normalization is parameterized by the range configuration. It aligns GPU, CPU, RAM, temperature, stream, and video-transcode series at the requested resolution, computes range-local percentile/peak summaries and peak timestamps, and downsamples transmitted display histories to at most 240 points. The downsampler partitions the full analysis series into exactly the allowed number of proportional buckets when necessary, averages utilization and workload-average values, and preserves workload peaks.

Each range refresh is independent and additive. A failure retains the last good cache for that range and never delays or erases the five-second live telemetry. No history is persisted outside process memory.

## Public contract

`plexHost.data.history` becomes a nullable container with:

- `windows`: exact nullable `1h`, `1d`, `1w`, and `1m` histories.
- `upgradePressure30d`: a nullable verdict containing only `pressure` and `constraint` derived from the `1m` history.

Window summaries contain utilization percentiles, memory/temperature peaks, and ISO timestamps for each peak. They do not contain an upgrade verdict, preventing a selected short window from being mistaken for the planning signal. Every window remains bounded to 240 display points by Zod.

## Browser behavior

The panel defaults to `1m`. A `TIME WINDOW` group in the header exposes square `1H`, `1D`, `1W`, and `1M` buttons with `aria-pressed`, native tab focus, and a visible telemetry-teal focus outline. Choosing a button re-renders from the corresponding server-provided history while preserving pointer and left/right-arrow chart inspection.

The selected range controls the chart, workload correlation, summary cards, peak timestamps, tooltips, x-axis labels, coverage text, sample-interval copy, and history-through timestamp. The one-hour x-axis uses clock times at quarter-window positions and ends in `NOW`.

The verdict always reads `UPGRADE PRESSURE · 30D` and uses `upgradePressure30d`, even when a shorter range is visible.

## Visual direction

The control extends the existing industrial telemetry language rather than introducing a new component style:

- Obsidian `#080d10`, graphite `#10181e`, rail `#1b2830`, frost `#e7eff1`, muted steel `#89999f`, and telemetry teal `#63d5c6`.
- DIN Condensed for the panel title, the existing monospace stack for labels, buttons, and data.
- A three-column desktop header: title, compact selector, and verdict. Narrow layouts move the selector to a full-width second row.
- Zero border radius and subtle inactive outlines. The selected segment is identified by a teal border, restrained teal wash, and bright text.
- The segmented control is the signature element; no extra ornament or animation is added.

The approved reference is `/Users/ryan/.codex/generated_images/01a0468d-aad8-7d90-8cb7-7aa2cdba165b/exec-77ab8d94-92b5-4af2-a646-df7ed543ec13.png`.

## Verification

Collector tests prove range-specific Netdata query parameters, independent refresh cadence, workload correlation, bounded output, last-good behavior, and non-blocking live collection. Contract tests prove all four required keys and the 240-point ceiling. Static-server tests cover accessible selector markup and the explicit thirty-day verdict label. TypeScript build, browser syntax checks, the full Node suite, and desktop/narrow demo screenshots complete verification. No deployment is part of this work.
