import {
  agreedCycleDuration,
  buildDatasetFromEvents,
  filterJobs,
  overviewFor,
  summarizeJobs,
} from "./domain.mjs";
import {
  DISPLAY_TIME_ZONE,
  pacificDay,
  fromPacificInput,
  formatPacific,
} from "./time.mjs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_SAMPLES = 1500;
export class QueryError extends Error {
  constructor(message) {
    super(message);
    this.name = "QueryError";
  }
}
const sourceCaches = new WeakMap();
const searchCache = new WeakMap();
const calendarCache = new WeakMap();
const wallClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const get = (params, key) =>
  String(
    typeof params?.get === "function"
      ? (params.get(key) ?? "")
      : (params?.[key] ?? ""),
  ).trim();
const epoch = (value) => Date.parse(value);
const compare = (a, b) =>
  epoch(a.timestamp) - epoch(b.timestamp) ||
  a.event_id.localeCompare(b.event_id);
const within = (event, window) =>
  epoch(event.timestamp) >= epoch(window.from) &&
  epoch(event.timestamp) <= epoch(window.to);
const knownType = (event, type) =>
  event.event_type === type &&
  (!event.conflict ||
    event.variants?.every((variant) => variant.event_type === type));
const knownQuantity = (event) =>
  finite(event.quantity) ? event.quantity : null;
const machineKey = (event) => event.machine_id ?? "unassigned";
const sum = (values) =>
  values.reduce((total, value) => total + (finite(value) ? value : 0), 0);

function calendarFor(event) {
  let result = calendarCache.get(event);
  if (!result) {
    const parts = Object.fromEntries(
      wallClock
        .formatToParts(new Date(event.timestamp))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    result = {
      day: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number(parts.hour),
    };
    calendarCache.set(event, result);
  }
  return result;
}

/** Linear interpolation over all observations; samples are only for rendering. */
export function percentile(values, fraction) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position),
    high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function parseInstant(value, name) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/i.exec(
      value,
    );
  if (!match || !Number.isFinite(epoch(value)))
    throw new QueryError(
      `${name} must be a valid ISO date and time with a timezone, for example 2026-07-20T18:00:00Z.`,
    );
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map((part) => Number(part ?? 0));
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new QueryError(`${name} contains an invalid calendar date or time.`);
  }
  return epoch(value);
}

function sourceFor(fullDataset) {
  let source = sourceCaches.get(fullDataset);
  if (!source) {
    const events = Object.values(fullDataset.eventsByJob).flat().sort(compare);
    source = {
      events,
      snapshots: new Map(),
      start: fullDataset.periodStart,
      end: fullDataset.asOf,
    };
    sourceCaches.set(fullDataset, source);
  }
  return source;
}

/** Remove future variants as well as future representative events in replay. */
function eventAt(event, asOf) {
  if (!event.conflict) return epoch(event.timestamp) <= asOf ? event : null;
  const all = event.variants ?? [];
  const indices = all
    .map((_, index) => index)
    .filter((index) => epoch(all[index].timestamp) <= asOf);
  if (!indices.length) return null;
  if (indices.length === all.length) return event;
  const variants = indices.map((index) => all[index]);
  const lineGroups =
    event.variantSourceLineNumbers ??
    all.map((_, index) => [event.sourceLineNumbers?.[index]].filter(Boolean));
  const sourceLineNumbers = indices
    .flatMap((index) => lineGroups[index] ?? [])
    .sort((a, b) => a - b);
  const projected = {
    ...variants[0],
    metadata: { ...(variants[0].metadata ?? {}) },
    sourceLineNumbers,
    exactDuplicateCount: Math.max(
      0,
      sourceLineNumbers.length - variants.length,
    ),
  };
  if (variants.length > 1) {
    projected.conflict = true;
    projected.quantity = null;
    projected.variants = variants;
    projected.variantSourceLineNumbers = indices.map(
      (index) => lineGroups[index] ?? [],
    );
  }
  return projected;
}

