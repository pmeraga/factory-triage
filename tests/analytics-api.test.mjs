import test from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/server/index.js";
const get = (path) => worker.fetch(new Request("https://factory.test" + path));

test("public telemetry and event APIs expose consistent scope and pagination", async () => {
  const response = await get("/api/telemetry");
  assert.equal(response.status, 200);
  const telemetry = await response.json();
  assert.equal(telemetry.window.timezone, "America/Los_Angeles");
  assert.equal(telemetry.summary.events, 19500);
  assert.equal(telemetry.summary.cycles, 12949);
  assert.equal(telemetry.summary.unresolvedQuantityEvents, 5);
  assert.equal(
    telemetry.machines.reduce((sum, machine) => sum + machine.eventCount, 0),
    telemetry.summary.events,
  );
  assert.ok(telemetry.cycleSamples.length <= 1500);
  const page = await (
    await get("/api/events?eventType=inspection_failed&page=2&pageSize=25")
  ).json();
  assert.equal(page.page, 2);
  assert.equal(page.items.length, 25);
  assert.ok(
    page.items.every((event) => event.event_type === "inspection_failed"),
  );
  const event = await (
    await get("/api/events/" + page.items[0].event_id)
  ).json();
  assert.equal(event.event.event_id, page.items[0].event_id);
});

test("replayed job APIs stop at the selected clock and do not expose future records", async () => {
  const cursor = "2026-07-06T12:00:00Z";
  const detail = await (
    await get("/api/jobs/job_0080?asOf=" + encodeURIComponent(cursor))
  ).json();
  assert.equal(Date.parse(detail.asOf), Date.parse(cursor));
  assert.equal(detail.job.completedAt, null);
  assert.equal(detail.job.goodQuantity, null);
  assert.ok(
    detail.events.every(
      (event) => Date.parse(event.timestamp) <= Date.parse(cursor),
    ),
  );
  const full = await (await get("/api/overview")).json();
  const future = full.jobs.find(
    (job) => Date.parse(job.createdAt) > Date.parse(cursor),
  );
  assert.ok(future);
  assert.equal(
    (
      await get(
        "/api/jobs/" + future.id + "?asOf=" + encodeURIComponent(cursor),
      )
    ).status,
    404,
  );
});

test("invalid analytics parameters are client errors and CSV preserves unresolved records", async () => {
  for (const path of [
    "/api/telemetry?from=not-a-date",
    "/api/events?page=0",
    "/api/overview?asOf=bad",
    "/api/events/%ZZ",
  ]) {
    assert.equal((await get(path)).status, 400, path);
  }
  const csv = await (await get("/api/events/export?conflictsOnly=true")).text();
  assert.equal(csv.split("\r\n").length, 6);
  assert.match(csv, /timestamp_pacific/);
  assert.match(csv, /quantity_conflict/);
  assert.match(csv, /PDT/);
  const jobCsv = await (await get("/api/export?status=blocked")).text();
  assert.equal(jobCsv.split("\r\n").length, 10);
  assert.match(jobCsv, /"snapshotAt","snapshotAtPacific"/);
  assert.match(jobCsv, /2026-08-13T23:06:33/);
});
