import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Factory,
  Filter,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  X,
} from "lucide-react";
import type { Job, JobDetail, Overview } from "./types";

type View = "overview" | "jobs" | "quality" | "guide";
type Filters = {
  search: string;
  customer: string;
  material: string;
  machine: string;
  facility: string;
  status: string;
};
const emptyFilters: Filters = {
  search: "",
  customer: "",
  material: "",
  machine: "",
  facility: "",
  status: "open",
};
const n = (value: number) => new Intl.NumberFormat("en-US").format(value);
const pct = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const human = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (l) => l.toUpperCase());
function date(value: string | null, includeTime = false) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeTime
      ? {
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        }
      : {}),
    timeZone: "UTC",
  }).format(new Date(value));
}
function hours(value: number) {
  return value < 1
    ? `${Math.max(0, Math.round(value * 60))}m`
    : value < 48
      ? `${value.toFixed(1)}h`
      : `${(value / 24).toFixed(1)}d`;
}
function statusLabel(job: Job) {
  if (job.status === "completed")
    return job.late ? "Completed late" : "Completed";
  if (job.blocked) return "Blocked";
  if (job.overdue) return "Overdue";
  return job.status === "not_started" ? "Not started" : "In progress";
}
function Status({ job }: { job: Job }) {
  return (
    <span
      className={`status ${job.status === "completed" ? "complete" : job.blocked ? "blocked" : job.overdue ? "overdue" : "progress"}`}
    >
      <i />
      {statusLabel(job)}
    </span>
  );
}

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [filters, setFilters] = useState<Filters>(() => {
    const p = new URLSearchParams(window.location.search);
    return Object.fromEntries(
      Object.entries(emptyFilters).map(([k, v]) => [k, p.get(k) ?? v]),
    ) as Filters;
  });
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedJob, setSelectedJob] = useState<string | null>(
    new URLSearchParams(window.location.search).get("job"),
  );
  const [page, setPage] = useState(0);
  const query = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v) p.set(k, v);
    });
    return p.toString();
  }, [filters]);
  const requestQuery = useMemo(() => {
    const p = new URLSearchParams(query);
    if (view !== "jobs") p.set("status", "all");
    return p.toString();
  }, [query, view]);
  const displayedJobs = useMemo(() => {
    if (!data) return [];
    if (view !== "overview") return data.jobs;
    return data.jobs.filter(
      (job) =>
        filters.status === "all" ||
        (filters.status === "open" && job.status !== "completed") ||
        (filters.status === "overdue" && job.overdue) ||
        (filters.status === "blocked" && job.blocked) ||
        (filters.status === "completed" && job.status === "completed"),
    );
  }, [data, view, filters.status]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => {
        setLoading(true);
        setError("");
        fetch(`/api/overview?${requestQuery}`, { signal: controller.signal })
          .then(async (response) => {
            if (!response.ok)
              throw new Error(
                `Could not load the event log (${response.status}).`,
              );
            return response.json() as Promise<Overview>;
          })
          .then(setData)
          .catch((e) => {
            if (e.name !== "AbortError") setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      filters.search ? 220 : 0,
    );
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [requestQuery, retry]);
  useEffect(() => {
    setPage(0);
  }, [query, view]);
  useEffect(() => {
    const p = new URLSearchParams(query);
    if (selectedJob) p.set("job", selectedJob);
    window.history.replaceState(null, "", `?${p.toString()}`);
  }, [query, selectedJob]);
  const update = (key: keyof Filters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const navigate = (next: View) => {
    setView(next);
    if (next === "jobs") update("status", "all");
    if (next === "overview") update("status", "open");
  };
  const activeFilters = Object.entries(filters).filter(
    ([k, v]) => k !== "status" && v,
  ).length;
  const title =
    view === "overview"
      ? "A clear view of the floor."
      : view === "jobs"
        ? "Every job. Every detail."
        : view === "quality"
          ? "Trust starts with the evidence."
          : "Understand the numbers.";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => navigate("overview")}
          aria-label="Factory Triage overview"
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>
            factory<span className="brand-light">triage</span>
            <small>PRODUCTION INTELLIGENCE</small>
          </span>
        </button>
        <div className="workspace-label">
          <span className="workspace-icon">
            <Factory size={15} />
          </span>
          <span>
            Manufacturing workspace
            <small>
              {data
                ? `${date(data.periodStart)} – ${date(data.asOf)}`
                : "Loading event log…"}
            </small>
          </span>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {[
            ["overview", LayoutDashboard, "Overview"],
            ["jobs", Layers3, "All jobs"],
            ["quality", ShieldCheck, "Quality & data"],
            ["guide", BookOpen, "Metric guide"],
          ].map(([key, Icon, label]) => {
            const I = Icon as typeof Activity;
            return (
              <button
                key={key as string}
                className={view === key ? "nav-item active" : "nav-item"}
                aria-current={view === key ? "page" : undefined}
                onClick={() => navigate(key as View)}
              >
                <I size={18} />
                <span>{label as string}</span>
                {key === "overview" && <span className="nav-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-dot" /> DATASET SNAPSHOT
          <p>
            Source events.
            <br />
            Clearer next steps.
          </p>
          <span>Historical analysis, grounded in source records.</span>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">FT</span>
          <span>
            Factory Triage<small>Synthetic manufacturing dataset</small>
          </span>
          <ShieldCheck size={16} />
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <ChevronRight size={13} />
            <strong>
              {view === "overview"
                ? "Overview"
                : view === "jobs"
                  ? "All jobs"
                  : view === "quality"
                    ? "Quality & data"
                    : "Metric guide"}
            </strong>
          </div>
          <div className="snapshot">
            <span className="tiny-dot" /> Snapshot as of{" "}
            <strong>{data ? date(data.asOf, true) : "Loading…"}</strong>
            <span className="snapshot-tag">UTC</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "overview"
                  ? "THE PRODUCTION DESK"
                  : view === "jobs"
                    ? "JOB EXPLORER"
                    : view === "quality"
                      ? "DATA RECONCILIATION"
                      : "BUILT ON EVIDENCE"}
              </div>
              <h1>{title}</h1>
              <p>
                {view === "overview"
                  ? "Find what needs attention. Follow every number back to its source."
                  : view === "jobs"
                    ? "Explore the full production lifecycle, from creation to completion."
                    : view === "quality"
                      ? "Inspect quality signals, conflicting records, and gaps in the event log."
                      : "Transparent definitions. Explicit assumptions. No hidden calculations."}
              </p>
            </div>
            {view !== "guide" && (
              <a
                className="button secondary export-button"
                href={`/api/export?${view === "quality" ? requestQuery : query}`}
                download
              >
                <ArrowDownToLine size={16} /> Export jobs <span>CSV</span>
              </a>
            )}
          </div>
          {error && (
            <div className="error-state" role="alert">
              <CircleAlert size={22} />
              <div>
                <strong>The event log could not be loaded.</strong>
                <p>{error}</p>
              </div>
              <button
                className="button secondary"
                onClick={() => setRetry((r) => r + 1)}
              >
                Try again
              </button>
            </div>
          )}
          {!data && loading && (
            <div className="loading-state">
              <LoaderCircle className="spin" size={25} />
              <strong>Reading the production floor…</strong>
              <span>Preparing jobs and source-event evidence.</span>
            </div>
          )}
          {data && (
            <div
              className={loading ? "content refreshing" : "content"}
              aria-busy={loading}
            >
              {(view === "overview" || view === "jobs") && (
                <>
                  <div className="scope-note">
                    <Filter size={12} />
                    {view === "overview"
                      ? "Summary and charts include all job statuses. Status tabs filter the attention queue."
                      : "Summary and export reflect the selected job filters."}
                    {activeFilters > 0 && (
                      <span>
                        {" "}
                        · {activeFilters} scope filter
                        {activeFilters > 1 ? "s" : ""} active
                      </span>
                    )}
                  </div>
                  <div className="stat-grid">
                    <Stat
                      label="Open jobs"
                      value={n(data.stats.open)}
                      detail={`${n(data.stats.jobs)} jobs in selected scope`}
                      icon={<Layers3 size={17} />}
                    />
                    <Stat
                      label="Overdue jobs"
                      value={n(data.stats.overdueOpen)}
                      detail="Past due at the snapshot"
                      icon={<Clock3 size={17} />}
                      tone="amber"
                      onClick={() => update("status", "overdue")}
                    />
                    <Stat
                      label="Blocked now"
                      value={n(data.stats.blockedOpen)}
                      detail="Waiting for the next step"
                      icon={<CircleAlert size={17} />}
                      tone="red"
                      onClick={() => update("status", "blocked")}
                    />
                    <Stat
                      label="On-time completion"
                      value={pct(data.stats.onTimeRate)}
                      detail={`${n(data.stats.completed)} completed · ${n(data.stats.lateCompleted)} late`}
                      icon={<CheckCheck size={17} />}
                    />
                  </div>
                  {view === "overview" && (
                    <div className="insights-grid">
                      <Throughput data={data} />
                      <Blockers data={data} selectJob={setSelectedJob} />
                    </div>
                  )}
                  <section className="panel queue-panel">
                    <div className="panel-heading">
                      <div>
                        <div className="section-label">
                          {view === "overview"
                            ? "YOUR NEXT MOVE"
                            : "PRODUCTION REGISTER"}
                        </div>
                        <h2>
                          {view === "overview" ? "Attention queue" : "All jobs"}
                          <span className="count-badge">
                            {n(displayedJobs.length)}
                          </span>
                        </h2>
                      </div>
                      <div className="panel-subtitle">
                        <span className="tiny-dot" />
                        {view === "overview"
                          ? "Prioritized by urgency"
                          : "Search, filter, investigate"}
                      </div>
                    </div>
                    <div className="queue-toolbar">
                      <div
                        className="status-tabs"
                        role="group"
                        aria-label="Filter jobs by status"
                      >
                        {[
                          ["open", "Open"],
                          ["overdue", "Overdue"],
                          ["blocked", "Blocked"],
                          ["completed", "Completed"],
                          ["all", "All jobs"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            onClick={() => update("status", value)}
                            className={
                              filters.status === value ? "selected" : ""
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="search-tools">
                        <label className="search-box">
                          <Search size={16} />
                          <input
                            placeholder="Search jobs, parts, customers…"
                            value={filters.search}
                            onChange={(e) => update("search", e.target.value)}
                            aria-label="Search jobs"
                          />
                          {filters.search && (
                            <button
                              aria-label="Clear search"
                              onClick={() => update("search", "")}
                            >
                              <X size={13} />
                            </button>
                          )}
                        </label>
                        <button
                          className={`button filter-button ${showFilters || activeFilters ? "filter-active" : ""}`}
                          onClick={() => setShowFilters((s) => !s)}
                        >
                          <SlidersHorizontal size={15} />
                          Filters{activeFilters > 0 && <b>{activeFilters}</b>}
                        </button>
                      </div>
                    </div>
                    {showFilters && (
                      <div className="filter-row">
                        {(
                          [
                            ["customer", "Customer", data.filters.customers],
                            ["material", "Material", data.filters.materials],
                            ["machine", "Machine", data.filters.machines],
                            ["facility", "Facility", data.filters.facilities],
                          ] as [keyof Filters, string, string[]][]
                        ).map(([key, label, options]) => (
                          <label key={key}>
                            {label}
                            <select
                              value={filters[key]}
                              onChange={(e) => update(key, e.target.value)}
                            >
                              <option value="">
                                All {label.toLowerCase()}s
                              </option>
                              {options.map((v) => (
                                <option value={v} key={v}>
                                  {human(v)}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                        <button
                          className="text-button"
                          onClick={() =>
                            setFilters({
                              ...emptyFilters,
                              status: filters.status,
                            })
                          }
                        >
                          Reset filters
                        </button>
                      </div>
                    )}
                    {displayedJobs.length ? (
                      <>
                        <div className="table-scroll">
                          <table className="jobs-table">
                            <thead>
                              <tr>
                                <th>Job / part</th>
                                <th>Status</th>
                                <th>Customer / material</th>
                                <th>Due date</th>
                                <th>Production</th>
                                <th>Attention</th>
                                <th aria-label="Open job" />
                              </tr>
                            </thead>
                            <tbody>
                              {displayedJobs
                                .slice(page * 12, (page + 1) * 12)
                                .map((job) => (
                                  <tr
                                    key={job.id}
                                    onClick={() => setSelectedJob(job.id)}
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter")
                                        setSelectedJob(job.id);
                                    }}
                                    aria-label={`View ${job.id}`}
                                  >
                                    <td>
                                      <strong className="mono">{job.id}</strong>
                                      <small>{job.partId}</small>
                                    </td>
                                    <td>
                                      <Status job={job} />
                                    </td>
                                    <td>
                                      <strong>{job.customerId}</strong>
                                      <small>{human(job.material)}</small>
                                    </td>
                                    <td>
                                      <strong
                                        className={
                                          job.overdue ? "amber-text" : ""
                                        }
                                      >
                                        {date(job.dueAt)}
                                      </strong>
                                      <small>
                                        {job.overdue
                                          ? `${hours(job.overdueHours)} overdue`
                                          : job.completedAt
                                            ? `Finished ${date(job.completedAt)}`
                                            : human(job.priority) + " priority"}
                                      </small>
                                    </td>
                                    <td>
                                      <strong>
                                        {job.goodQuantity === null
                                          ? "—"
                                          : n(job.goodQuantity)}
                                        <span className="muted">
                                          {" "}
                                          / {n(job.targetQuantity)}
                                        </span>
                                      </strong>
                                      <small>
                                        {job.machineIds.length
                                          ? job.machineIds.join(", ")
                                          : "No machine assigned"}
                                      </small>
                                    </td>
                                    <td>
                                      <span className="attention-text">
                                        {job.blocked ? (
                                          human(
                                            job.blockReason ||
                                              "Unspecified block",
                                          )
                                        ) : job.qualityMismatch ||
                                          job.conflictIds.length ? (
                                          <span className="data-flag">
                                            <CircleAlert size={12} /> Review
                                            data
                                          </span>
                                        ) : job.overdue ? (
                                          "Past target due date"
                                        ) : job.status === "not_started" ? (
                                          "Awaiting start"
                                        ) : job.status === "completed" ? (
                                          "Lifecycle complete"
                                        ) : (
                                          "Production in progress"
                                        )}
                                      </span>
                                    </td>
                                    <td>
                                      <ArrowUpRight size={17} />
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="table-footer">
                          <span>
                            Showing {n(page * 12 + 1)}–
                            {n(Math.min((page + 1) * 12, displayedJobs.length))}{" "}
                            of {n(displayedJobs.length)} jobs
                          </span>
                          <div>
                            <button
                              aria-label="Previous page"
                              disabled={page === 0}
                              onClick={() => setPage((p) => p - 1)}
                            >
                              <ChevronLeft size={16} />
                            </button>
                            <span>
                              {page + 1} /{" "}
                              {Math.ceil(displayedJobs.length / 12)}
                            </span>
                            <button
                              aria-label="Next page"
                              disabled={(page + 1) * 12 >= displayedJobs.length}
                              onClick={() => setPage((p) => p + 1)}
                            >
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">
                        <Search size={25} />
                        <h3>No jobs match these filters.</h3>
                        <p>Try another search or broaden your selection.</p>
                        <button
                          className="button secondary"
                          onClick={() => setFilters(emptyFilters)}
                        >
                          Reset all filters
                        </button>
                      </div>
                    )}
                  </section>
                  <div className="page-footnote">
                    <ShieldCheck size={14} /> Based on{" "}
                    {n(data.dataQuality.uniqueEvents)} unique source events. All
                    times in UTC.{" "}
                    <button onClick={() => navigate("guide")}>
                      How metrics are calculated <ArrowRight size={12} />
                    </button>
                  </div>
                </>
              )}
              {view === "quality" && (
                <Quality data={data} selectJob={setSelectedJob} />
              )}
              {view === "guide" && <Guide data={data} />}
            </div>
          )}
        </main>
      </div>
      {selectedJob && (
        <JobDrawer id={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
  tone = "",
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone?: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={`stat-card ${tone}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <div className="stat-label">
        {label}
        <span className="stat-icon">{icon}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      <div className="stat-detail">
        {tone && <span className="stat-indicator" />}
        {detail}
        {onClick && <ArrowUpRight size={13} />}
      </div>
    </button>
  );
}
function Throughput({ data }: { data: Overview }) {
  const trends = data.trends.slice(-14);
  const max = Math.max(1, ...trends.map((t) => t.completed));
  const total = trends.reduce((s, t) => s + t.completed, 0);
  return (
    <section className="panel throughput-panel">
      <div className="panel-heading">
        <div>
          <div className="section-label">PRODUCTION PULSE</div>
          <h2>Jobs crossing the finish line</h2>
        </div>
        <span className="period-chip">{trends.length} observed days</span>
      </div>
      <div className="chart-summary">
        <strong>{n(total)}</strong>
        <span>
          completed jobs
          <span>Latest {trends.length} observed days in scope</span>
        </span>
        <div className="chart-legend">
          <i /> On time <i className="late" /> Late
        </div>
      </div>
      <div
        className="chart"
        role="img"
        aria-label={`Daily completed jobs. ${trends.map((t) => `${t.date}: ${t.completed}, ${t.late} late`).join("; ")}`}
      >
        <div className="chart-grid">
          <span>{max}</span>
          <span>{Math.round(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="chart-bars">
          {trends.map((t) => (
            <div className="chart-column" key={t.date}>
              <div className="bar-track">
                <div
                  className="chart-bar"
                  style={{ height: `${(t.completed / max) * 100}%` }}
                  title={`${t.date}: ${t.completed} completed, ${t.late} late`}
                >
                  <div
                    className="late-bar"
                    style={{
                      height: `${t.completed ? (t.late / t.completed) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <span>{new Date(t.date).getUTCDate()}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="chart-bottom">
        <span>
          {trends.length ? date(trends[0].date) : "No completed jobs"}
        </span>
        <span>{trends.length ? date(trends[trends.length - 1].date) : ""}</span>
      </div>
    </section>
  );
}
function Blockers({
  data,
  selectJob,
}: {
  data: Overview;
  selectJob: (id: string) => void;
}) {
  const reasons = [...data.blockReasons]
    .sort((a, b) => b.openJobs - a.openJobs || b.totalHours - a.totalHours)
    .slice(0, 4);
  const max = Math.max(1, ...reasons.map((r) => r.openJobs));
  return (
    <section className="panel blocker-panel">
      <div className="panel-heading">
        <div>
          <div className="section-label">WHAT'S HOLDING US UP</div>
          <h2>Blockers at a glance</h2>
        </div>
        <span className="icon-box">
          <CircleAlert size={17} />
        </span>
      </div>
      <div className="blocker-list">
        {reasons.length ? (
          reasons.map((r) => (
            <button
              className="blocker-item"
              key={r.reason}
              onClick={() => {
                const job =
                  data.jobs.find(
                    (j) => j.blocked && j.blockReason === r.reason,
                  ) || data.jobs.find((j) => j.blockReason === r.reason);
                if (job) selectJob(job.id);
              }}
              disabled={!data.jobs.some((j) => j.blockReason === r.reason)}
            >
              <div>
                <strong>{human(r.reason)}</strong>
                <span>
                  {r.openJobs} open <ArrowUpRight size={12} />
                </span>
              </div>
              <div className="reason-track">
                <span
                  style={{ width: `${Math.max(3, (r.openJobs / max) * 100)}%` }}
                />
              </div>
              <small>
                {hours(r.totalHours)} recorded blocked time · {r.jobs} jobs
                affected
              </small>
            </button>
          ))
        ) : (
          <div className="small-empty">
            <Check size={20} />
            No recorded blockers in this scope.
          </div>
        )}
      </div>
      <div className="panel-note">
        <Clock3 size={13} /> Open intervals measured to the snapshot.
      </div>
    </section>
  );
}
function Quality({
  data,
  selectJob,
}: {
  data: Overview;
  selectJob: (id: string) => void;
}) {
  const dq = data.dataQuality;
  const maxDefect = Math.max(1, ...data.defects.map((d) => d.quantity));
  return (
    <>
      <div className="stat-grid">
        <Stat
          label="Source records"
          value={n(dq.rawEvents)}
          detail={`${n(dq.uniqueEvents)} unique event IDs`}
          icon={<Layers3 size={17} />}
        />
        <Stat
          label="Exact duplicates"
          value={n(dq.exactDuplicates)}
          detail="Excluded from metric calculations"
          icon={<CheckCheck size={17} />}
        />
        <Stat
          label="Conflicting event IDs"
          value={n(dq.conflictingIds.length)}
          detail="Variants preserved for inspection"
          tone="amber"
          icon={<CircleAlert size={17} />}
        />
        <Stat
          label="Quantity mismatches"
          value={n(dq.qualityMismatchJobIds.length)}
          detail="Completion vs. inspection quantities"
          tone="red"
          icon={<Activity size={17} />}
        />
      </div>
      <section className="panel reconciliation">
        <div className="panel-heading">
          <div>
            <div className="section-label">REVIEW THE EVIDENCE</div>
            <h2>Data reconciliation</h2>
          </div>
          <span className="period-chip">All statuses · selected scope</span>
        </div>
        {dq.issues.length ? (
          dq.issues.map((issue, i) => (
            <div className="issue" key={`${issue.type}-${i}`}>
              <span className="issue-icon">
                <CircleAlert size={18} />
              </span>
              <div>
                <h3>
                  {issue.title}
                  <span className="count-badge">{issue.count}</span>
                </h3>
                <p>{issue.description}</p>
                <div className="job-links">
                  {issue.jobIds.slice(0, 12).map((id) => (
                    <button key={id} onClick={() => selectJob(id)}>
                      {id}
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
                  {issue.jobIds.length > 12 && (
                    <span>+{issue.jobIds.length - 12} more jobs</span>
                  )}
                </div>
                {issue.eventIds && issue.eventIds.length > 0 && (
                  <small className="muted">
                    Source IDs: {issue.eventIds.slice(0, 4).join(", ")}
                    {issue.eventIds.length > 4 ? "…" : ""}
                  </small>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <ShieldCheck size={26} />
            <h3>No reconciliation issues detected.</h3>
            <p>
              These checks cover known schema and quantity consistency rules.
            </p>
          </div>
        )}
      </section>
      <div className="quality-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <div className="section-label">INSPECTION SIGNALS</div>
              <h2>Recorded defect quantities</h2>
            </div>
          </div>
          <div className="defect-list">
            {data.defects.length ? (
              data.defects.slice(0, 8).map((d) => (
                <div key={d.code}>
                  <div>
                    <strong>{human(d.code)}</strong>
                    <span>{n(d.quantity)}</span>
                  </div>
                  <div className="reason-track">
                    <span
                      style={{ width: `${(d.quantity / maxDefect) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">
                No defect quantities recorded in this scope.
              </p>
            )}
          </div>
          <div className="panel-note">
            Inspection quantities are separate from completion-reported scrap.
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <div className="section-label">COMPLETION-REPORTED QUALITY</div>
              <h2>Material performance</h2>
            </div>
          </div>
          <div className="table-scroll">
            <table className="material-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Good</th>
                  <th>Scrap</th>
                  <th>Scrap rate</th>
                </tr>
              </thead>
              <tbody>
                {data.materials.map((m) => (
                  <tr key={m.material}>
                    <td>{human(m.material)}</td>
                    <td>{n(m.good)}</td>
                    <td>{n(m.scrap)}</td>
                    <td>{pct(m.scrapRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-note">
            Rate = scrap ÷ (good + scrap), where quantities exist.
          </div>
        </section>
      </div>
    </>
  );
}
function Guide({ data }: { data: Overview }) {
  const definitions = [
    [
      "Snapshot time",
      "All open-job ages and overdue calculations use the latest timestamp in the event log, rather than your current clock. This keeps a historical dataset reproducible.",
    ],
    [
      "Open and overdue jobs",
      "Open jobs have no recorded job_completed event. An open job is overdue when its target due time is earlier than the dataset snapshot. Completed jobs retain a separate late-completion flag.",
    ],
    [
      "On-time completion",
      "The share of completed jobs whose recorded completion timestamp is at or before target_due_at. Open jobs are excluded. A dash means there are no eligible completed jobs.",
    ],
    [
      "Production quantities",
      "Good and scrap quantities come from job completion records. A dash means a completion quantity is unavailable; it does not mean zero. Target quantity comes from job creation.",
    ],
    [
      "Inspection reconciliation",
      "Passed and failed inspection quantities are compared with completion-reported production. These are independent observations; discrepancies are surfaced instead of silently reconciled.",
    ],
    [
      "Blocked time",
      "Recorded job_blocked and job_unblocked events define blocked intervals. Still-open intervals end at the snapshot for duration calculations; a terminal completion closes an unresolved block. Block reasons are recorded labels, not inferred root causes.",
    ],
    [
      "Cycle and queue time",
      "Median cycle time uses recorded cycle duration metadata where available. Queue time is elapsed time from tooling readiness to job start. Neither metric measures overall equipment effectiveness.",
    ],
    [
      "Source event policy",
      "Repeated identical records are deduplicated by event ID. Conflicting cycle events contribute one event with unknown quantity; unresolved quantities are excluded from sums. Every original variant remains visible in source evidence.",
    ],
    [
      "Filters and scope",
      "Customer, material, machine, and facility filters define the selected scope. Overview summaries and charts include all job statuses; status tabs filter the queue and CSV export. All jobs summaries follow all filters. Quality checks include all statuses in the selected scope. Each job exposes its supporting events.",
    ],
  ];
  return (
    <div className="guide-layout">
      <section className="panel guide-panel">
        <div className="panel-heading">
          <div>
            <div className="section-label">METRIC REFERENCE</div>
            <h2>Know what you're looking at</h2>
          </div>
          <BookOpen size={21} />
        </div>
        {definitions.map(([title, text], i) => (
          <article className="definition" key={title}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </section>
      <aside className="guide-aside">
        <div className="guide-callout">
          <ShieldCheck size={25} />
          <h3>Evidence, all the way down.</h3>
          <p>
            Open any job to see its lifecycle, block history, inspection
            quantities, and original source records.
          </p>
          <div className="guide-datum">
            <span>Source</span>
            <strong>manufacturing_events.jsonl</strong>
          </div>
          <div className="guide-datum">
            <span>Dataset coverage</span>
            <strong>
              {date(data.periodStart)} – {date(data.asOf)}
            </strong>
          </div>
          <div className="guide-datum">
            <span>Analysis timezone</span>
            <strong>UTC</strong>
          </div>
          <div className="guide-datum">
            <span>Dataset type</span>
            <strong>Synthetic manufacturing events</strong>
          </div>
        </div>
        <p className="guide-caveat">
          No capacity utilization, OEE, financial impact, or causal diagnosis is
          inferred from incomplete inputs.
        </p>
      </aside>
    </div>
  );
}
function JobDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [eventType, setEventType] = useState("all");
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [eventPage, setEventPage] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError("");
    fetch(`/api/jobs/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Job could not be loaded (${r.status}).`);
        return r.json();
      })
      .then(setDetail)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [id]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const elements = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], select, input, summary, [tabindex="0"]',
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = scroll;
      previous?.focus();
    };
  }, [onClose]);
  useEffect(() => setEventPage(0), [eventType, conflictsOnly]);
  const job = detail?.job;
  const events =
    detail?.events.filter(
      (e) =>
        (eventType === "all" || e.event_type === eventType) &&
        (!conflictsOnly || e.conflict),
    ) ?? [];
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="job-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-title"
        ref={dialog}
      >
        <div className="drawer-header">
          <div>
            <div className="section-label">JOB INVESTIGATION</div>
            <h2 id="job-title">{id}</h2>
          </div>
          <button
            className="close-button"
            onClick={onClose}
            ref={closeButton}
            aria-label="Close job details"
          >
            <X size={21} />
          </button>
        </div>
        {error ? (
          <div className="error-state" role="alert">
            {error}
          </div>
        ) : !job || !detail ? (
          <div className="loading-state">
            <LoaderCircle className="spin" size={24} />
            Loading source evidence…
          </div>
        ) : (
          <div className="drawer-body">
            <div className="job-overview">
              <Status job={job} />
              <span className="priority">{human(job.priority)} priority</span>
              <h3>{job.partId}</h3>
              <p>
                {job.customerId}
                <span> / </span>
                {human(job.material)}
                <span> / </span>
                {job.facility}
              </p>
              <div className="job-meta">
                <span>
                  <Factory size={14} />
                  {job.machineIds.join(", ") || "No machine assigned"}
                </span>
                {job.toolId && <span>Tool {job.toolId}</span>}
                <span>{n(job.eventCount)} source events</span>
              </div>
            </div>
            {(job.qualityMismatch || job.conflictIds.length > 0) && (
              <div className="evidence-alert">
                <CircleAlert size={18} />
                <div>
                  <strong>This job needs a data review.</strong>
                  <p>
                    {job.qualityMismatch
                      ? "Inspection and completion quantities do not reconcile. "
                      : ""}
                    {job.conflictIds.length
                      ? `${job.conflictIds.length} event ID${job.conflictIds.length > 1 ? "s have" : " has"} conflicting source records.`
                      : ""}
                  </p>
                </div>
              </div>
            )}
            {job.blocked && (
              <div className="block-alert">
                <CircleAlert size={18} />
                <div>
                  <strong>{human(job.blockReason || "Recorded block")}</strong>
                  <p>
                    Blocked for {hours(job.blockedHours)} · since{" "}
                    {date(job.blockedSince, true)}
                  </p>
                </div>
              </div>
            )}
            <section className="drawer-section">
              <div className="drawer-section-title">
                <h3>Job lifecycle</h3>
                <span>Due {date(job.dueAt, true)}</span>
              </div>
              <div className="lifecycle">
                {[
                  ["Created", job.createdAt],
                  ["Tool ready", job.toolReadyAt],
                  ["Started", job.startedAt],
                  ["Completed", job.completedAt],
                ].map(([label, value]) => (
                  <div
                    className={value ? "lifecycle-step done" : "lifecycle-step"}
                    key={label}
                  >
                    <span className="lifecycle-dot">
                      {value ? <Check size={12} /> : <i />}
                    </span>
                    <strong>{label}</strong>
                    <small>{value ? date(value, true) : "Not recorded"}</small>
                  </div>
                ))}
              </div>
              <div className="deadline-marker">
                <Clock3 size={15} />
                <div>
                  <strong>Target due</strong>
                  <span>{date(job.dueAt, true)}</span>
                </div>
                <b className={job.overdue || job.late ? "deadline-late" : ""}>
                  {job.completedAt
                    ? job.late
                      ? `Completed ${hours(job.overdueHours)} late`
                      : "Completed on time"
                    : job.overdue
                      ? `${hours(job.overdueHours)} overdue at snapshot`
                      : "Within target due date"}
                </b>
              </div>
              <div className="detail-metrics">
                <div>
                  <span>Target quantity</span>
                  <strong>{n(job.targetQuantity)}</strong>
                </div>
                <div>
                  <span>Good / scrap</span>
                  <strong>
                    {job.goodQuantity === null ? "—" : n(job.goodQuantity)}
                    <em>
                      {" "}
                      /{" "}
                      {job.scrapQuantity === null ? "—" : n(job.scrapQuantity)}
                    </em>
                  </strong>
                </div>
                <div>
                  <span>Time in queue</span>
                  <strong>
                    {job.queueHours === null ? "—" : hours(job.queueHours)}
                  </strong>
                </div>
                <div>
                  <span>Median cycle</span>
                  <strong>
                    {job.cycleSecondsMedian === null
                      ? "—"
                      : `${Math.round(job.cycleSecondsMedian)}s`}
                  </strong>
                </div>
              </div>
            </section>
            <section className="drawer-section">
              <div className="drawer-section-title">
                <h3>Inspection evidence</h3>
                {job.qualityMismatch && (
                  <span className="mismatch-tag">Does not reconcile</span>
                )}
              </div>
              <div className="inspection-grid">
                <div>
                  <span className="inspection-dot pass" />
                  Passed quantity<strong>{n(job.inspectionPassed)}</strong>
                </div>
                <div>
                  <span className="inspection-dot fail" />
                  Failed quantity<strong>{n(job.inspectionFailed)}</strong>
                </div>
              </div>
              <p className="detail-note">
                Inspection quantities are independent of completion-reported
                good and scrap counts.
              </p>
            </section>
            <section className="drawer-section">
              <div className="drawer-section-title">
                <h3>Block history</h3>
                <span>{hours(job.totalBlockedHours)} total recorded</span>
              </div>
              {detail.blockIntervals.length ? (
                <div className="block-history">
                  {detail.blockIntervals.map((b, i) => (
                    <div key={`${b.eventId}-${i}`}>
                      <span className="block-history-icon">
                        <Clock3 size={14} />
                      </span>
                      <div>
                        <strong>
                          {human(b.reason || "Unspecified reason")}
                        </strong>
                        <small>
                          {date(b.start, true)} →{" "}
                          {b.end ? date(b.end, true) : "Still open at snapshot"}
                        </small>
                        <span className="source-ref">Source: {b.eventId}</span>
                      </div>
                      <b>{hours(b.hours)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="detail-note">
                  No block intervals recorded for this job.
                </p>
              )}
            </section>
            <section className="drawer-section source-section">
              <div className="drawer-section-title">
                <h3>
                  Source events{" "}
                  <span className="count-badge">{detail.events.length}</span>
                </h3>
                <span>Original record evidence</span>
              </div>
              <div className="event-filters">
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  aria-label="Filter source events by type"
                >
                  <option value="all">All event types</option>
                  {[...new Set(detail.events.map((e) => e.event_type))].map(
                    (t) => (
                      <option value={t} key={t}>
                        {human(t)}
                      </option>
                    ),
                  )}
                </select>
                <label>
                  <input
                    type="checkbox"
                    checked={conflictsOnly}
                    onChange={(e) => setConflictsOnly(e.target.checked)}
                  />{" "}
                  Conflicts only
                </label>
              </div>
              <div className="source-events">
                {events
                  .slice(eventPage * 25, (eventPage + 1) * 25)
                  .map((e, i) => (
                    <details
                      className={`source-event ${e.conflict ? "has-conflict" : ""}`}
                      key={`${e.event_id}-${i}`}
                    >
                      <summary>
                        <span className="event-icon">
                          {e.conflict ? (
                            <CircleAlert size={15} />
                          ) : (
                            <Activity size={14} />
                          )}
                        </span>
                        <span>
                          <strong>
                            {human(e.event_type)}
                            {e.conflict && <b>Conflict</b>}
                          </strong>
                          <small>
                            {date(e.timestamp, true)} · {e.event_id}
                          </small>
                        </span>
                        <ChevronDown size={15} />
                      </summary>
                      <div className="event-json">
                        {e.conflict && (
                          <p>
                            Source records share this event ID. Inspect every
                            preserved variant below.
                          </p>
                        )}
                        <pre>{JSON.stringify(e, null, 2)}</pre>
                      </div>
                    </details>
                  ))}
                {!events.length && (
                  <div className="small-empty">
                    No events match this selection.
                  </div>
                )}
              </div>
              {events.length > 25 && (
                <div className="table-footer">
                  <span>
                    {eventPage * 25 + 1}–
                    {Math.min((eventPage + 1) * 25, events.length)} of{" "}
                    {events.length} events
                  </span>
                  <div>
                    <button
                      disabled={!eventPage}
                      onClick={() => setEventPage((p) => p - 1)}
                      aria-label="Previous event page"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      disabled={(eventPage + 1) * 25 >= events.length}
                      onClick={() => setEventPage((p) => p + 1)}
                      aria-label="Next event page"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </section>
            <div className="drawer-footer">
              <ShieldCheck size={14} /> Every modeled value comes from the event
              log. Times shown in UTC.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
