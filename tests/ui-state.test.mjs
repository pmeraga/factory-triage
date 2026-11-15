import test from "node:test";
import assert from "node:assert/strict";
import { pacificInput } from "../src/time.mjs";
import {
  preservePacificInput,
  stepPacificDay,
  clampReplayEnd,
  clampSourceInstant,
} from "../src/components/window-state.mjs";
import {
  compareJobs,
  csvCell,
  watchlistCsv,
} from "../src/components/job-view-utils.mjs";

test("unchanged minute inputs retain source seconds and milliseconds", () => {
  const original = "2026-08-14T23:06:33.123Z";
  assert.equal(
    preservePacificInput(pacificInput(original), original),
    original,
  );
  assert.equal(
    preservePacificInput("2026-08-14T15:00", original),
    "2026-08-14T22:00:00.000Z",
  );
});
test("replay calendar day stepping preserves seconds across Pacific DST", () => {
  assert.equal(
    stepPacificDay("2026-03-07T20:30:33.123Z", 1),
    "2026-03-08T19:30:33.123Z",
  );
  assert.equal(
    stepPacificDay("2026-11-01T20:30:33.123Z", -1),
    "2026-10-31T19:30:33.123Z",
  );
});
test("replay preserves the final seconds and clamps only outside source bounds", () => {
  const start = Date.parse("2026-07-01T06:41:56Z"),
    end = Date.parse("2026-08-14T23:06:33Z");
  assert.equal(clampReplayEnd(end - 1000, start, end), end - 1000);
  assert.equal(clampReplayEnd(end - 33_000, start, end), end - 33_000);
  assert.equal(clampReplayEnd(end - 90_000, start, end), end - 90_000);
  assert.equal(clampReplayEnd(end, start, end), end);
  assert.equal(clampReplayEnd(end + 1000, start, end), end);
  assert.equal(clampReplayEnd(start - 1000, start, end), start);
});
test("cycle sort ranks slow observations first and unknown values last", () => {
  const rows = [
    { id: "a", cycleSecondsMedian: null },
    { id: "b", cycleSecondsMedian: 100 },
    { id: "c", cycleSecondsMedian: 500 },
  ];
  assert.deepEqual(
    rows.sort((a, b) => compareJobs(a, b, "cycle")).map((job) => job.id),
    ["c", "b", "a"],
  );
  assert.deepEqual(
    [
      { id: "b", customerId: "same" },
      { id: "a", customerId: "same" },
    ]
      .sort((a, b) => compareJobs(a, b, "customer"))
      .map((job) => job.id),
    ["a", "b"],
  );
});
test("CSV escapes formula prefixes and exports the entire matching watchlist", () => {
  for (const value of [
    "=1+1",
    "+1",
    "-1",
    "@SUM(A1)",
    "\tformula",
    "\rformula",
  ])
    assert.ok(csvCell(value).startsWith("\"'"));
  assert.equal(csvCell('a"b'), '"a""b"');
  const rows = Array.from({ length: 14 }, (_, index) => ({
    id: `job-${index}`,
    createdAt: "2026-08-14T23:06:33Z",
    customerId: "=1+1",
  }));
  const csv = watchlistCsv(rows, "2026-08-14T23:06:33Z");
  assert.equal(csv.split("\r\n").length, 15);
  assert.match(csv, /snapshotAsOfPacific/);
  assert.match(csv, /2026-08-14T23:06:33Z/);
  assert.match(csv, /PDT/);
  assert.ok(csv.includes('"\'=1+1"'));
});

test("window controls match server source bounds without hiding reversed in-range windows", () => {
  const start = "2026-07-03T13:41:56Z",
    end = "2026-08-13T23:06:33Z";
  assert.equal(
    clampSourceInstant("2027-01-01T00:00:00Z", end, start, end),
    "2026-08-13T23:06:33.000Z",
  );
  assert.equal(
    clampSourceInstant("2025-01-01T00:00:00Z", start, start, end),
    "2026-07-03T13:41:56.000Z",
  );
  const later = clampSourceInstant("2026-08-01T18:00:00Z", start, start, end);
  const earlier = clampSourceInstant("2026-07-20T18:00:00Z", end, start, end);
  assert.ok(Date.parse(later) > Date.parse(earlier));
});
