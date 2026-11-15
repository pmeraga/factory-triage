import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDataset } from "../src/domain.mjs";
import {
  QueryError,
  resolveContext,
  overviewForContext,
  telemetryFor,
  eventsFor,
  eventFor,
  eventsForExport,
} from "../src/telemetry.mjs";

const params = (values) => new URLSearchParams(values);
const row = (
  id,
  type,
  time,
  {
    job = "job_a",
    machine = "press_01",
    quantity = 0,
    metadata = {},
    customer = "customer_a",
  } = {},
) => ({
  event_id: id,
  event_type: type,
  timestamp: `2026-07-01T${time}:00Z`,
  job_id: job,
  part_id: "part_1",
  customer_id: customer,
  machine_id: machine,
  material: "test_material",
  quantity,
  metadata: { facility: "la_01", ...metadata },
});
const fixture = [
  row("a-created", "job_created", "06:30", {
    machine: null,
    quantity: 10,
    metadata: { target_due_at: "2026-07-01T08:00:00Z", target_quantity: 10 },
  }),
  row("a-ready", "tool_ready", "06:45", { machine: "tooling_01" }),
  row("a-started", "job_started", "07:00"),
  row("a-cycle-1", "cycle_completed", "07:15", {
    quantity: 4,
    metadata: { cycle_time_seconds: 600 },
  }),
  row("a-cycle-conflict", "cycle_completed", "07:45", {
    quantity: 5,
    metadata: { cycle_time_seconds: 900 },
  }),
  row("a-cycle-conflict", "cycle_completed", "07:45", {
    quantity: 6,
    metadata: { cycle_time_seconds: 900 },
  }),
  row("a-blocked", "job_blocked", "08:00", {
    metadata: { reason: "machine_fault" },
  }),
  row("b-created", "job_created", "09:00", {
    job: "job_b",
    machine: null,
    customer: "customer_b",
    metadata: { target_due_at: "2026-07-03T08:00:00Z" },
  }),
  row("a-cycle-2", "cycle_completed", "10:00", {
    quantity: 3,
    metadata: { cycle_time_seconds: 1200 },
  }),
  row("a-pass", "inspection_passed", "10:15", {
    machine: "qc_01",
    quantity: 9,
  }),
  row("a-fail", "inspection_failed", "10:30", {
    machine: "qc_01",
    quantity: 1,
    metadata: { defect_code: "voids" },
  }),
  row("a-completed", "job_completed", "11:00", {
    machine: null,
    quantity: 10,
    metadata: { good_quantity: 9, scrap_quantity: 1 },
  }),
  row("b-started", "job_started", "12:00", {
    job: "job_b",
    machine: "press_02",
    customer: "customer_b",
  }),
  row("b-cycle", "cycle_completed", "13:00", {
    job: "job_b",
    machine: "press_02",
    customer: "customer_b",
    quantity: 20,
    metadata: { cycle_time_seconds: 800 },
  }),
  row("b-glitch", "sensor_glitch", "14:00", {
    job: "job_b",
    machine: "press_02",
    customer: "customer_b",
    metadata: { signal: "pressure" },
  }),
];
const dataset = buildDataset(fixture);

test("replay uses the exact requested clock, reconstructs blocks, and leaks no future jobs or events", () => {
  const query = params({ asOf: "2026-07-01T08:30:00Z" });
  const { dataset: snapshot, window } = resolveContext(dataset, query);
  assert.equal(window.to, "2026-07-01T08:30:00.000Z");
  assert.equal(snapshot.asOf, window.to);
  assert.equal(window.isReplay, true);
  assert.equal(window.timezone, "America/Los_Angeles");
  assert.deepEqual(
    snapshot.jobs.map((job) => job.id),
    ["job_a"],
  );
  assert.equal(snapshot.jobs[0].blockedHours, 0.5);
  assert.equal(snapshot.jobs[0].overdueHours, 0.5);
  assert.equal(snapshot.jobs[0].completedAt, null);
  assert.ok(!snapshot.filters.customers.includes("customer_b"));
  const events = eventsForExport(dataset, query);
  assert.ok(
    events.every(
      (event) => Date.parse(event.timestamp) <= Date.parse(window.to),
    ),
  );
  assert.equal(eventFor(dataset, "a-completed", query), null);
  const replayedConflict = eventFor(dataset, "a-cycle-conflict", query);
  assert.equal(replayedConflict.quantity, null);
  assert.equal(replayedConflict.variants.length, 2);
  assert.equal(replayedConflict.sourceLineNumbers.length, 2);
});

