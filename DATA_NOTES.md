# Data and metric notes

## Source, display time, and replay

`data/manufacturing_events.jsonl` is the unchanged synthetic source: **19,519 rows**, **19,500 unique event IDs**, **312 jobs**, and **14 event types**. Source timestamps span **2026-07-03 13:41:56 UTC** to **2026-08-13 23:06:33 UTC**, or **July 3, 2026, 6:41:56 AM PDT** to **August 13, 2026, 4:06:33 PM PDT**.

The application displays dates, date inputs, time buckets, and heatmap hours in **America/Los_Angeles**, with the appropriate PDT/PST offset. Original JSON retains its source ISO timestamps, including `Z`. CSV exports include original timestamps and Pacific display columns.

The default cursor is the source end. Earlier replay cursors reconstruct jobs using only events and conflict variants observed by that instant. Due status, open-job age, unresolved blocks, and detail views use the selected cursor rather than the viewer's current clock. Unchanged minute-resolution inputs preserve the source timestamp's seconds. Day stepping follows Pacific calendar days.

A historical extract cannot establish whether an unfinished job remained unfinished after its final source observation.

## Two complementary scopes

The analysis window is inclusive: `from` through `asOf`. A job belongs to its active cohort when it was created by the cursor and is still open, or its recorded completion is on or after `from`. Jobs that began earlier remain visible when active in the window.

- **Job summaries, quality checks, and evidence** retain the selected cohort's earlier supporting events through the cursor. These counts are not window-only event totals. Job lead, queue, and comparison timing describe observed job lifetimes through the cursor.
- **Telemetry, cycle observations, and event feeds** count records inside the selected window. Time buckets are hourly for windows up to 72 hours and Pacific calendar days for longer windows.
- **Overview** summaries and telemetry include every status in the global search/dimension scope; its status tabs filter the queue and job CSV. **Jobs** summaries follow the selected status. **Quality** includes every status in scope. Watchlist filtering applies to the local job list and its watchlist export.

Customer, material, and facility filters select jobs. A machine filter selects jobs with that machine association, then limits telemetry/event records to the selected machine. Job outcomes still describe the whole job; its entire lead time or loss is not attributed to that machine.

**Unassigned records** groups null `machine_id` values, including expected creation/completion records and some cycles. It is not a physical asset and can associate with many jobs. Asset “last observed” timestamps may precede the window when an unresolved block retains an asset association.

Invalid time formats or reversed windows return a readable API error; valid out-of-range boundaries clamp to source coverage. Shared links preserve analysis context. Browser pins and saved-view names are local; comparisons are temporary and clear on window changes.

## Normalization and provenance

Ingestion is deterministic. Records are ordered by timestamp with a stable event-ID tie-break; generated projections do not replace the original file.

- **14 exact duplicates:** identical records collapse for calculations. Source line references remain available.
- **5 conflicting IDs:** two `cycle_completed` variants disagree on quantity without revision precedence. One normalized event retains every variant, a conflict flag, and unresolved (`null`) quantity. Neither candidate contributes to reported-unit sums.
- **Known duration despite quantity conflict:** a duration contributes once when all variants agree on event type and `cycle_time_seconds`. Disagreeing, invalid, or missing durations are excluded.
- **Lifecycle transitions:** a cycle, maintenance ping, handoff, or inspection does not itself clear a block.
- **Missing fields:** preserve available metadata and show unavailable values without inventing replacements. A dash means unavailable, not zero.

Conflicting IDs: `evt_005087`, `evt_009610`, `evt_009935`, `evt_014575`, and `evt_014986`. Replays exclude future variants and their provenance.

## Jobs and delivery

| Measure         | Definition                                                                  |
| --------------- | --------------------------------------------------------------------------- |
| Completed       | An observed `job_completed` event by the cursor                             |
| Open            | A created job without an observed completion by the cursor                  |
| Overdue open    | Open, with `target_due_at` strictly before the cursor                       |
| Late completion | Completion strictly after its target due timestamp                          |
| On-time rate    | Completed jobs on/before due divided by completed jobs with a due timestamp |
| Job age / lead  | Creation to completion; creation to cursor for an open job                  |
| Queue time      | Tool-ready timestamp to observed start, when both exist                     |
| Cycle duration  | Recorded `metadata.cycle_time_seconds`, distinct from job wall-clock lead   |