export function resolveContext(fullDataset, params = new URLSearchParams()) {
  const source = sourceFor(fullDataset);
  const fromInput = get(params, "from");
  const asOfInput = get(params, "asOf");
  const toInput = get(params, "to");
  if (!source.events.length) {
    if (fromInput) parseInstant(fromInput, "from");
    if (asOfInput || toInput) parseInstant(asOfInput || toInput, "asOf");
    return {
      dataset: fullDataset,
      window: {
        from: "",
        to: "",
        sourceStart: "",
        sourceEnd: "",
        timezone: DISPLAY_TIME_ZONE,
        isReplay: false,
      },
    };
  }
  if (
    asOfInput &&
    toInput &&
    parseInstant(asOfInput, "asOf") !== parseInstant(toInput, "to")
  ) {
    throw new QueryError(
      "asOf and to refer to the same replay time. Supply only one, or give both the same value.",
    );
  }
  const start = epoch(source.start),
    end = epoch(source.end);
  const requestedTo = asOfInput || toInput;
  const to = Math.min(
    end,
    Math.max(start, requestedTo ? parseInstant(requestedTo, "asOf") : end),
  );
  const from = Math.min(
    end,
    Math.max(start, fromInput ? parseInstant(fromInput, "from") : start),
  );
  if (from > to)
    throw new QueryError(
      "The start of the analysis window must be at or before its replay time.",
    );
  const toString =
    to === end
      ? source.end
      : to === start
        ? source.start
        : new Date(to).toISOString();
  const fromString =
    from === start
      ? source.start
      : from === end
        ? source.end
        : new Date(from).toISOString();
  let snapshot = to === end ? fullDataset : source.snapshots.get(to);
  if (!snapshot) {
    const events = source.events
      .map((event) => eventAt(event, to))
      .filter(Boolean);
    snapshot = buildDatasetFromEvents(events, {
      asOf: toString,
      periodStart: source.start,
    });
    source.snapshots.set(to, snapshot);
    if (source.snapshots.size > 8)
      source.snapshots.delete(source.snapshots.keys().next().value);
  }
  const jobs = snapshot.jobs.filter(
    (job) =>
      epoch(job.createdAt) <= to &&
      (!job.completedAt || epoch(job.completedAt) >= from),
  );
  const ids = new Set(jobs.map((job) => job.id));
  const dataset = {
    ...snapshot,
    asOf: toString,
    periodStart: fromString,
    jobs,
    eventsByJob: Object.fromEntries(
      Object.entries(snapshot.eventsByJob).filter(([id]) => ids.has(id)),
    ),
    blockIntervalsByJob: Object.fromEntries(
      Object.entries(snapshot.blockIntervalsByJob).filter(([id]) =>
        ids.has(id),
      ),
    ),
    stats: summarizeJobs(jobs),
  };
  // Keep every public projection coherent with the active-window cohort,
  // while retaining its earlier supporting events for lifecycle reconstruction.
  Object.assign(dataset, overviewFor(dataset, new URLSearchParams()));
  return {
    dataset,
    window: {
      from: fromString,
      to: toString,
      sourceStart: source.start,
      sourceEnd: source.end,
      timezone: DISPLAY_TIME_ZONE,
      isReplay: to < end,
    },
  };
}

function selectedJobs(dataset, params) {
  const jobId = get(params, "job") || get(params, "jobId");
  return filterJobs(dataset.jobs, params).filter(
    (job) => !jobId || job.id === jobId,
  );
}

export function overviewForContext(
  fullDataset,
  params = new URLSearchParams(),
) {
  const { dataset, window } = resolveContext(fullDataset, params);
  const selected = selectedJobs(dataset, params);
  const overview = overviewFor(
    { ...dataset, jobs: selected },
    new URLSearchParams(),
  );
  const windowEventCount = cohortEvents(dataset, window, params).events.length;
  return { ...overview, window, windowEventCount };
}

function cohortEvents(dataset, window, params) {
  const jobs = selectedJobs(dataset, params);
  const machine = get(params, "machine");
  const events = jobs
    .flatMap((job) => dataset.eventsByJob[job.id] ?? [])
    .filter(
      (event) =>
        within(event, window) &&
        (!machine || machine === "all" || machineKey(event) === machine),
    );
  events.sort(compare);
  return { jobs, events };
}

