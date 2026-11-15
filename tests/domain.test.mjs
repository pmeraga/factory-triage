import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildDataset,
  normalizeEvents,
  filterJobs,
  overviewFor,
} from "../src/domain.mjs";

const raw = readFileSync(
  new URL("../data/manufacturing_events.jsonl", import.meta.url),
  "utf8",
)
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));
const dataset = buildDataset(raw);
const event = (id, type, time, quantity = 0, metadata = {}, job = "test") => ({
  event_id: id,
  event_type: type,
  timestamp: `2026-01-01T${time}:00Z`,
  job_id: job,
  part_id: "part",
  customer_id: "customer",
  machine_id: null,
  material: "material",
  quantity,
  metadata: { facility: "test_facility", ...metadata },
});

test("real dataset reconciles source rows without silently resolving conflicts", () => {
  assert.equal(dataset.dataQuality.rawEvents, 19519);
  assert.equal(dataset.dataQuality.uniqueEvents, 19500);
  assert.equal(dataset.dataQuality.exactDuplicates, 14);
  assert.equal(dataset.dataQuality.conflictingIds.length, 5);
  assert.equal(dataset.asOf, "2026-08-13T23:06:33Z");
  assert.equal(dataset.jobs.length, 312);
  assert.equal(dataset.stats.completed, 281);
  assert.equal(dataset.stats.open, 31);
  assert.equal(dataset.stats.overdueOpen, 26);
  assert.equal(dataset.stats.blockedOpen, 9);
  assert.equal(dataset.stats.lateCompleted, 75);
  assert.equal(dataset.stats.totalGood, 78555);
  assert.equal(dataset.stats.totalScrap, 7613);
  assert.equal(dataset.stats.qualityMismatchJobs, 13);
  assert.equal(
    dataset.jobs.find((job) => job.id === "job_0166").cycleSecondsMedian,
    1543,
  );
  const conflict = Object.values(dataset.eventsByJob)
    .flat()
    .find((item) => item.event_id === "evt_005087");
  assert.equal(conflict.quantity, null);
  assert.deepEqual(
    conflict.variants.map((item) => item.quantity),
    [5, 4],
  );
});

test("normalization is deterministic, preserves inputs, and recognizes key-order duplicates", () => {
  const first = event("a", "cycle_completed", "01:00", 4);
  const duplicate = Object.fromEntries(Object.entries(first).reverse());
  const conflict = { ...first, quantity: 5 };
  const original = JSON.stringify(first);
  const result = normalizeEvents([first, duplicate, conflict]);
  assert.equal(result.events.length, 1);
  assert.equal(result.exactDuplicates, 1);
  assert.equal(result.events[0].quantity, null);
  assert.deepEqual(result.events[0].sourceLineNumbers, [1, 2, 3]);
  assert.equal(JSON.stringify(first), original);
  assert.equal(
    JSON.stringify(result),
    JSON.stringify(normalizeEvents([first, duplicate, conflict])),
  );
});

test("cycle duration survives quantity conflicts only when every variant agrees", () => {
  const rows = [
    event("created", "job_created", "00:00", 10),
    event("quantity-conflict", "cycle_completed", "01:00", 4, {
      cycle_time_seconds: 600,
    }),
    event("quantity-conflict", "cycle_completed", "01:00", 5, {
      cycle_time_seconds: 600,
    }),
    event("duration-conflict", "cycle_completed", "02:00", 4, {
      cycle_time_seconds: 900,
    }),
    event("duration-conflict", "cycle_completed", "02:00", 4, {
      cycle_time_seconds: 1200,
    }),
    event("type-conflict", "cycle_completed", "03:00", 4, {
      cycle_time_seconds: 1500,
    }),
    event("type-conflict", "sensor_glitch", "03:00", 4, {
      cycle_time_seconds: 1500,
    }),
    event("missing-duration", "cycle_completed", "04:00", 4),
    event("missing-duration", "cycle_completed", "04:00", 4, {
      cycle_time_seconds: 1800,
    }),
    event("trusted-cycle", "cycle_completed", "05:00", 4, {
      cycle_time_seconds: 1200,
    }),
  ];
  const result = buildDataset(rows);
  // Exactly one 600-second observation and one 1200-second observation qualify.
  assert.equal(result.jobs[0].cycleSecondsMedian, 900);
  const quantityConflict = result.eventsByJob.test.find(
    (item) => item.event_id === "quantity-conflict",
  );
  assert.equal(quantityConflict.quantity, null);
  assert.deepEqual(
    quantityConflict.variants.map((item) => item.quantity),
    [4, 5],
  );
  assert.equal(result.dataQuality.conflictingIds.length, 4);
});

