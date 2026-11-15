/** Deterministic, dependency-free projections of the source event log. */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PRIORITY = { urgent: 0, critical: 0, high: 1, normal: 2, low: 3 };

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const number = (value) => (finite(value) ? value : null);
const timestamp = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const elapsed = (start, end) =>
  timestamp(start) && timestamp(end)
    ? Math.max(0, (Date.parse(end) - Date.parse(start)) / HOUR)
    : 0;
const unique = (values) =>
  [
    ...new Set(
      values.filter(
        (value) => value !== null && value !== undefined && value !== "",
      ),
    ),
  ].sort();
const sum = (values) => values.reduce((a, b) => a + (finite(b) ? b : 0), 0);
const compareEvents = (a, b) =>
  Date.parse(a.timestamp) - Date.parse(b.timestamp) ||
  a.event_id.localeCompare(b.event_id);

/** Exact duplicates are removed; conflicting IDs retain every distinct variant. */
export function normalizeEvents(rawRows) {
  if (!Array.isArray(rawRows))
    throw new TypeError("Expected an array of events");
  const byId = new Map();
  rawRows.forEach((row, index) => {
    if (
      !row ||
      typeof row !== "object" ||
      !row.event_id ||
      !row.job_id ||
      !row.event_type ||
      !timestamp(row.timestamp)
    ) {
      throw new Error(
        `Invalid required event fields at source line ${index + 1}`,
      );
    }
    const group = byId.get(row.event_id) ?? { variants: new Map(), lines: [] };
    const key = stable(row);
    if (!group.variants.has(key)) group.variants.set(key, structuredClone(row));
    group.lines.push(index + 1);
    byId.set(row.event_id, group);
  });
  let exactDuplicates = 0;
  const conflictingIds = [];
  const events = [];
  for (const [id, group] of byId) {
    const variants = [...group.variants.values()];
    const exactDuplicateCount = group.lines.length - variants.length;
    exactDuplicates += exactDuplicateCount;
    const event = {
      ...variants[0],
      metadata: { ...(variants[0].metadata ?? {}) },
      sourceLineNumbers: group.lines,
      exactDuplicateCount,
    };
    if (variants.length > 1) {
      event.conflict = true;
      event.variants = variants;
      // There is no revision marker establishing an authoritative variant.
      event.quantity = null;
      conflictingIds.push(id);
    }
    events.push(event);
  }
  events.sort(compareEvents);
  return {
    events,
    rawEvents: rawRows.length,
    exactDuplicates,
    conflictingIds: conflictingIds.sort(),
  };
}