function bucketPlan(window) {
  if (!window.from || !window.to) return { keys: [], key: () => "" };
  const hourly = epoch(window.to) - epoch(window.from) <= 72 * HOUR;
  if (hourly) {
    const keys = [];
    for (
      let time = Math.floor(epoch(window.from) / HOUR) * HOUR;
      time <= epoch(window.to);
      time += HOUR
    )
      keys.push(new Date(time).toISOString());
    return {
      keys,
      key: (event) =>
        new Date(
          Math.floor(epoch(event.timestamp) / HOUR) * HOUR,
        ).toISOString(),
    };
  }
  const keys = [];
  const first = epoch(pacificDay(window.from) + "T00:00:00Z");
  const last = epoch(pacificDay(window.to) + "T00:00:00Z");
  const dayStarts = new Map();
  for (let day = first; day <= last; day += DAY) {
    const date = new Date(day).toISOString().slice(0, 10);
    const start = fromPacificInput(date + "T00:00");
    keys.push(start);
    dayStarts.set(date, start);
  }
  return { keys, key: (event) => dayStarts.get(calendarFor(event).day) };
}

function signalSeries(events, plan) {
  const buckets = new Map(
    plan.keys.map((timestamp) => [
      timestamp,
      {
        timestamp,
        events: 0,
        cycles: 0,
        reportedUnits: 0,
        good: 0,
        scrap: 0,
        durations: [],
      },
    ]),
  );
  for (const event of events) {
    const key = plan.key(event);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.events++;
    if (knownType(event, "cycle_completed")) {
      bucket.cycles++;
      bucket.reportedUnits += knownQuantity(event) ?? 0;
      const seconds = agreedCycleDuration(event);
      if (seconds !== null) bucket.durations.push(seconds);
    }
    if (knownType(event, "job_completed") && !event.conflict) {
      bucket.good += finite(event.metadata.good_quantity)
        ? event.metadata.good_quantity
        : 0;
      bucket.scrap += finite(event.metadata.scrap_quantity)
        ? event.metadata.scrap_quantity
        : 0;
    }
  }
  return [...buckets.values()].map(({ durations, ...bucket }) => ({
    ...bucket,
    p50CycleSeconds: percentile(durations, 0.5),
    p90CycleSeconds: percentile(durations, 0.9),
  }));
}

function clippedBlockHours(intervals, window) {
  return sum(
    intervals.map((interval) =>
      Math.max(
        0,
        (Math.min(epoch(interval.end ?? window.to), epoch(window.to)) -
          Math.max(epoch(interval.start), epoch(window.from))) /
          HOUR,
      ),
    ),
  );
}