test("active window cohorts retain quiet ongoing blockers and clip recorded block time", () => {
  const query = params({
    from: "2026-07-01T08:15:00Z",
    to: "2026-07-01T08:30:00Z",
  });
  const overview = overviewForContext(dataset, query);
  assert.equal(overview.stats.jobs, 1);
  assert.equal(overview.stats.blockedOpen, 1);
  assert.equal(overview.windowEventCount, 0);
  assert.equal(overview.jobs[0].blockedHours, 0.5);
  assert.equal(overview.blockReasons[0].totalHours, 0.25);
  const telemetry = telemetryFor(dataset, query);
  assert.equal(telemetry.summary.events, 0);
  assert.equal(telemetry.summary.blockedJobs, 1);
  assert.equal(
    telemetry.machines.find((machine) => machine.id === "press_01")
      .blockedJobCount,
    1,
  );
  assert.equal(telemetry.machines[0].eventCount, 0);
  assert.equal(telemetry.signals[0].kind, "unresolved_block");
  assert.equal(telemetry.signals[0].timestamp, overview.window.to);
  assert.match(telemetry.signals[0].detail, /Jul 1, 2026.*01:00 AM PDT/);
  assert.doesNotMatch(telemetry.signals[0].detail, /2026-07-01T08:00:00Z/);
  assert.equal(overview.jobs[0].blockedSince, "2026-07-01T08:00:00Z");
  assert.equal(telemetry.flow.blockedHours.p50, 0.25);
  assert.equal(eventsFor(dataset, query).total, 0);
  const afterCompletion = overviewForContext(
    dataset,
    params({ from: "2026-07-01T12:00:00Z" }),
  );
  assert.deepEqual(
    afterCompletion.jobs.map((job) => job.id),
    ["job_b"],
  );
  const inclusiveCompletion = overviewForContext(
    dataset,
    params({ from: "2026-07-01T11:00:00Z" }),
  );
  assert.ok(inclusiveCompletion.jobs.some((job) => job.id === "job_a"));
});

test("cycle metrics use every known unique duration and never sum unresolved quantities", () => {
  const result = telemetryFor(dataset);
  assert.equal(result.summary.cycles, 4);
  assert.equal(result.summary.reportedUnits, 27);
  assert.equal(result.summary.unresolvedQuantityEvents, 1);
  assert.equal(result.summary.p50CycleSeconds, 850);
  assert.equal(result.summary.p90CycleSeconds, 1110);
  assert.equal(result.cycleSampleTotal, 4);
  assert.equal(
    result.cycleSamples.find((sample) => sample.eventId === "a-cycle-conflict")
      .quantity,
    null,
  );
  const press = result.machines.find((machine) => machine.id === "press_01");
  assert.equal(press.kind, "press");
  assert.equal(press.cycleCount, 3);
  assert.equal(press.reportedUnits, 7);
  assert.equal(press.p50CycleSeconds, 900);
  assert.equal(press.p90CycleSeconds, 1140);
  assert.equal(
    result.series.reduce((total, bucket) => total + bucket.cycles, 0),
    4,
  );
  assert.equal(
    result.series.reduce((total, bucket) => total + bucket.reportedUnits, 0),
    27,
  );
  assert.equal(
    result.flow.stages.reduce((total, stage) => total + stage.jobs, 0),
    2,
  );
  assert.equal(result.flow.leadHours.p50, 4.5);
  assert.equal(result.flow.queueHours.p50, 0.25);
  assert.ok(
    result.signals.every((signal) =>
      [
        "sensor_glitch",
        "quantity_conflict",
        "quality_mismatch",
        "unresolved_block",
      ].includes(signal.kind),
    ),
  );
  const machineScoped = telemetryFor(dataset, params({ machine: "press_02" }));
  assert.deepEqual(
    machineScoped.machines.map((machine) => machine.id),
    ["press_02"],
  );
  assert.equal(machineScoped.summary.cycles, 1);
  assert.equal(machineScoped.summary.reportedUnits, 20);
  const machineOverview = overviewForContext(
    dataset,
    params({ machine: "press_01" }),
  );
  assert.equal(machineOverview.windowEventCount, 5);
  assert.equal(
    machineOverview.windowEventCount,
    eventsFor(dataset, params({ machine: "press_01" })).total,
  );
  assert.ok(
    machineOverview.dataQuality.uniqueEvents > machineOverview.windowEventCount,
  );
  const unassigned = telemetryFor(dataset, params({ machine: "unassigned" }));
  assert.deepEqual(
    unassigned.machines.map((machine) => machine.id),
    ["unassigned"],
  );
  assert.equal(unassigned.summary.events, 3);
  assert.equal(unassigned.summary.completions, 1);
});