At the full source end: **281 completed**, **31 open**, **26 overdue open**, and **75 late completed** jobs. Open jobs include 10 without a start and 21 with a start but no completion. No eligible completions produces an unavailable on-time rate, not zero.

The state distribution is exclusive: awaiting tooling, ready to start, in progress, blocked, completed. Each job appears once. These are recorded lifecycle states, not independently verified factory conditions.

Default urgency sorts overdue work first, then other blocked jobs, other open jobs, and completed jobs. Priority, elapsed overdue/block/age measures, and stable job ID break ties. Other sorts support due date, age, total recorded blocked time, cycle median, and customer; unknown values sort last.

## Blocks and waiting

A `job_blocked` opens an interval and its `job_unblocked` closes it. An unmatched interval remains visibly unresolved and runs to the replay cursor for calculation. A terminal completion closes a remaining interval. Later cycle records alone do not unblock it.

The full source has **9 open jobs with unresolved blocks**, including 5 labeled `missing_tool`. All 59 recorded unblock events have preceding blocks.

Job details and comparisons report lifetime recorded block hours through the cursor. Telemetry's **Blocks within window** clips intervals to the analysis window, then computes P50/P90 across jobs with positive overlap. Lead-time percentiles use completed jobs; queue percentiles use jobs with known queue time.

Block hours measure recorded waiting, not machine downtime. Concurrent jobs can accumulate more waiting hours than elapsed calendar hours. Reasons are recorded labels, not proof of every delay's cause.

## Telemetry, charts, and signals

Cycle counts use unique recorded cycle events. Reported units sum their known quantities; unresolved quantities remain excluded and are counted separately. P50/P90 use linear interpolation over every qualifying known duration in scope.

Cycle plots contain at most **1,500 evenly selected observations across the scoped chronology**; their captions disclose sampling. Aggregate percentiles use all qualifying observations. A selected machine's plotted subset can therefore contain fewer points than its recorded cycle total. A line between aggregate time buckets is not a continuous sensor measurement.

The default review threshold is the selected machine's descriptive P90. Changing it highlights displayed observations for review; it is not a validated process limit, forecast, or automated failure diagnosis. Drag zoom changes the displayed chart range. Heatmap selection applies a global Pacific-hour analysis window.

Recorded signals cover explicit sensor-glitch events, unresolved quantity conflicts, inspection/completion mismatches, and unresolved blocks. Blocks remain relevant at the cursor even when their opening event predates the window. A signal-free selection does not certify machine health.

## Quantities and quality

`quantity` has event-specific meaning: an order target, reported cycle amount, inspected batch, or completion summary. Adding these streams together would double-count production.

Completed-job production uses `job_completed.metadata.good_quantity` and `scrap_quantity`:

```text
scrap rate = sum(completion scrap)
             / sum(completion good + completion scrap)
```

At the full source end, completion summaries report **78,555 good units** and **7,613 scrap units**: approximately **8.84%** scrap. Each completion's good plus scrap equals its stated quantity.

Inspection passed/failed sums disagree with completion summaries on **13 of 281 completed jobs**. Both observations remain visible. Failed-inspection defect totals sum recorded quantities by defect code; they are not guaranteed unique defective parts or an independently attributable scrap total. Reinspection coverage and batch relationships are unspecified.

## Reproducibility and limits

The repository includes source data, transformations, definitions, tests, and deployment configuration. Generated outputs are excluded. The public read-only API exposes normalized synthetic evidence; source files and the server bundle are not downloadable static assets. CSV cells escape formula prefixes, and watchlist export includes every matching pinned job across pages.

The source lacks a production calendar, ideal cycle standard, continuous sensor stream, complete inventory, verified revenue model, and conflict-revision precedence. The application does not calculate OEE, utilization, financial savings, predicted completion dates, or causal diagnoses. Comparisons describe observations and do not establish why jobs differ.
