# Data and metric notes

## Source and clock

`data/manufacturing_events.jsonl` is the unchanged source log. It contains 19,519 rows, 19,500 distinct event IDs, 312 job IDs, and 14 event types. Recorded event times range from **2026-07-03 13:41:56 UTC** to **2026-08-13 23:06:33 UTC**.

The latest timestamp is the application’s fixed snapshot clock. Open-job age, overdue status, and unresolved block duration use that clock, not the viewer’s current date. Timestamps are stored as UTC. A historical snapshot cannot establish whether an uncompleted job remained unfinished after the extract ended.

## Normalization and provenance

Ingestion is deterministic and can be rerun from the committed source file. Events are ordered by timestamp with a stable event-ID tie-break. The generated dataset is a build artifact, not a replacement for the source.

- **14 exact duplicate rows:** collapse identical records for calculation, retaining the original file for audit.
- **5 conflicting event IDs:** each identifies two `cycle_completed` variants with different quantities and no revision marker. The normalized event retains its variants, is marked as conflicting, and has unresolved (`null`) quantity. Neither candidate is silently selected for production-quantity totals.
- **Lifecycle events:** job state comes from meaningful transitions. A maintenance ping, handoff, inspection, or cycle after a block does not itself clear the block.
- **Unknown metadata:** preserve available event metadata for the evidence view. Missing fields do not acquire invented values.

Conflicting IDs: `evt_005087`, `evt_009610`, `evt_009935`, `evt_014575`, and `evt_014986`.

## Job and delivery definitions

| Measure | Definition |
| --- | --- |
| Completed job | A job with an observed `job_completed` event |
| Open job | A created job without an observed completion event |
| Overdue open job | An open job whose recorded `target_due_at` precedes the snapshot clock |
| Late completion | Completion timestamp strictly after its recorded target due timestamp |
| On-time rate | Completed jobs finishing on or before their due timestamps divided by completed jobs with a due timestamp |
| Job age | Creation to completion, or creation to the snapshot clock for an open job |
| Queue time | Creation to observed job start, where both events exist |
| Cycle duration | Recorded `metadata.cycle_time_seconds`; a cycle duration is distinct from a job’s wall-clock lead time |

The initial whole-dataset cohort has **281 completed jobs**, **31 open jobs**, **26 overdue open jobs**, and **75 late completed jobs**. The 31 open jobs comprise 10 without a start event and 21 with an observed start but no completion. Counts describe recorded events, not an independently verified physical factory state.

Filtering changes the selected job cohort. A machine filter selects jobs with an event on that machine; job-level outcomes still describe the whole selected job. It does not attribute a job’s entire loss or lead time to that machine. A filtered percentage must retain its matching denominator; a cohort without eligible completions has an unavailable rate rather than a zero rate.

## Blocks and waiting

A `job_blocked` event opens an interval; its matching `job_unblocked` closes it. An unmatched interval ends provisionally at the snapshot clock for duration calculation and remains visibly unresolved. Completed jobs are terminal. Recorded block reasons describe reported conditions and are not a causal analysis of every delay.

There are **9 open jobs with unresolved block events**. Five have reason `missing_tool`. All 59 observed unblock events have preceding blocks in this dataset. Some blocked jobs have later cycle or other events, which is why simply checking the final event type gives the wrong count.

Block hours are elapsed recorded time, not measured machine downtime. Aggregating job waiting hours may exceed elapsed calendar time because multiple jobs can wait concurrently. No production calendar or ideal cycle standard is supplied, so the product does not calculate utilization or OEE.

## Quantities and quality

Event `quantity` has different meanings by event type. Created quantity is an order target; cycle quantity is a reported cycle amount; inspection quantity is a tested batch; completion quantity is a finished-job summary. Adding them together would double-count production.

For completed-job quality, the chosen source is `job_completed.metadata.good_quantity` and `scrap_quantity`:

```text
scrap rate = sum(completion scrap quantity)
             / sum(completion good quantity + completion scrap quantity)
```

The whole dataset reports **78,555 good units** and **7,613 scrap units**, giving a completion-summary scrap rate of approximately **8.84%**. Every completion summary’s good plus scrap quantity equals that completion’s stated quantity.

Inspection observations are a separate evidence stream. Their good/failed quantity sums disagree with completion summaries on **13 of 281 completed jobs**. The product flags these differences rather than rewriting either record. A quantity-weighted inspection failure share is not necessarily a final scrap rate: inspection coverage, repeat inspection, and batch relationships are not fully specified.

Defect totals sum quantities on failed-inspection records by recorded defect code. They describe observed failed-unit quantities; they are not proof of unique defective parts or independently attributed scrap. Counting failed inspection events would be especially misleading here because failed batches are much smaller than passed batches.

## Reproducibility and limits

Source data, transformation code, metric definitions, tests, and deployment metadata are committed. Credentials and generated build outputs are excluded. The API serves normalized records behind authentication, and the UI links aggregate flags back to job-level evidence.

The synthetic snapshot does not provide a production schedule, ideal cycle standard, complete inventory, validated revenue model, or explicit revision precedence for conflicts. The application therefore offers recorded exceptions and comparisons without forecasts, estimated savings, or implied real-time status.