test("machine-scoped signals follow original machine evidence while flow keeps the associated job cohort", () => {
  const tooling = telemetryFor(
    dataset,
    params({ machine: "tooling_01", asOf: "2026-07-01T08:30:00Z" }),
  );
  assert.equal(tooling.summary.blockedJobs, 0);
  assert.deepEqual(tooling.signals, []);
  assert.equal(
    tooling.flow.stages.find((stage) => stage.key === "blocked").jobs,
    1,
  );
  const nullRecords = buildDataset([
    row("created-open", "job_created", "06:00", { machine: null }),
    row("blocked-open", "job_blocked", "07:00", {
      machine: null,
      metadata: { reason: "missing_tool" },
    }),
    row("created-done", "job_created", "06:30", {
      job: "job_b",
      machine: null,
    }),
    row("inspected-done", "inspection_passed", "07:30", {
      job: "job_b",
      machine: "qc_01",
      quantity: 1,
    }),
    row("completed-done", "job_completed", "08:00", {
      job: "job_b",
      machine: null,
      quantity: 2,
      metadata: { good_quantity: 2, scrap_quantity: 0 },
    }),
  ]);
  const unassigned = telemetryFor(
    nullRecords,
    params({ machine: "unassigned" }),
  );
  assert.equal(unassigned.summary.blockedJobs, 1);
  assert.equal(unassigned.signals.length, 2);
  assert.ok(unassigned.signals.every((signal) => signal.machineId === null));
  assert.ok(
    unassigned.signals.some((signal) => signal.kind === "unresolved_block"),
  );
  assert.ok(
    unassigned.signals.some((signal) => signal.kind === "quality_mismatch"),
  );
});

test("Pacific day and hour buckets place midnight boundaries correctly", () => {
  const result = telemetryFor(dataset);
  const priorDay = result.heatmap.find(
    (bucket) => bucket.day === "2026-06-30" && bucket.hour === 23,
  );
  const nextDay = result.heatmap.find(
    (bucket) => bucket.day === "2026-07-01" && bucket.hour === 0,
  );
  assert.equal(priorDay.events, 2);
  assert.equal(nextDay.cycles, 2);
  const edge = buildDataset([
    row("before-created", "job_created", "06:00", { job: "before" }),
    row("after-created", "job_created", "06:01", { job: "after" }),
    row("before-done", "job_completed", "06:59", {
      job: "before",
      quantity: 1,
      metadata: { good_quantity: 1, scrap_quantity: 0 },
    }),
    row("after-done", "job_completed", "07:00", {
      job: "after",
      quantity: 1,
      metadata: { good_quantity: 1, scrap_quantity: 0 },
    }),
  ]);
  assert.deepEqual(
    edge.trends.map((day) => [day.date, day.completed]),
    [
      ["2026-06-30", 1],
      ["2026-07-01", 1],
    ],
  );
});