function signalsFor(jobs, events, dataset, window) {
  const signals = [];
  for (const event of events) {
    if (knownType(event, "sensor_glitch"))
      signals.push({
        id: `glitch:${event.event_id}`,
        kind: "sensor_glitch",
        severity: "warning",
        timestamp: event.timestamp,
        jobId: event.job_id,
        machineId: event.machine_id,
        eventId: event.event_id,
        title: "Recorded sensor glitch",
        detail: `The source records a ${event.metadata?.signal ?? "sensor"} signal glitch. No continuous sensor readings are available.`,
      });
    if (
      event.conflict &&
      event.variants?.some(
        (variant) => variant.quantity !== event.variants[0].quantity,
      )
    )
      signals.push({
        id: `quantity:${event.event_id}`,
        kind: "quantity_conflict",
        severity: "warning",
        timestamp: event.timestamp,
        jobId: event.job_id,
        machineId: event.machine_id,
        eventId: event.event_id,
        title: "Conflicting reported quantities",
        detail: `Source variants disagree (${event.variants.map((variant) => variant.quantity).join(" / ")}). Quantity remains unresolved and is excluded from reported-unit totals.`,
      });
  }
  for (const job of jobs) {
    if (
      job.qualityMismatch &&
      job.completedAt &&
      epoch(job.completedAt) >= epoch(window.from)
    ) {
      const completion = (dataset.eventsByJob[job.id] ?? []).findLast(
        (event) => event.event_type === "job_completed" && !event.conflict,
      );
      signals.push({
        id: `quality:${job.id}`,
        kind: "quality_mismatch",
        severity: "warning",
        timestamp: job.completedAt,
        jobId: job.id,
        machineId: completion?.machine_id ?? null,
        eventId: completion?.event_id,
        title: "Inspection and completion disagree",
        detail: `Inspections report ${job.inspectionPassed} passed / ${job.inspectionFailed} failed; completion reports ${job.goodQuantity} good / ${job.scrapQuantity} scrap.`,
      });
    }
    if (job.blocked) {
      const interval = (dataset.blockIntervalsByJob[job.id] ?? []).findLast(
        (interval) => interval.end === null,
      );
      const blockEvent = (dataset.eventsByJob[job.id] ?? []).find(
        (event) => event.event_id === interval?.eventId,
      );
      signals.push({
        id: `block:${job.id}`,
        kind: "unresolved_block",
        severity: job.overdue ? "critical" : "warning",
        timestamp: window.to,
        jobId: job.id,
        machineId: blockEvent?.machine_id ?? null,
        eventId: interval?.eventId,
        title: "Recorded block remains unresolved",
        detail: `${(job.blockReason ?? "Unspecified reason").replaceAll("_", " ")}; blocked since ${formatPacific(job.blockedSince, true)}. No unblock or terminal completion is recorded by this snapshot.`,
      });
    }
  }
  return signals.sort(
    (a, b) =>
      epoch(b.timestamp) - epoch(a.timestamp) || a.id.localeCompare(b.id),
  );
}