test("block state follows lifecycle pairs rather than the latest arbitrary event", () => {
  const rows = [
    event("a", "job_created", "00:00", 10, {
      target_due_at: "2026-01-01T02:00:00Z",
      target_quantity: 10,
    }),
    event("b", "job_started", "01:00"),
    event("c", "job_blocked", "02:00", 0, { reason: "missing_tool" }),
    event("d", "cycle_completed", "03:00", 4, { cycle_time_seconds: 900 }),
  ];
  const result = buildDataset(rows);
  assert.equal(result.jobs[0].status, "blocked");
  assert.equal(result.jobs[0].blockedHours, 1);
  assert.equal(result.jobs[0].overdue, true);
  assert.equal(result.jobs[0].overdueHours, 1);
  assert.equal(result.blockIntervalsByJob.test[0].end, null);
  rows.push(event("e", "job_unblocked", "04:00"));
  const released = buildDataset(rows);
  assert.equal(released.jobs[0].blocked, false);
  assert.equal(released.jobs[0].totalBlockedHours, 2);
  assert.equal(released.jobs[0].status, "in_progress");
});

test("completion is terminal and authoritative quality remains separate from inspections", () => {
  const rows = [
    event("a", "job_created", "00:00", 10, {
      target_due_at: "2026-01-01T05:00:00Z",
    }),
    event("b", "inspection_passed", "01:00", 7),
    event("c", "inspection_failed", "02:00", 1, { defect_code: "voids" }),
    event("d", "job_blocked", "03:00", 0, { reason: "awaiting_qc" }),
    event("e", "job_completed", "04:00", 10, {
      good_quantity: 8,
      scrap_quantity: 2,
    }),
    event("f", "maintenance_ping", "08:00"),
  ];
  const result = buildDataset(rows);
  assert.equal(result.jobs[0].status, "completed");
  assert.equal(result.jobs[0].overdue, false);
  assert.equal(result.jobs[0].late, false);
  assert.equal(result.jobs[0].ageHours, 4);
  assert.equal(result.jobs[0].totalBlockedHours, 1);
  assert.equal(result.stats.totalGood, 8);
  assert.equal(result.stats.totalScrap, 2);
  assert.equal(result.stats.scrapRate, 0.2);
  assert.equal(result.stats.qualityMismatchJobs, 1);
  assert.equal(result.defects[0].quantity, 1);
});

test("every overview aggregation uses the filtered job cohort", () => {
  const params = new URLSearchParams({
    customer: "cust_helix",
    status: "completed",
  });
  const result = overviewFor(dataset, params);
  assert.ok(result.jobs.length > 0);
  assert.ok(
    result.jobs.every(
      (job) => job.customerId === "cust_helix" && job.completedAt,
    ),
  );
  assert.equal(result.stats.jobs, result.jobs.length);
  assert.equal(result.stats.open, 0);
  assert.equal(
    result.trends.reduce((total, day) => total + day.completed, 0),
    result.stats.completed,
  );
  assert.equal(
    result.materials.reduce((total, material) => total + material.good, 0),
    result.stats.totalGood,
  );
  assert.equal(
    result.materials.reduce((total, material) => total + material.scrap, 0),
    result.stats.totalScrap,
  );
  const selectedIds = new Set(result.jobs.map((job) => job.id));
  assert.ok(
    result.dataQuality.issues.every((issue) =>
      issue.jobIds.every((id) => selectedIds.has(id)),
    ),
  );
  assert.equal(
    result.dataQuality.uniqueEvents,
    result.jobs.reduce((total, job) => total + job.eventCount, 0),
  );
  assert.deepEqual(result.filters, dataset.filters);
  assert.ok(
    filterJobs(
      dataset.jobs,
      new URLSearchParams({ status: "blocked", machine: "press_04" }),
    ).every((job) => job.blocked && job.machineIds.includes("press_04")),
  );
});

test("empty cohorts produce honest null rates and zero totals", () => {
  const result = overviewFor(
    dataset,
    new URLSearchParams({ search: "no_such_job_ever" }),
  );
  assert.equal(result.stats.jobs, 0);
  assert.equal(result.stats.scrapRate, null);
  assert.equal(result.stats.onTimeRate, null);
  assert.equal(result.dataQuality.rawEvents, 0);
  assert.deepEqual(result.defects, []);
  assert.deepEqual(buildDataset([]).jobs, []);
});