test("daily buckets follow Pacific daylight-saving boundaries rather than fixed 24-hour offsets", () => {
  const base = row("created", "job_created", "06:00");
  const source = buildDataset([
    { ...base, timestamp: "2026-10-31T07:00:00Z" },
    {
      ...base,
      event_id: "first-one-thirty",
      event_type: "cycle_completed",
      timestamp: "2026-11-01T08:30:00Z",
      quantity: 1,
      metadata: { cycle_time_seconds: 600 },
    },
    {
      ...base,
      event_id: "second-one-thirty",
      event_type: "cycle_completed",
      timestamp: "2026-11-01T09:30:00Z",
      quantity: 1,
      metadata: { cycle_time_seconds: 800 },
    },
    {
      ...base,
      event_id: "last",
      event_type: "maintenance_ping",
      timestamp: "2026-11-03T12:00:00Z",
    },
  ]);
  const result = telemetryFor(source);
  const novemberFirst = result.series.find(
    (bucket) => bucket.timestamp === "2026-11-01T07:00:00.000Z",
  );
  const novemberSecond = result.series.find(
    (bucket) => bucket.timestamp === "2026-11-02T08:00:00.000Z",
  );
  assert.equal(novemberFirst.cycles, 2);
  assert.equal(
    Date.parse(novemberSecond.timestamp) - Date.parse(novemberFirst.timestamp),
    25 * 3_600_000,
  );
  assert.equal(
    result.heatmap.find(
      (bucket) => bucket.day === "2026-11-01" && bucket.hour === 1,
    ).cycles,
    2,
  );
  assert.equal(
    result.series.reduce((total, bucket) => total + bucket.events, 0),
    4,
  );
});

test("explorer pagination, facets, event search, sorting, and export share the same cohort", () => {
  const query = params({
    search: "job_a",
    eventSearch: "cycle",
    page: "2",
    pageSize: "2",
    sort: "timestamp_asc",
  });
  const page = eventsFor(dataset, query);
  assert.equal(page.total, 3);
  assert.equal(page.page, 2);
  assert.equal(page.pages, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].event_id, "a-cycle-2");
  const exported = eventsForExport(dataset, query);
  assert.equal(exported.length, 3);
  assert.equal(exported[0].event_id, "a-cycle-1");
  const typeScoped = eventsFor(
    dataset,
    params({ search: "job_a", eventType: "job_created" }),
  );
  assert.equal(typeScoped.total, 1);
  assert.ok(
    typeScoped.eventTypes.some(
      (facet) => facet.type === "cycle_completed" && facet.count === 3,
    ),
  );
  const conflicts = eventsFor(dataset, params({ conflictsOnly: "true" }));
  assert.equal(conflicts.total, 1);
  assert.equal(conflicts.items[0].quantity, null);
  const quantitySorted = eventsForExport(
    dataset,
    params({ eventType: "cycle_completed", sort: "quantity_desc" }),
  );
  assert.equal(quantitySorted[0].quantity, 20);
  assert.equal(quantitySorted.at(-1).quantity, null);
  assert.equal(eventsFor(dataset, params({ pageSize: "999" })).pageSize, 200);
  assert.equal(eventsFor(dataset, params({ page: "999" })).page, 1);
  assert.throws(
    () => eventsFor(dataset, params({ page: "0" })),
    (error) =>
      error instanceof QueryError && /positive integer/.test(error.message),
  );
  assert.throws(
    () => eventsFor(dataset, params({ pageSize: "1.5" })),
    /positive integer/,
  );
});