export function telemetryFor(fullDataset, params = new URLSearchParams()) {
  const { dataset, window } = resolveContext(fullDataset, params);
  const { jobs, events } = cohortEvents(dataset, window, params);
  const plan = bucketPlan(window);
  const cycles = events.filter((event) => knownType(event, "cycle_completed"));
  const durations = cycles.map(agreedCycleDuration).filter(finite);
  const samples = cycles
    .map((event) => ({ event, seconds: agreedCycleDuration(event) }))
    .filter((item) => item.seconds !== null);
  const sampleCount = Math.min(MAX_SAMPLES, samples.length);
  const sampled = Array.from(
    { length: sampleCount },
    (_, index) =>
      samples[
        sampleCount <= 1
          ? 0
          : Math.round((index * (samples.length - 1)) / (sampleCount - 1))
      ],
  );
  const requestedMachine = get(params, "machine");
  const activeBlockEvents = jobs
    .filter((job) => job.blocked)
    .map((job) => {
      const active = (dataset.blockIntervalsByJob[job.id] ?? []).findLast(
        (interval) => interval.end === null,
      );
      return (dataset.eventsByJob[job.id] ?? []).find(
        (event) => event.event_id === active?.eventId,
      );
    })
    .filter(
      (event) =>
        event &&
        (!requestedMachine ||
          requestedMachine === "all" ||
          machineKey(event) === requestedMachine),
    );
  const machineIds = [
    ...new Set([
      ...events.map(machineKey),
      ...activeBlockEvents.map(machineKey),
    ]),
  ].sort();
  const machines = machineIds.map((id) => {
    const machineEvents = events.filter((event) => machineKey(event) === id);
    const machineCycles = machineEvents.filter((event) =>
      knownType(event, "cycle_completed"),
    );
    const machineDurations = machineCycles
      .map(agreedCycleDuration)
      .filter(finite);
    const machineHistory = jobs
      .flatMap((job) => dataset.eventsByJob[job.id] ?? [])
      .filter((event) => machineKey(event) === id)
      .sort(compare);
    const last = machineHistory.at(-1);
    const blockedJobCount = jobs.filter(
      (job) =>
        job.blocked &&
        (dataset.eventsByJob[job.id] ?? []).some(
          (event) =>
            event.event_id ===
              (dataset.blockIntervalsByJob[job.id] ?? []).findLast(
                (interval) => interval.end === null,
              )?.eventId && machineKey(event) === id,
        ),
    ).length;
    return {
      id,
      kind: id.startsWith("press_")
        ? "press"
        : /^(qc_|inspection_)/.test(id)
          ? "inspection"
          : id.startsWith("tooling_")
            ? "tooling"
            : "other",
      eventCount: machineEvents.length,
      jobCount: new Set([
        ...machineEvents.map((event) => event.job_id),
        ...activeBlockEvents
          .filter((event) => machineKey(event) === id)
          .map((event) => event.job_id),
      ]).size,
      cycleCount: machineCycles.length,
      reportedUnits: sum(machineCycles.map(knownQuantity)),
      unresolvedQuantityEvents: machineCycles.filter(
        (event) => !finite(event.quantity),
      ).length,
      p50CycleSeconds: percentile(machineDurations, 0.5),
      p90CycleSeconds: percentile(machineDurations, 0.9),
      inspectionPassed: sum(
        machineEvents
          .filter((event) => knownType(event, "inspection_passed"))
          .map(knownQuantity),
      ),
      inspectionFailed: sum(
        machineEvents
          .filter((event) => knownType(event, "inspection_failed"))
          .map(knownQuantity),
      ),
      blockedJobCount,
      lastEventAt: last?.timestamp ?? null,
      lastEventType: last?.event_type ?? null,
      activity: signalSeries(machineEvents, plan),
    };
  });
  const signals = signalsFor(jobs, events, dataset, window).filter(
    (signal) =>
      !requestedMachine ||
      requestedMachine === "all" ||
      (signal.machineId ?? "unassigned") === requestedMachine,
  );
  const heatmapMap = new Map();
  for (const event of events) {
    const { day, hour } = calendarFor(event);
    const key = `${day}:${hour}`;
    const item = heatmapMap.get(key) ?? { day, hour, events: 0, cycles: 0 };
    item.events++;
    item.cycles += Number(knownType(event, "cycle_completed"));
    heatmapMap.set(key, item);
  }
  const blocks = jobs
    .map((job) =>
      clippedBlockHours(dataset.blockIntervalsByJob[job.id] ?? [], window),
    )
    .filter((value) => value > 0);
  const lead = jobs.filter((job) => job.completedAt).map((job) => job.ageHours);
  const queues = jobs.map((job) => job.queueHours).filter(finite);
  const stages = [
    {
      key: "not_started",
      label: "Awaiting tooling",
      jobs: jobs.filter(
        (job) =>
          !job.completedAt &&
          !job.blocked &&
          !job.startedAt &&
          !job.toolReadyAt,
      ).length,
    },
    {
      key: "tool_ready",
      label: "Ready to start",
      jobs: jobs.filter(
        (job) =>
          !job.completedAt && !job.blocked && !job.startedAt && job.toolReadyAt,
      ).length,
    },
    {
      key: "in_progress",
      label: "In progress",
      jobs: jobs.filter(
        (job) => !job.completedAt && !job.blocked && job.startedAt,
      ).length,
    },
    {
      key: "blocked",
      label: "Blocked",
      jobs: jobs.filter((job) => job.blocked).length,
    },
    {
      key: "completed",
      label: "Completed",
      jobs: jobs.filter((job) => job.completedAt).length,
    },
  ];
  return {
    window,
    summary: {
      events: events.length,
      cycles: cycles.length,
      reportedUnits: sum(cycles.map(knownQuantity)),
      unresolvedQuantityEvents: cycles.filter(
        (event) => !finite(event.quantity),
      ).length,
      p50CycleSeconds: percentile(durations, 0.5),
      p90CycleSeconds: percentile(durations, 0.9),
      completions: events.filter(
        (event) => knownType(event, "job_completed") && !event.conflict,
      ).length,
      blockedJobs:
        requestedMachine && requestedMachine !== "all"
          ? activeBlockEvents.length
          : jobs.filter((job) => job.blocked).length,
      recordedSignals: signals.length,
    },
    series: signalSeries(events, plan),
    machines,
    cycleSamples: sampled.map(({ event, seconds }) => ({
      eventId: event.event_id,
      jobId: event.job_id,
      machineId: event.machine_id ?? "unassigned",
      partId: event.part_id,
      material: event.material,
      timestamp: event.timestamp,
      seconds,
      quantity: knownQuantity(event),
      conflict: Boolean(event.conflict),
    })),
    cycleSampleTotal: samples.length,
    signals,
    heatmap: [...heatmapMap.values()].sort(
      (a, b) => a.day.localeCompare(b.day) || a.hour - b.hour,
    ),
    flow: {
      stages,
      leadHours: { p50: percentile(lead, 0.5), p90: percentile(lead, 0.9) },
      queueHours: {
        p50: percentile(queues, 0.5),
        p90: percentile(queues, 0.9),
      },
      blockedHours: {
        p50: percentile(blocks, 0.5),
        p90: percentile(blocks, 0.9),
      },
    },
  };
}

