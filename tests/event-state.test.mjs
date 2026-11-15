import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_VIEW_KEYS,
  normalizeEventViewState,
  eventParameters,
  eventExportParameters,
  eventBucketBounds,
} from "../src/event-state.mjs";
import { buildDataset } from "../src/domain.mjs";
import { eventsFor, eventsForExport } from "../src/telemetry.mjs";

test("shared event state round-trips every filter and selected record without mutation", () => {
  const initial = {
    eType: "cycle_completed",
    eSearch: "pressure & temperature / naïve",
    eConflict: "true",
    eSort: "quantity_desc",
    eSize: "100",
    eFrom: "2026-07-01T00:30:00-07:00",
    eTo: "2026-07-01T01:59:59-07:00",
    event: "evt_005087",
  };
  const before = structuredClone(initial);
  const state = normalizeEventViewState(initial);
  const savedURL = new URLSearchParams(state).toString();
  const restored = normalizeEventViewState(
    Object.fromEntries(new URLSearchParams(savedURL)),
  );
  assert.deepEqual(restored, state);
  assert.deepEqual(initial, before);
  assert.equal(restored.eSearch, initial.eSearch);
  assert.equal(restored.event, "evt_005087");
  assert.equal(restored.eFrom, "2026-07-01T07:30:00.000Z");
  assert.equal(restored.eTo, "2026-07-01T08:59:59.000Z");
  assert.deepEqual(Object.keys(restored).sort(), [...EVENT_VIEW_KEYS].sort());
  assert.deepEqual(
    normalizeEventViewState({ ...restored, eSearch: "different" }),
    { ...state, eSearch: "different" },
  );
  assert.deepEqual(
    normalizeEventViewState(Object.fromEntries(new URLSearchParams(savedURL))),
    state,
    "back navigation restores the saved filters",
  );
});

test("invalid URL windows and unsupported controls fall back without inventing calendar dates", () => {
  for (const window of [
    { eFrom: "2026-02-30T00:00:00Z", eTo: "2026-03-05T00:00:00Z" },
    { eFrom: "2026-07-02T00:00:00Z", eTo: "2026-07-01T00:00:00Z" },
    { eFrom: "2026-07-01", eTo: "2026-07-02" },
    { eFrom: "2026-07-01T00:00:00Z" },
  ]) {
    const state = normalizeEventViewState({
      ...window,
      eSize: "9000",
      eSort: "unknown",
      event: "evt_still_selected",
    });
    assert.equal(state.eFrom, "");
    assert.equal(state.eTo, "");
    assert.equal(state.eSize, "50");
    assert.equal(state.eSort, "timestamp_desc");
    assert.equal(
      state.event,
      "evt_still_selected",
      "an invalid local window must not erase the requested evidence record",
    );
  }
});

test("bucket focus clips partial edge buckets and honors the 25-hour Pacific fallback day", () => {
  const data = {
    window: { from: "2026-11-01T08:30:00Z", to: "2026-11-03T09:10:00Z" },
    series: [
      { timestamp: "2026-11-01T07:00:00Z" },
      { timestamp: "2026-11-02T08:00:00Z" },
      { timestamp: "2026-11-03T08:00:00Z" },
    ],
  };
  assert.deepEqual(eventBucketBounds(data, 0), {
    from: "2026-11-01T08:30:00.000Z",
    to: "2026-11-02T07:59:59.999Z",
  });
  assert.deepEqual(eventBucketBounds(data, 1), {
    from: "2026-11-02T08:00:00.000Z",
    to: "2026-11-03T07:59:59.999Z",
  });
  assert.deepEqual(eventBucketBounds(data, 2), {
    from: "2026-11-03T08:00:00.000Z",
    to: "2026-11-03T09:10:00.000Z",
  });
  assert.equal(eventBucketBounds(data, -1), null);
  assert.equal(eventBucketBounds({ ...data, series: [] }, 0), null);
});

test("focused replay, the paginated event table, and CSV export use exactly the same cohort", () => {
  const base = {
    job_id: "job_a",
    part_id: "part_a",
    customer_id: "cust_a",
    material: "test",
    machine_id: "press_01",
    quantity: 2,
    metadata: { facility: "la_01" },
  };
  const dataset = buildDataset([
    {
      ...base,
      event_id: "created",
      event_type: "job_created",
      timestamp: "2026-07-01T07:30:00Z",
    },
    {
      ...base,
      event_id: "first",
      event_type: "cycle_completed",
      timestamp: "2026-07-01T07:40:00Z",
    },
    {
      ...base,
      event_id: "middle",
      event_type: "cycle_completed",
      timestamp: "2026-07-01T08:00:00Z",
    },
    {
      ...base,
      event_id: "last",
      event_type: "cycle_completed",
      timestamp: "2026-07-01T08:50:00Z",
    },
    {
      ...base,
      event_id: "future",
      event_type: "cycle_completed",
      timestamp: "2026-07-01T09:20:00Z",
    },
  ]);
  const globals =
    "asOf=2026-07-01T09%3A20%3A00Z&material=test&eventSearch=stale&eSearch=unused";
  const state = {
    eType: "cycle_completed",
    eFrom: "2026-07-01T07:30:00Z",
    eTo: "2026-07-01T08:59:59.999Z",
    eSort: "timestamp_asc",
    eSize: "25",
    event: "middle",
  };
  const query = eventParameters(globals, state, 500);
  assert.equal(
    query.get("asOf"),
    query.get("to"),
    "focusing a bar must replace the global replay time too",
  );
  assert.equal(
    query.get("eventSearch"),
    null,
    "empty restored search clears a stale API search",
  );
  for (const key of EVENT_VIEW_KEYS)
    assert.equal(
      query.get(key),
      null,
      "URL-only keys do not enter the API query",
    );
  const table = eventsFor(dataset, query);
  assert.equal(table.page, 1, "the backend clamps an out-of-range page");
  assert.equal(table.total, 3);
  const exportedQuery = eventExportParameters(query);
  assert.equal(exportedQuery.has("page"), false);
  assert.equal(exportedQuery.has("pageSize"), false);
  const exported = eventsForExport(dataset, exportedQuery);
  assert.deepEqual(
    exported.map((event) => event.event_id),
    table.items.map((event) => event.event_id),
  );
  assert.ok(!exported.some((event) => event.event_id === "future"));
  assert.equal(
    eventsFor(dataset, eventParameters(globals, { eType: "cycle_completed" }))
      .total,
    4,
    "clearing local focus restores the global replay window",
  );
});