test("time filters validate, clamp to source, and never disclose future conflict variants", () => {
  const clamped = resolveContext(
    dataset,
    params({ from: "2025-01-01T00:00:00Z", asOf: "2027-01-01T00:00:00Z" }),
  );
  assert.equal(clamped.window.from, dataset.periodStart);
  assert.equal(clamped.window.to, dataset.asOf);
  assert.equal(clamped.window.isReplay, false);
  assert.throws(
    () => resolveContext(dataset, params({ from: "garbage" })),
    /valid ISO/,
  );
  assert.throws(
    () => resolveContext(dataset, params({ from: "2026-02-30T00:00:00Z" })),
    /invalid calendar/,
  );
  assert.throws(
    () =>
      resolveContext(
        dataset,
        params({ from: "2026-07-01T12:00:00Z", to: "2026-07-01T10:00:00Z" }),
      ),
    /at or before/,
  );
  assert.throws(
    () =>
      resolveContext(
        dataset,
        params({ asOf: "2026-07-01T12:00:00Z", to: "2026-07-01T10:00:00Z" }),
      ),
    /same replay time/,
  );
  const crossTime = buildDataset([
    row("created", "job_created", "06:00"),
    row("conflict", "cycle_completed", "07:00", {
      quantity: 4,
      metadata: { cycle_time_seconds: 600 },
    }),
    row("conflict", "cycle_completed", "07:00", {
      quantity: 4,
      metadata: { cycle_time_seconds: 600 },
    }),
    row("conflict", "cycle_completed", "09:00", {
      quantity: 5,
      metadata: { cycle_time_seconds: 600 },
    }),
  ]);
  assert.equal(crossTime.asOf, "2026-07-01T09:00:00Z");
  const past = eventFor(
    crossTime,
    "conflict",
    params({ asOf: "2026-07-01T08:00:00Z" }),
  );
  assert.equal(past.quantity, 4);
  assert.equal(past.conflict, undefined);
  assert.equal(past.variants, undefined);
  assert.deepEqual(past.sourceLineNumbers, [2, 3]);
  assert.equal(past.exactDuplicateCount, 1);
  const full = eventFor(crossTime, "conflict");
  assert.equal(full.quantity, null);
  assert.equal(full.variants.length, 2);
  assert.equal(full.sourceLineNumbers.length, 3);
});

test("real-data telemetry reconciles exact event counts with bounded rendering samples", () => {
  const rows = readFileSync(
    new URL("../data/manufacturing_events.jsonl", import.meta.url),
    "utf8",
  )
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const actual = buildDataset(rows);
  const result = telemetryFor(actual);
  assert.equal(result.summary.events, 19500);
  assert.equal(result.summary.cycles, 12949);
  assert.equal(result.summary.unresolvedQuantityEvents, 5);
  assert.equal(result.summary.reportedUnits, 126122);
  assert.equal(result.summary.completions, 281);
  assert.equal(result.summary.blockedJobs, 9);
  assert.equal(result.cycleSampleTotal, 12949);
  assert.equal(result.cycleSamples.length, 1500);
  assert.equal(
    new Set(result.cycleSamples.map((sample) => sample.eventId)).size,
    1500,
  );
  assert.equal(
    result.machines.reduce((total, machine) => total + machine.cycleCount, 0),
    result.summary.cycles,
  );
  assert.equal(
    result.series.reduce((total, bucket) => total + bucket.events, 0),
    19500,
  );
  assert.equal(eventsFor(actual).total, 19500);
  assert.equal(eventsFor(actual).items.length, 50);
  const pressQuery = params({ machine: "press_03" });
  assert.equal(overviewForContext(actual, pressQuery).windowEventCount, 2669);
  assert.equal(
    overviewForContext(actual, pressQuery).windowEventCount,
    eventsFor(actual, pressQuery).total,
  );
  const context = resolveContext(
    actual,
    params({ asOf: "2026-07-20T12:00:00Z" }),
  );
  assert.ok(
    context.dataset.jobs.every(
      (job) => Date.parse(job.createdAt) <= Date.parse(context.window.to),
    ),
  );
  assert.ok(
    Object.values(context.dataset.eventsByJob)
      .flat()
      .every(
        (event) => Date.parse(event.timestamp) <= Date.parse(context.window.to),
      ),
  );
});