function eventSearchText(event) {
  let text = searchCache.get(event);
  if (!text) {
    text = JSON.stringify(event).toLowerCase();
    searchCache.set(event, text);
  }
  return text;
}

function explorerSelection(fullDataset, params) {
  const { dataset, window } = resolveContext(fullDataset, params);
  const { events } = cohortEvents(dataset, window, params);
  const search = get(params, "eventSearch").toLowerCase();
  const conflictsOnly = ["true", "1", "yes"].includes(
    get(params, "conflictsOnly").toLowerCase(),
  );
  const base = events.filter(
    (event) =>
      (!conflictsOnly || event.conflict) &&
      (!search || eventSearchText(event).includes(search)),
  );
  const eventType = get(params, "eventType");
  const items = base.filter(
    (event) =>
      !eventType || eventType === "all" || event.event_type === eventType,
  );
  const sort = get(params, "sort") || "timestamp_desc";
  if (["asc", "timestamp_asc"].includes(sort)) items.sort(compare);
  else if (["desc", "timestamp_desc"].includes(sort))
    items.sort((a, b) => -compare(a, b));
  else if (sort === "type_asc")
    items.sort(
      (a, b) => a.event_type.localeCompare(b.event_type) || -compare(a, b),
    );
  else if (sort === "quantity_desc")
    items.sort(
      (a, b) =>
        (knownQuantity(b) ?? -Infinity) - (knownQuantity(a) ?? -Infinity) ||
        -compare(a, b),
    );
  else
    throw new QueryError(
      "sort must be timestamp_desc, timestamp_asc, type_asc, or quantity_desc.",
    );
  return { window, items, base };
}

export function eventsForExport(fullDataset, params = new URLSearchParams()) {
  return explorerSelection(fullDataset, params).items;
}

export function eventsFor(fullDataset, params = new URLSearchParams()) {
  const { window, items, base } = explorerSelection(fullDataset, params);
  const integer = (key, fallback, max) => {
    const input = get(params, key);
    if (!input) return fallback;
    if (
      !/^\d+$/.test(input) ||
      Number(input) < 1 ||
      !Number.isSafeInteger(Number(input))
    )
      throw new QueryError(`${key} must be a positive integer.`);
    return Math.min(Number(input), max);
  };
  const pageSize = integer("pageSize", 50, 200);
  const requestedPage = integer("page", 1, Number.MAX_SAFE_INTEGER);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requestedPage, pages);
  const typeMap = new Map();
  for (const event of base)
    typeMap.set(event.event_type, (typeMap.get(event.event_type) ?? 0) + 1);
  return {
    window,
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    page,
    pageSize,
    pages,
    eventTypes: [...typeMap]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    series: signalSeries(items, bucketPlan(window)).map((bucket) => ({
      timestamp: bucket.timestamp,
      count: bucket.events,
    })),
  };
}

export function eventFor(fullDataset, eventId, params = new URLSearchParams()) {
  return (
    explorerSelection(fullDataset, params).items.find(
      (event) => event.event_id === eventId,
    ) ?? null
  );
}
