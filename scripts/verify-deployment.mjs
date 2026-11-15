import assert from "node:assert/strict";

const url = process.argv[2];
if (!url)
  throw new Error(
    "Usage: node scripts/verify-deployment.mjs https://your-site.example",
  );
const origin = new URL(url).origin;
const get = (path) =>
  fetch(origin + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
const checks = [];
for (const path of [
  "/",
  "/api/overview",
  "/api/jobs/job_0220",
  "/api/export",
  "/favicon.svg",
  "/api/health",
  "/api/telemetry",
  "/api/events",
  "/api/events/export?conflictsOnly=true",
]) {
  const response = await get(path);
  assert.equal(response.status, 200, `Public route ${path}`);
  assert.equal(response.headers.get("www-authenticate"), null);
  checks.push({ route: path, status: response.status });
}
assert.match(await (await get("/")).text(), /Factory Triage/);
const overview = await (await get("/api/overview")).json();
assert.equal(overview.stats.jobs, 312);
assert.equal(overview.stats.overdueOpen, 26);
assert.equal(overview.stats.blockedOpen, 9);
assert.equal(overview.dataQuality.conflictingIds.length, 5);
const detail = await (await get("/api/jobs/job_0220")).json();
assert.equal(detail.job.blockReason, "missing_tool");
const cycleJob = await (await get("/api/jobs/job_0166")).json();
assert.equal(cycleJob.job.cycleSecondsMedian, 1543);
const timezone = "America/Los_Angeles";
assert.equal(overview.window.timezone, timezone);
async function json(path) {
  const response = await get(path);
  assert.equal(response.status, 200, path);
  assert.equal(response.headers.get("www-authenticate"), null, path);
  assert.equal(response.headers.get("cache-control"), "no-store", path);
  return response.json();
}
const asOf = "2026-07-20T12:34:56Z";
const [
  telemetry,
  events,
  health,
  conflict,
  replay,
  replayEvents,
  replayDetail,
  quiet,
  quietSignals,
  tooling,
] = await Promise.all([
  json("/api/telemetry"),
  json("/api/events"),
  json("/api/health"),
  json("/api/events/evt_005087"),
  json(`/api/overview?asOf=${asOf}`),
  json(`/api/events?asOf=${asOf}&pageSize=200`),
  json(`/api/jobs/job_0220?asOf=${asOf}`),
  json(
    "/api/overview?from=2026-08-13T12:00:00Z&asOf=2026-08-13T13:00:00Z&search=job_0220",
  ),
  json(
    "/api/telemetry?from=2026-08-13T12:00:00Z&asOf=2026-08-13T13:00:00Z&search=job_0220",
  ),
  json("/api/telemetry?machine=tooling_01"),
]);
assert.equal(health.timezone, timezone);
assert.equal(telemetry.window.timezone, timezone);
assert.equal(telemetry.summary.events, 19500);
assert.equal(telemetry.summary.cycles, 12949);
assert.equal(telemetry.summary.reportedUnits, 126122);
assert.equal(telemetry.summary.unresolvedQuantityEvents, 5);
assert.equal(telemetry.summary.completions, 281);
assert.equal(telemetry.summary.blockedJobs, 9);
assert.equal(telemetry.cycleSampleTotal, 12949);
assert.equal(telemetry.cycleSamples.length, 1500);
assert.ok(
  telemetry.summary.p90CycleSeconds >= telemetry.summary.p50CycleSeconds,
);
assert.equal(
  telemetry.machines.reduce((total, machine) => total + machine.cycleCount, 0),
  telemetry.summary.cycles,
);
assert.equal(
  telemetry.series.reduce((total, bucket) => total + bucket.events, 0),
  telemetry.summary.events,
);
assert.equal(
  telemetry.series[0].timestamp,
  "2026-07-03T07:00:00.000Z",
  "Daily buckets start at Pacific midnight",
);
assert.ok(
  telemetry.heatmap.some(
    (cell) => cell.day === "2026-07-03" && cell.hour === 6 && cell.events > 0,
  ),
);
for (const signal of telemetry.signals.filter(
  (signal) => signal.kind === "unresolved_block",
)) {
  assert.match(
    signal.detail,
    /PDT|PST/,
    "Human-readable block time uses Pacific labels",
  );
  assert.doesNotMatch(signal.detail, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
}
assert.equal(events.window.timezone, timezone);
assert.equal(events.total, 19500);
assert.equal(
  overview.windowEventCount,
  events.total,
  "Overview event count matches the strict event window",
);
assert.equal(events.page, 1);
assert.equal(events.pageSize, 50);
assert.equal(events.items.length, 50);
assert.equal(
  events.eventTypes.reduce((total, facet) => total + facet.count, 0),
  19500,
);
assert.equal(conflict.event.quantity, null);
assert.equal(conflict.event.variants.length, 2);
assert.deepEqual(
  conflict.event.variants
    .map((variant) => variant.quantity)
    .sort((a, b) => a - b),
  [4, 5],
);
assert.equal(conflict.event.sourceLineNumbers.length, 2);
assert.equal(Date.parse(replay.window.to), Date.parse(asOf));
assert.equal(replay.window.isReplay, true);
assert.equal(replay.window.sourceEnd, overview.window.sourceEnd);
assert.ok(replay.stats.jobs < overview.stats.jobs);
assert.ok(
  replay.jobs.every(
    (job) =>
      Date.parse(job.createdAt) <= Date.parse(asOf) &&
      (!job.completedAt || Date.parse(job.completedAt) <= Date.parse(asOf)),
  ),
);
assert.ok(
  replayEvents.items.every(
    (event) =>
      Date.parse(event.timestamp) <= Date.parse(asOf) &&
      (event.variants ?? []).every(
        (variant) => Date.parse(variant.timestamp) <= Date.parse(asOf),
      ),
  ),
);
assert.equal(Date.parse(replayDetail.asOf), Date.parse(asOf));
assert.ok(
  replayDetail.events.every(
    (event) => Date.parse(event.timestamp) <= Date.parse(asOf),
  ),
);
const futureJob = overview.jobs.find(
  (job) => Date.parse(job.createdAt) > Date.parse(asOf),
);
assert.ok(futureJob);
assert.equal((await get(`/api/jobs/${futureJob.id}?asOf=${asOf}`)).status, 404);
assert.equal(
  (await get(`/api/events/${events.items[0].event_id}?asOf=${asOf}`)).status,
  404,
);
assert.equal(quiet.jobs.length, 1);
assert.equal(
  quiet.stats.blockedOpen,
  1,
  "A quiet unresolved blocker remains in the active-window cohort",
);
assert.equal(quietSignals.summary.events, 0);
assert.equal(quietSignals.summary.blockedJobs, 1);
assert.equal(tooling.summary.blockedJobs, 0);
assert.ok(tooling.signals.every((signal) => signal.machineId === "tooling_01"));
const conflictCsv = await get("/api/events/export?conflictsOnly=true");
assert.equal(conflictCsv.status, 200);
const conflictCsvText = await conflictCsv.text();
assert.equal(conflictCsvText.split("\r\n").length - 1, 5);
assert.match(conflictCsvText.split("\r\n")[0], /timestamp_pacific/);
const head = await fetch(origin + "/api/telemetry", {
  method: "HEAD",
  redirect: "manual",
  signal: AbortSignal.timeout(30000),
});
assert.equal(head.status, 200);
assert.equal(await head.text(), "");
assert.equal(head.headers.get("www-authenticate"), null);
for (const path of [
  "/api/overview?asOf=invalid",
  "/api/events?page=0",
  "/api/telemetry?from=2026-08-01T00:00:00Z&asOf=2026-07-01T00:00:00Z",
]) {
  assert.equal((await get(path)).status, 400, `Invalid analysis query ${path}`);
}
for (const path of ["/api/jobs/%", "/api/jobs/%ZZ"]) {
  assert.ok(
    [400, 404].includes((await get(path)).status),
    `Malformed job URL ${path}`,
  );
}
const csv = await get("/api/export?status=blocked");
assert.equal(csv.status, 200);
assert.equal((await csv.text()).split("\r\n").length - 1, 9);
for (const path of [
  "/deployment.txt",
  "/dist/server/index.js",
  "/data/manufacturing_events.jsonl",
  "/.generated/data.json",
  "/.git/config",
  "/src/worker.ts",
]) {
  assert.equal((await get(path)).status, 404, `Source file path ${path}`);
}
console.log(
  JSON.stringify(
    {
      url: origin,
      status: "verified",
      access: "public",
      timezone,
      checks,
      blockedCsvJobs: 9,
      conflictCsvEvents: 5,
      replayAsOf: replay.window.to,
      stats: overview.stats,
      telemetry: telemetry.summary,
    },
    null,
    2,
  ),
);