function median(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function agreedCycleDuration(event) {
  const variants = event.conflict ? (event.variants ?? []) : [event];
  if (!variants.length) return null;
  const duration = variants[0].metadata?.cycle_time_seconds;
  return finite(duration) &&
    variants.every(
      (variant) =>
        variant.event_type === "cycle_completed" &&
        finite(variant.metadata?.cycle_time_seconds) &&
        variant.metadata.cycle_time_seconds === duration,
    )
    ? duration
    : null;
}

function intervalsFor(events, asOf, completedAt) {
  const intervals = [];
  let active = null;
  let unmatchedUnblocks = 0;
  let repeatedBlocks = 0;
  for (const event of events) {
    if (event.conflict) continue;
    if (completedAt && event.timestamp > completedAt) continue;
    if (event.event_type === "job_blocked") {
      if (active) {
        repeatedBlocks++;
        continue;
      }
      active = {
        start: event.timestamp,
        reason: event.metadata.reason ?? "unspecified",
        eventId: event.event_id,
      };
    }
    if (event.event_type === "job_unblocked") {
      if (active) {
        intervals.push({
          ...active,
          end: event.timestamp,
          hours: elapsed(active.start, event.timestamp),
        });
        active = null;
      } else unmatchedUnblocks++;
    }
  }
  if (active) {
    // A terminal completion closes any remaining interval, while retaining its evidence.
    const end = completedAt ?? null;
    intervals.push({
      ...active,
      end,
      hours: elapsed(active.start, end ?? asOf),
    });
  }
  return { intervals, unmatchedUnblocks, repeatedBlocks };
}

function compareJobs(a, b) {
  const rank = (job) =>
    job.overdue ? 0 : job.blocked ? 1 : job.completedAt ? 3 : 2;
  return (
    rank(a) - rank(b) ||
    Number(b.blocked) - Number(a.blocked) ||
    (PRIORITY[a.priority] ?? 2) - (PRIORITY[b.priority] ?? 2) ||
    b.overdueHours - a.overdueHours ||
    b.blockedHours - a.blockedHours ||
    b.ageHours - a.ageHours ||
    a.id.localeCompare(b.id)
  );
}

function jobFromEvents(id, events, asOf) {
  const trusted = events.filter((event) => !event.conflict);
  const find = (type) => trusted.find((event) => event.event_type === type);
  const created = find("job_created") ?? events[0];
  const completed = trusted
    .filter((event) => event.event_type === "job_completed")
    .at(-1);
  const started = find("job_started");
  const ready = find("tool_ready");
  const dueAt = timestamp(created.metadata?.target_due_at)
    ? created.metadata.target_due_at
    : "";
  const { intervals, unmatchedUnblocks, repeatedBlocks } = intervalsFor(
    events,
    asOf,
    completed?.timestamp,
  );
  const activeBlock = !completed
    ? intervals.findLast((interval) => interval.end === null)
    : null;
  const passed = sum(
    trusted
      .filter((event) => event.event_type === "inspection_passed")
      .map((event) => event.quantity),
  );
  const failed = sum(
    trusted
      .filter((event) => event.event_type === "inspection_failed")
      .map((event) => event.quantity),
  );
  const good = completed ? number(completed.metadata?.good_quantity) : null;
  const scrap = completed ? number(completed.metadata?.scrap_quantity) : null;
  const qualityMismatch = Boolean(
    completed &&
      ((good !== null && passed !== good) ||
        (scrap !== null && failed !== scrap)),
  );
  const job = {
    id,
    partId: created.part_id ?? "",
    customerId: created.customer_id ?? "",
    material: created.material ?? "",
    facility: created.metadata?.facility ?? "",
    priority: created.metadata?.priority ?? "normal",
    createdAt: created.timestamp,
    dueAt,
    startedAt: started?.timestamp ?? null,
    toolReadyAt: ready?.timestamp ?? null,
    completedAt: completed?.timestamp ?? null,
    lastEventAt: events.at(-1).timestamp,
    status: completed
      ? "completed"
      : activeBlock
        ? "blocked"
        : started
          ? "in_progress"
          : "not_started",
    overdue: Boolean(!completed && dueAt && dueAt < asOf),
    late: Boolean(completed && dueAt && completed.timestamp > dueAt),
    blocked: Boolean(activeBlock),
    blockReason: activeBlock?.reason ?? null,
    blockedSince: activeBlock?.start ?? null,
    blockedHours: activeBlock?.hours ?? 0,
    totalBlockedHours: sum(intervals.map((interval) => interval.hours)),
    ageHours: elapsed(created.timestamp, completed?.timestamp ?? asOf),
    overdueHours: dueAt ? elapsed(dueAt, completed?.timestamp ?? asOf) : 0,
    targetQuantity:
      number(created.metadata?.target_quantity) ??
      number(created.quantity) ??
      0,
    goodQuantity: good,
    scrapQuantity: scrap,
    machineIds: unique(events.map((event) => event.machine_id)),
    toolId:
      created.metadata?.tool_id ??
      ready?.metadata?.tool_id ??
      started?.metadata?.tool_id ??
      null,
    eventCount: events.length,
    qualityMismatch,
    conflictIds: events
      .filter((event) => event.conflict)
      .map((event) => event.event_id),
    queueHours:
      ready && started ? elapsed(ready.timestamp, started.timestamp) : null,
    // Quantity uncertainty does not invalidate an independently agreed duration.
    // Each normalized event contributes at most one duration, never one per variant.
    cycleSecondsMedian: median(events.map(agreedCycleDuration)),
    inspectionPassed: passed,
    inspectionFailed: failed,
  };
  return { job, intervals, unmatchedUnblocks, repeatedBlocks };
}

export function summarizeJobs(jobs) {
  const completed = jobs.filter((job) => job.completedAt);
  const totalGood = sum(completed.map((job) => job.goodQuantity));
  const totalScrap = sum(completed.map((job) => job.scrapQuantity));
  const lateCompleted = completed.filter((job) => job.late).length;
  const dueKnown = completed.filter((job) => job.dueAt);
  return {
    jobs: jobs.length,
    completed: completed.length,
    open: jobs.length - completed.length,
    overdueOpen: jobs.filter((job) => job.overdue).length,
    blockedOpen: jobs.filter((job) => job.blocked).length,
    lateCompleted,
    totalGood,
    totalScrap,
    scrapRate:
      totalGood + totalScrap > 0 ? totalScrap / (totalGood + totalScrap) : null,
    onTimeRate: dueKnown.length
      ? (dueKnown.length - lateCompleted) / dueKnown.length
      : null,
    qualityMismatchJobs: jobs.filter((job) => job.qualityMismatch).length,
  };
}

export function filterJobs(jobs, params = new URLSearchParams()) {
  const get = (key) =>
    String(
      typeof params.get === "function"
        ? (params.get(key) ?? "")
        : (params[key] ?? ""),
    ).trim();
  const search = (get("search") || get("q")).toLowerCase();
  const customer = get("customer");
  const material = get("material");
  const machine = get("machine");
  const facility = get("facility");
  const status = get("status");
  return jobs.filter((job) => {
    if (customer && customer !== "all" && job.customerId !== customer)
      return false;
    if (material && material !== "all" && job.material !== material)
      return false;
    if (machine && machine !== "all" && !job.machineIds.includes(machine))
      return false;
    if (facility && facility !== "all" && job.facility !== facility)
      return false;
    if (status === "open" && job.completedAt) return false;
    if (status === "completed" && !job.completedAt) return false;
    if (status === "overdue" && !job.overdue) return false;
    if (status === "blocked" && !job.blocked) return false;
    return (
      !search ||
      [
        job.id,
        job.customerId,
        job.partId,
        job.material,
        job.facility,
        job.toolId,
        job.blockReason,
        ...job.machineIds,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  });
}

function rollups(jobs, eventsByJob, blockIntervalsByJob, periodStart, asOf) {
  const dayMap = new Map();
  if (periodStart && asOf) {
    const start = Date.parse(periodStart.slice(0, 10) + "T00:00:00Z");
    const end = Date.parse(asOf.slice(0, 10) + "T00:00:00Z");
    for (let day = start; day <= end; day += DAY) {
      const date = new Date(day).toISOString().slice(0, 10);
      dayMap.set(date, { date, completed: 0, late: 0, good: 0, scrap: 0 });
    }
  }
  const defectMap = new Map();
  const reasonMap = new Map();
  const materialMap = new Map();
  for (const job of jobs) {
    if (job.completedAt) {
      const date = job.completedAt.slice(0, 10);
      const day = dayMap.get(date) ?? {
        date,
        completed: 0,
        late: 0,
        good: 0,
        scrap: 0,
      };
      day.completed++;
      day.late += Number(job.late);
      day.good += job.goodQuantity ?? 0;
      day.scrap += job.scrapQuantity ?? 0;
      dayMap.set(date, day);
    }
    const material = materialMap.get(job.material) ?? {
      material: job.material,
      completedJobs: 0,
      good: 0,
      scrap: 0,
      scrapRate: null,
    };
    if (job.completedAt) {
      material.completedJobs++;
      material.good += job.goodQuantity ?? 0;
      material.scrap += job.scrapQuantity ?? 0;
    }
    materialMap.set(job.material, material);
    for (const event of eventsByJob[job.id] ?? []) {
      if (
        event.event_type === "inspection_failed" &&
        !event.conflict &&
        finite(event.quantity)
      ) {
        const code = event.metadata?.defect_code ?? "unspecified";
        defectMap.set(code, (defectMap.get(code) ?? 0) + event.quantity);
      }
    }
    const seenReasons = new Set();
    for (const interval of blockIntervalsByJob[job.id] ?? []) {
      const reason = reasonMap.get(interval.reason) ?? {
        reason: interval.reason,
        jobs: 0,
        openJobs: 0,
        totalHours: 0,
      };
      if (!seenReasons.has(interval.reason)) reason.jobs++;
      if (!interval.end && job.blocked) reason.openJobs++;
      reason.totalHours += interval.hours;
      reasonMap.set(interval.reason, reason);
      seenReasons.add(interval.reason);
    }
  }
  for (const material of materialMap.values())
    material.scrapRate =
      material.good + material.scrap > 0
        ? material.scrap / (material.good + material.scrap)
        : null;
  return {
    trends: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    defects: [...defectMap]
      .map(([code, quantity]) => ({ code, quantity }))
      .sort((a, b) => b.quantity - a.quantity || a.code.localeCompare(b.code)),
    blockReasons: [...reasonMap.values()].sort(
      (a, b) =>
        b.openJobs - a.openJobs ||
        b.totalHours - a.totalHours ||
        a.reason.localeCompare(b.reason),
    ),
    materials: [...materialMap.values()].sort(
      (a, b) =>
        (b.scrapRate ?? -1) - (a.scrapRate ?? -1) ||
        a.material.localeCompare(b.material),
    ),
  };
}

function qualityFor(jobs, eventsByJob, extraIssues = []) {
  const events = jobs.flatMap((job) => eventsByJob[job.id] ?? []);
  const exactDuplicates = sum(events.map((event) => event.exactDuplicateCount));
  const conflicting = events.filter((event) => event.conflict);
  const mismatchJobs = jobs.filter((job) => job.qualityMismatch);
  const duplicateEvents = events.filter(
    (event) => event.exactDuplicateCount > 0,
  );
  const issues = [];
  if (exactDuplicates)
    issues.push({
      type: "exact_duplicates",
      title: "Exact duplicate rows removed",
      description:
        "Identical source events are counted once. Original line numbers remain available on each event.",
      count: exactDuplicates,
      jobIds: unique(duplicateEvents.map((event) => event.job_id)),
      eventIds: duplicateEvents.map((event) => event.event_id),
    });
  if (conflicting.length)
    issues.push({
      type: "conflicting_ids",
      title: "Conflicting event quantities",
      description:
        "Repeated IDs have different payloads without a revision marker. All variants are retained; ambiguous quantities are excluded from sums.",
      count: conflicting.length,
      jobIds: unique(conflicting.map((event) => event.job_id)),
      eventIds: conflicting.map((event) => event.event_id),
    });
  if (mismatchJobs.length)
    issues.push({
      type: "quality_mismatch",
      title: "Inspection and completion totals disagree",
      description:
        "Quality KPIs use completed-job good and scrap summaries. Inspection totals are shown separately and have not been forced to match.",
      count: mismatchJobs.length,
      jobIds: mismatchJobs.map((job) => job.id).sort(),
    });
  const selected = new Set(jobs.map((job) => job.id));
  for (const issue of extraIssues) {
    const jobIds = issue.jobIds.filter((id) => selected.has(id));
    if (jobIds.length) issues.push({ ...issue, jobIds, count: jobIds.length });
  }
  return {
    rawEvents: sum(events.map((event) => event.sourceLineNumbers?.length ?? 1)),
    uniqueEvents: events.length,
    exactDuplicates,
    conflictingIds: conflicting.map((event) => event.event_id).sort(),
    qualityMismatchJobIds: mismatchJobs.map((job) => job.id).sort(),
    issues,
  };
}

export function buildDataset(rawRows) {
  const { events } = normalizeEvents(rawRows);
  const asOf = events.at(-1)?.timestamp ?? "";
  const periodStart = events[0]?.timestamp ?? "";
  const eventsByJob = {};
  for (const event of events) (eventsByJob[event.job_id] ??= []).push(event);
  const jobs = [];
  const blockIntervalsByJob = {};
  const lifecycleIssues = [];
  const unmatched = [];
  const repeated = [];
  for (const [id, jobEvents] of Object.entries(eventsByJob)) {
    const result = jobFromEvents(id, jobEvents, asOf);
    jobs.push(result.job);
    blockIntervalsByJob[id] = result.intervals;
    if (result.unmatchedUnblocks) unmatched.push(id);
    if (result.repeatedBlocks) repeated.push(id);
  }
  if (unmatched.length)
    lifecycleIssues.push({
      type: "unmatched_unblock",
      title: "Unblock without an earlier block",
      description:
        "These events remain visible but do not create negative block intervals.",
      count: unmatched.length,
      jobIds: unmatched,
    });
  if (repeated.length)
    lifecycleIssues.push({
      type: "repeated_block",
      title: "Repeated block before release",
      description:
        "The first block remains active until a release or completion; repeated block events are retained as evidence.",
      count: repeated.length,
      jobIds: repeated,
    });
  jobs.sort(compareJobs);
  const dataset = {
    asOf,
    periodStart,
    jobs,
    eventsByJob,
    blockIntervalsByJob,
    dataQuality: qualityFor(jobs, eventsByJob, lifecycleIssues),
    ...rollups(jobs, eventsByJob, blockIntervalsByJob, periodStart, asOf),
    filters: {
      customers: unique(jobs.map((job) => job.customerId)),
      materials: unique(jobs.map((job) => job.material)),
      machines: unique(jobs.flatMap((job) => job.machineIds)),
      facilities: unique(jobs.map((job) => job.facility)),
    },
    stats: summarizeJobs(jobs),
  };
  return dataset;
}

/** Every aggregate shares the same selected job cohort. Filter options stay global. */
export function overviewFor(dataset, params = new URLSearchParams()) {
  const jobs = filterJobs(dataset.jobs, params);
  const lifecycleIssues = dataset.dataQuality.issues.filter(
    (issue) =>
      !["exact_duplicates", "conflicting_ids", "quality_mismatch"].includes(
        issue.type,
      ),
  );
  return {
    asOf: dataset.asOf,
    periodStart: dataset.periodStart,
    jobs,
    stats: summarizeJobs(jobs),
    ...rollups(
      jobs,
      dataset.eventsByJob,
      dataset.blockIntervalsByJob,
      dataset.periodStart,
      dataset.asOf,
    ),
    dataQuality: qualityFor(jobs, dataset.eventsByJob, lifecycleIssues),
    filters: dataset.filters,
  };
}
