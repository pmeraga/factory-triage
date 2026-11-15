import { formatPacific } from "../time.mjs";

const priorities = { urgent: 0, critical: 0, high: 1, normal: 2, low: 3 };
const finite = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const nullable = (a, b, descending = false) =>
  a === null
    ? b === null
      ? 0
      : 1
    : b === null
      ? -1
      : descending
        ? b - a
        : a - b;
export function compareJobs(a, b, sort) {
  let result = 0;
  if (sort === "due")
    result = nullable(finite(Date.parse(a.dueAt)), finite(Date.parse(b.dueAt)));
  else if (sort === "age")
    result = nullable(finite(a.ageHours), finite(b.ageHours), true);
  else if (sort === "blocked")
    result = nullable(
      finite(a.totalBlockedHours),
      finite(b.totalBlockedHours),
      true,
    );
  else if (sort === "cycle")
    result = nullable(
      finite(a.cycleSecondsMedian),
      finite(b.cycleSecondsMedian),
      true,
    );
  else if (sort === "customer")
    result = String(a.customerId || "").localeCompare(
      String(b.customerId || ""),
    );
  else {
    const rank = (job) =>
      job.overdue ? 0 : job.blocked ? 1 : job.completedAt ? 3 : 2;
    result =
      rank(a) - rank(b) ||
      Number(b.blocked) - Number(a.blocked) ||
      (priorities[a.priority] ?? 2) - (priorities[b.priority] ?? 2) ||
      b.overdueHours - a.overdueHours ||
      b.blockedHours - a.blockedHours ||
      b.ageHours - a.ageHours;
  }
  return result || a.id.localeCompare(b.id);
}
export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function watchlistCsv(jobs, snapshotAsOf) {
  const columns = [
    "id",
    "customerId",
    "partId",
    "material",
    "facility",
    "priority",
    "status",
    "createdAt",
    "createdAtPacific",
    "startedAt",
    "startedAtPacific",
    "completedAt",
    "completedAtPacific",
    "dueAt",
    "dueAtPacific",
    "blockedSince",
    "blockedSincePacific",
    "snapshotAsOf",
    "snapshotAsOfPacific",
    "overdue",
    "overdueHours",
    "ageHours",
    "blockReason",
    "blockedHours",
    "totalBlockedHours",
    "targetQuantity",
    "goodQuantity",
    "scrapQuantity",
    "qualityMismatch",
    "eventCount",
    "machineIds",
  ];
  return [
    columns,
    ...jobs.map((job) =>
      columns.map((key) => {
        if (key === "snapshotAsOf") return snapshotAsOf;
        if (key === "snapshotAsOfPacific")
          return formatPacific(snapshotAsOf, true);
        if (key.endsWith("Pacific"))
          return job[key.slice(0, -7)]
            ? formatPacific(job[key.slice(0, -7)], true)
            : "";
        if (key === "machineIds") return (job.machineIds ?? []).join(";");
        return job[key];
      }),
    ),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
