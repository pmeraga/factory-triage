import test from "node:test";
import assert from "node:assert/strict";
import {
  pacificDay,
  pacificInput,
  fromPacificInput,
  formatPacific,
  pacificHourBounds,
} from "../src/time.mjs";

test("Pacific calendar boundaries and seasonal labels follow Los Angeles", () => {
  assert.equal(pacificDay("2026-08-14T02:00:00Z"), "2026-08-13");
  assert.equal(pacificInput("2026-08-13T23:06:33Z"), "2026-08-13T16:06");
  assert.match(formatPacific("2026-08-13T23:06:33Z", true), /PDT/);
  assert.match(formatPacific("2026-11-15T02:30:00Z", true), /PST/);
  assert.match(formatPacific("2026-08-13"), /Aug 13/);
});
test("Pacific date controls round-trip summer and winter timestamps", () => {
  assert.equal(
    fromPacificInput("2026-08-13T16:06"),
    "2026-08-13T23:06:00.000Z",
  );
  assert.equal(
    fromPacificInput("2026-11-14T18:30"),
    "2026-11-15T02:30:00.000Z",
  );
  assert.equal(fromPacificInput("2026-08-13"), "2026-08-13T07:00:00.000Z");
  assert.equal(
    fromPacificInput("2026-03-08T00:00"),
    "2026-03-08T08:00:00.000Z",
  );
});
test("invalid dates and nonexistent daylight-saving wall times are rejected", () => {
  for (const value of [
    "2026-02-30",
    "2026-13-01",
    "2026-07-04T25:00",
    "not-a-date",
    "2026-03-08T02:30",
  ]) {
    assert.throws(() => fromPacificInput(value), value);
  }
});
test("Pacific heatmap hour bounds include both fall-back occurrences", () => {
  assert.deepEqual(pacificHourBounds("2026-11-01", 1), {
    from: "2026-11-01T08:00:00.000Z",
    to: "2026-11-01T09:59:59.999Z",
  });
  assert.deepEqual(pacificHourBounds("2026-11-01", 0), {
    from: "2026-11-01T07:00:00.000Z",
    to: "2026-11-01T07:59:59.999Z",
  });
  assert.deepEqual(pacificHourBounds("2026-11-01", 2), {
    from: "2026-11-01T10:00:00.000Z",
    to: "2026-11-01T10:59:59.999Z",
  });
});
test("Pacific hour bounds handle spring-forward gaps and midnight rollover", () => {
  assert.deepEqual(pacificHourBounds("2026-03-08", 1), {
    from: "2026-03-08T09:00:00.000Z",
    to: "2026-03-08T09:59:59.999Z",
  });
  assert.throws(
    () => pacificHourBounds("2026-03-08", 2),
    /daylight saving time/,
  );
  assert.deepEqual(pacificHourBounds("2026-08-13", 23), {
    from: "2026-08-14T06:00:00.000Z",
    to: "2026-08-14T06:59:59.999Z",
  });
  for (const [day, hour] of [
    ["2026-02-30", 1],
    ["not-a-day", 1],
    ["2026-07-01", 24],
    ["2026-07-01", -1],
    ["2026-07-01", 1.5],
  ]) {
    assert.throws(() => pacificHourBounds(day, hour));
  }
});
