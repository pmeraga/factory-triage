import { ArrowUpRight, GitCompareArrows, X } from "lucide-react";
import type { CompareProps } from "../telemetry-types";
import type { Job } from "../types";
import { formatPacific } from "../time.mjs";
import "./CompareTray.css";

const count = (value: number | null) =>
  value === null ? "—" : value.toLocaleString("en-US");
const hours = (value: number | null) =>
  value === null
    ? "—"
    : value < 48
      ? `${value.toFixed(1)} h`
      : `${(value / 24).toFixed(1)} d`;
const label = (job: Job) =>
  job.completedAt
    ? job.late
      ? "Completed late"
      : "Completed on time"
    : job.blocked
      ? "Blocked"
      : job.overdue
        ? "Overdue"
        : job.status === "not_started"
          ? "Not started"
          : "In progress";
const endOf = (job: Job) =>
  job.completedAt ??
  new Date(Date.parse(job.createdAt) + job.ageHours * 3_600_000).toISOString();

export default function CompareTray({
  jobs,
  onOpenJob,
  onRemove,
  onClear,
}: CompareProps) {
  if (!jobs.length) return null;
  const earliest = Math.min(...jobs.map((job) => Date.parse(job.createdAt)));
  const latest = Math.max(
    ...jobs.flatMap((job) => [
      Date.parse(endOf(job)),
      job.dueAt ? Date.parse(job.dueAt) : 0,
    ]),
  );
  const position = (value: string | null) =>
    value
      ? Math.max(
          0,
          Math.min(
            100,
            ((Date.parse(value) - earliest) / Math.max(1, latest - earliest)) *
              100,
          ),
        )
      : 0;
  const markerPosition = (value: string | null) => {
    const fraction = position(value);
    return fraction <= 0
      ? "1px"
      : fraction >= 100
        ? "calc(100% - 2px)"
        : `${fraction}%`;
  };
  const rows: { label: string; value: (job: Job) => string }[] = [
    { label: "Recorded state", value: label },
    {
      label: "Source priority",
      value: (job) =>
        job.priority
          .replaceAll("_", " ")
          .replace(/\b\w/g, (char) => char.toUpperCase()),
    },
    { label: "Customer", value: (job) => job.customerId },
    { label: "Material", value: (job) => job.material.replaceAll("_", " ") },
    {
      label: "Target due · Pacific",
      value: (job) => formatPacific(job.dueAt, true),
    },
    { label: "Job lead / age", value: (job) => hours(job.ageHours) },
    { label: "Tool-ready queue", value: (job) => hours(job.queueHours) },
    {
      label: "Recorded blocked time",
      value: (job) => hours(job.totalBlockedHours),
    },
    {
      label: "Median cycle duration",
      value: (job) =>
        job.cycleSecondsMedian === null
          ? "—"
          : `${Number(job.cycleSecondsMedian.toFixed(1)).toLocaleString()} s`,
    },
    { label: "Target quantity", value: (job) => count(job.targetQuantity) },
    {
      label: "Good / scrap",
      value: (job) =>
        `${count(job.goodQuantity)} / ${count(job.scrapQuantity)}`,
    },
    {
      label: "Completion scrap rate",
      value: (job) =>
        job.goodQuantity !== null &&
        job.scrapQuantity !== null &&
        job.goodQuantity + job.scrapQuantity > 0
          ? `${((job.scrapQuantity / (job.goodQuantity + job.scrapQuantity)) * 100).toFixed(1)}%`
          : "—",
    },
    {
      label: "Inspection discrepancies",
      value: (job) =>
        job.qualityMismatch
          ? "Needs reconciliation"
          : job.completedAt
            ? "Quantities reconcile"
            : "No completion summary",
    },
    {
      label: "Quantity conflicts",
      value: (job) => count(job.conflictIds.length),
    },
  ];
  return (
    <section
      className="panel compare-workspace"
      aria-label="Selected job comparison"
    >
      <div className="panel-heading">
        <div>
          <div className="section-label">INVESTIGATION WORKSPACE</div>
          <h2>
            <GitCompareArrows size={16} /> Compare jobs{" "}
            <span className="count-badge">{jobs.length} / 4</span>
          </h2>
        </div>
        <button className="button secondary" onClick={onClear}>
          <X size={13} /> Clear comparison
        </button>
      </div>
      <p className="compare-description">
        Compare observed lifecycles and quantities side by side. A dash means no
        qualifying record, not zero.
      </p>
      <div
        className="compare-table-scroll"
        role="region"
        aria-label="Scrollable job comparison"
        tabIndex={0}
      >
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col">Recorded measure</th>
              {jobs.map((job) => (
                <th scope="col" key={job.id}>
                  <div>
                    <button
                      className="compare-job-link"
                      onClick={() => onOpenJob(job.id)}
                    >
                      {job.id}
                      <ArrowUpRight size={12} />
                    </button>
                    <button
                      className="compare-remove"
                      onClick={() => onRemove(job.id)}
                      aria-label={`Remove ${job.id} from comparison`}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <small>{job.partId}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="compare-lifecycle-row">
              <th scope="row">
                Lifecycle / due marker
                <small>
                  {formatPacific(new Date(earliest).toISOString())} →{" "}
                  {formatPacific(new Date(latest).toISOString())}
                </small>
              </th>
              {jobs.map((job) => (
                <td key={job.id}>
                  <div className="compare-lifecycle-track" aria-hidden="true">
                    <span
                      className={job.completedAt ? "completed" : "open"}
                      style={{
                        left: `${position(job.createdAt)}%`,
                        width: `${Math.max(0, position(endOf(job)) - position(job.createdAt))}%`,
                      }}
                      title={`Created ${formatPacific(job.createdAt, true)} to ${job.completedAt ? "completed " : "replay cursor "}${formatPacific(endOf(job), true)}`}
                    />
                    {job.toolReadyAt && (
                      <i
                        style={{ left: markerPosition(job.toolReadyAt) }}
                        title={`Tool ready ${formatPacific(job.toolReadyAt, true)}`}
                      />
                    )}
                    {job.startedAt && (
                      <i
                        className="started"
                        style={{ left: markerPosition(job.startedAt) }}
                        title={`Started ${formatPacific(job.startedAt, true)}`}
                      />
                    )}
                    {job.dueAt && (
                      <b
                        style={{ left: markerPosition(job.dueAt) }}
                        title={`Target due ${formatPacific(job.dueAt, true)}`}
                      />
                    )}
                  </div>
                  <small>
                    {job.completedAt
                      ? `Completed ${formatPacific(job.completedAt)}`
                      : "Open at replay cursor"}
                  </small>
                  <details className="compare-lifecycle-details">
                    <summary>Full timestamps</summary>
                    <dl>
                      {[
                        ["Created", job.createdAt],
                        ["Tool ready", job.toolReadyAt],
                        ["Started", job.startedAt],
                        [
                          job.completedAt ? "Completed" : "Replay cursor",
                          endOf(job),
                        ],
                        ["Target due", job.dueAt],
                      ].map(([name, timestamp]) => (
                        <div key={name}>
                          <dt>{name}</dt>
                          <dd>
                            {timestamp
                              ? formatPacific(timestamp, true)
                              : "Not recorded"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </td>
              ))}
            </tr>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {jobs.map((job) => (
                  <td
                    key={job.id}
                    className={
                      (row.label === "Recorded state" &&
                        (job.overdue || job.blocked || job.late)) ||
                      (row.label === "Inspection discrepancies" &&
                        job.qualityMismatch)
                        ? "compare-attention"
                        : ""
                    }
                  >
                    {row.value(job)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="compare-legend">
        <span>
          <i className="complete" /> Completed lifecycle
        </span>
        <span>
          <i className="open" /> Open lifecycle
        </span>
        <span>
          <i className="tool-ready" /> Tool ready
        </span>
        <span>
          <i className="job-started" /> Job started
        </span>
        <span>
          <i className="due" /> Target due
        </span>
        <span>
          All timestamps use Pacific Time. Job timing is lifetime-to-cursor; it
          is not a machine utilization measure.
        </span>
      </div>
    </section>
  );
}
