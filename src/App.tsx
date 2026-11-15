import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Factory,
  GitCompareArrows,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  Radio,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";
import type { Job, JobDetail, Overview } from "./types";
import type {
  AnalysisWindow,
  EventViewState,
  TelemetryResponse,
} from "./telemetry-types";
import { formatPacific } from "./time.mjs";
import WindowControls from "./components/WindowControls";
import MachineTelemetry from "./components/MachineTelemetry";
import EventExplorer from "./components/EventExplorer";
import CompareTray from "./components/CompareTray";
import InvestigationNotes from "./components/InvestigationNotes";
import { compareJobs, watchlistCsv } from "./components/job-view-utils.mjs";

type View = "overview" | "machines" | "events" | "jobs" | "quality" | "guide";
type Filters = {
  search: string;
  customer: string;
  material: string;
  machine: string;
  facility: string;
  status: string;
  from: string;
  asOf: string;
  watch: string;
  sort: string;
  eType: string;
  eSearch: string;
  eConflict: string;
  eSort: string;
  eSize: string;
  eFrom: string;
  eTo: string;
  event: string;
};
type SavedView = { id: string; name: string; view: View; filters: Filters };
type WindowedOverview = Overview & { window?: AnalysisWindow };
const emptyFilters: Filters = {
  search: "",
  customer: "",
  material: "",
  machine: "",
  facility: "",
  status: "open",
  from: "",
  asOf: "",
  watch: "",
  sort: "urgency",
  eType: "",
  eSearch: "",
  eConflict: "",
  eSort: "",
  eSize: "",
  eFrom: "",
  eTo: "",
  event: "",
};
const viewNames: Record<View, string> = {
  overview: "Production overview",
  machines: "Machine telemetry",
  events: "Event explorer",
  jobs: "Job register",
  quality: "Quality & reconciliation",
  guide: "Metric reference",
};
const views = Object.keys(viewNames) as View[];
const statuses = ["open", "overdue", "blocked", "completed", "all"];
const sortOptions = [
  ["urgency", "Urgency"],
  ["due", "Due date · earliest"],
  ["age", "Job age · oldest"],
  ["blocked", "Blocked time · longest"],
  ["cycle", "Cycle median · slowest"],
  ["customer", "Customer · A–Z"],
] as const;
const eventKeys = [
  "eType",
  "eSearch",
  "eConflict",
  "eSort",
  "eSize",
  "eFrom",
  "eTo",
  "event",
] as const;
const scopeKeys: (keyof Filters)[] = [
  "search",
  "customer",
  "material",
  "machine",
  "facility",
];
const navItems = [
  { key: "overview", icon: LayoutDashboard, label: "Overview" },
  { key: "machines", icon: Activity, label: "Machines" },
  { key: "events", icon: Radio, label: "Event stream" },
  { key: "jobs", icon: Layers3, label: "Jobs" },
  { key: "quality", icon: ShieldCheck, label: "Quality & data" },
  { key: "guide", icon: BookOpen, label: "Metric guide" },
] as const;
function readLocation() {
  const params = new URLSearchParams(window.location.search),
    requested = params.get("view") as View;
  const view = views.includes(requested) ? requested : "overview";
  const filters = Object.fromEntries(
    Object.entries(emptyFilters).map(([key, value]) => [
      key,
      params.get(key) ?? value,
    ]),
  ) as Filters;
  if (!params.has("status") || !statuses.includes(filters.status))
    filters.status = view === "jobs" ? "all" : "open";
  for (const key of ["from", "asOf"] as const)
    if (
      filters[key] &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        filters[key],
      ) ||
        !Number.isFinite(Date.parse(filters[key])))
    )
      filters[key] = "";
  filters.watch = filters.watch === "1" ? "1" : "";
  if (!sortOptions.some(([key]) => key === filters.sort))
    filters.sort = "urgency";
  return { view, filters, job: params.get("job") || null };
}
function locationFor(view: View, filters: Filters, job: string | null = null) {
  const params = new URLSearchParams({ view });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  if (job) params.set("job", job);
  return `${window.location.pathname}?${params}`;
}
function readStoredList<T>(key: string): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
const n = (value: number) => new Intl.NumberFormat("en-US").format(value);
const pct = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const human = (value: string) =>
  value === "unassigned"
    ? "Unassigned records"
    : value.replaceAll("_", " ").replace(/\b\w/g, (l) => l.toUpperCase());
const date = (value: string | null, includeTime = false) =>
  formatPacific(value, includeTime);
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
  const [view, setView] = useState<View>(() => readLocation().view);
  const [filters, setFilters] = useState<Filters>(() => readLocation().filters);
  const [data, setData] = useState<WindowedOverview | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [loadedQuery, setLoadedQuery] = useState("");
  const [selectedJob, setSelectedJob] = useState<string | null>(
    () => readLocation().job,
  );
  const [pins, setPins] = useState<string[]>(() =>
    readStoredList<string>("factory-triage:pins").filter(
      (value) => typeof value === "string",
    ),
  );
  const [savedViews, setSavedViews] = useState<SavedView[]>(() =>
    readStoredList<SavedView>("factory-triage:views").filter(
      (value) =>
        value &&
        views.includes(value.view) &&
        value.filters &&
        typeof value.name === "string",
    ),
  );
  const [savedName, setSavedName] = useState(""),
    [notice, setNotice] = useState("");
  const [comparedJobs, setComparedJobs] = useState<Job[]>([]);
  const [page, setPage] = useState(0),
    [showFilters, setShowFilters] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    presetMenu = useRef<HTMLDetailsElement>(null);
  const closeJob = useCallback(() => setSelectedJob(null), []);
  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (
        value &&
        key !== "watch" &&
        key !== "sort" &&
        !eventKeys.includes(key as (typeof eventKeys)[number])
      )
        params.set(key, value);
    });
    return params.toString();
  }, [filters]);
  const eventViewState = useMemo(
    () =>
      Object.fromEntries(
        eventKeys.map((key) => [key, filters[key]]),
      ) as EventViewState,
    [
      filters.eType,
      filters.eSearch,
      filters.eConflict,
      filters.eSort,
      filters.eSize,
      filters.eFrom,
      filters.eTo,
      filters.event,
    ],
  );
  const updateEventState = useCallback(
    (state: EventViewState) =>
      setFilters((current) => {
        const next = { ...current };
        eventKeys.forEach((key) => {
          next[key] = state[key] || "";
        });
        return eventKeys.every((key) => next[key] === current[key])
          ? current
          : next;
      }),
    [],
  );
  const changeScope = useCallback(
    (patch: Partial<Filters>) =>
      setFilters((current) => {
        const next = { ...current, ...patch };
        if (
          [...scopeKeys, "from", "asOf"].some(
            (key) =>
              current[key as keyof Filters] !== next[key as keyof Filters],
          )
        ) {
          next.eFrom = "";
          next.eTo = "";
          next.event = "";
        }
        return next;
      }),
    [],
  );
  const requestQuery = useMemo(() => {
    const params = new URLSearchParams(query);
    if (view !== "jobs") params.set("status", "all");
    return params.toString();
  }, [query, view]);
  const telemetryQuery = useMemo(() => {
    const params = new URLSearchParams(query);
    params.set("status", "all");
    return params.toString();
  }, [query]);
  const resultsStale = loadedQuery !== requestQuery;
  const analysisWindow: AnalysisWindow | null = data
    ? (data.window ?? {
        from: data.periodStart,
        to: data.asOf,
        sourceStart: data.periodStart,
        sourceEnd: data.asOf,
        timezone: "America/Los_Angeles",
        isReplay: false,
      })
    : null;
  const displayedJobs = useMemo(() => {
    if (!data) return [];
    return data.jobs
      .filter(
        (job) =>
          (!filters.watch || pins.includes(job.id)) &&
          (view !== "overview" ||
            filters.status === "all" ||
            (filters.status === "open" && job.status !== "completed") ||
            (filters.status === "overdue" && job.overdue) ||
            (filters.status === "blocked" && job.blocked) ||
            (filters.status === "completed" && job.status === "completed")),
      )
      .sort((a, b) => compareJobs(a, b, filters.sort));
  }, [data, view, filters.status, filters.watch, filters.sort, pins]);
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(displayedJobs.length / 12) - 1),
  );
  const activeFilters = scopeKeys.filter((key) => filters[key]).length;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timeout = window.setTimeout(
      () => {
        fetch(`/api/overview?${requestQuery}`, { signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) {
              const problem = await response.json().catch(() => null);
              throw new Error(
                problem?.error ||
                  `Unable to load this analysis window (${response.status}).`,
              );
            }
            return response.json() as Promise<WindowedOverview>;
          })
          .then((result) => {
            if (!controller.signal.aborted) {
              setData(result);
              setLoadedQuery(requestQuery);
              setComparedJobs((current) =>
                current.map(
                  (job) =>
                    result.jobs.find((value) => value.id === job.id) || job,
                ),
              );
            }
          })
          .catch((err) => {
            if (err.name !== "AbortError") setError(err.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      filters.search || filters.asOf || filters.from ? 160 : 0,
    );
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [requestQuery, retry]);
  useEffect(() => {
    setPage(0);
  }, [query, filters.watch, filters.sort, view]);
  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      locationFor(view, filters, selectedJob),
    );
  }, [view, filters, selectedJob]);
  useEffect(() => {
    const restore = () => {
      const next = readLocation();
      setView(next.view);
      setFilters(next.filters);
      setSelectedJob(next.job);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    document.title = `${viewNames[view]} · Factory Triage`;
  }, [view]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    try {
      localStorage.setItem("factory-triage:pins", JSON.stringify(pins));
    } catch {
      setNotice(
        "Browser storage is unavailable. Pins will last for this session.",
      );
    }
  }, [pins]);
  useEffect(() => {
    try {
      localStorage.setItem("factory-triage:views", JSON.stringify(savedViews));
    } catch {
      setNotice(
        "Browser storage is unavailable. Saved views will last for this session.",
      );
    }
  }, [savedViews]);
  useEffect(() => {
    setComparedJobs([]);
  }, [filters.from, filters.asOf]);
  const update = (key: keyof Filters, value: string) =>
    changeScope({ [key]: value });
  const resetScope = () =>
    changeScope({
      search: "",
      customer: "",
      material: "",
      machine: "",
      facility: "",
    });
  const resetAll = () =>
    changeScope({
      search: "",
      customer: "",
      material: "",
      machine: "",
      facility: "",
      watch: "",
      sort: "urgency",
      status: view === "jobs" ? "all" : "open",
    });
  const navigate = (next: View) => {
    if (next === view) return;
    const nextFilters = {
      ...filters,
      status:
        next === "jobs" ? "all" : next === "overview" ? "open" : filters.status,
    };
    window.history.pushState(null, "", locationFor(next, nextFilters));
    setView(next);
    setFilters(nextFilters);
    setSelectedJob(null);
    window.requestAnimationFrame(() => heading.current?.focus());
  };
  const selectMachine = (id: string) => {
    changeScope({ machine: id });
    setView("machines");
    heading.current?.focus();
  };
  const openEvent = (eventId: string) => {
    const nextFilters = {
      ...filters,
      eType: "",
      eSearch: "",
      eConflict: "",
      eSort: "",
      eSize: "",
      eFrom: "",
      eTo: "",
      event: eventId,
    };
    window.history.pushState(null, "", locationFor("events", nextFilters));
    setView("events");
    setFilters(nextFilters);
    setSelectedJob(null);
  };
  const togglePin = (id: string) =>
    setPins((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  const toggleCompare = (job: Job) =>
    setComparedJobs((current) => {
      if (current.some((value) => value.id === job.id))
        return current.filter((value) => value.id !== job.id);
      if (current.length >= 4) {
        setNotice("Compare up to four jobs. Remove one to add another.");
        return current;
      }
      return [...current, job];
    });
  const saveView = () => {
    const name = savedName.trim();
    if (!name) {
      setNotice("Give this view a name before saving.");
      return;
    }
    setSavedViews((current) => [
      ...current.slice(-11),
      {
        id: crypto.randomUUID(),
        name: name.slice(0, 48),
        view,
        filters: { ...filters },
      },
    ]);
    setSavedName("");
    setNotice(`Saved “${name.slice(0, 48)}” in this browser.`);
  };
  const applyView = (saved: SavedView) => {
    const nextFilters = { ...emptyFilters, ...saved.filters };
    window.history.pushState(null, "", locationFor(saved.view, nextFilters));
    setView(saved.view);
    setFilters(nextFilters);
    setSelectedJob(null);
    if (presetMenu.current) presetMenu.current.open = false;
  };
  const shareView = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(
          locationFor(view, { ...filters, watch: "" }, selectedJob),
          window.location.origin,
        ).href,
      );
      setNotice(
        "Copied view filters and analysis window. Watchlist pins stay in this browser.",
      );
    } catch {
      setNotice(
        "Select and copy the URL from your browser’s address bar to share this view.",
      );
    }
  };
  const exportParams = new URLSearchParams(
    view === "quality" ? requestQuery : query,
  );
  const exportWatchlist =
    !!filters.watch && (view === "overview" || view === "jobs");
  return (
    <div className={`app-shell ${comparedJobs.length ? "has-comparison" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar" inert={selectedJob ? true : undefined}>
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
            FACTORY<span className="brand-light">TRIAGE</span>
            <small>OPERATIONS / INTELLIGENCE</small>
          </span>
        </button>
        <div className="workspace-label">
          <span className="workspace-icon">
            <Factory size={15} />
          </span>
          <span>
            Manufacturing workspace
            <small>
              <span className="tiny-dot" /> HISTORICAL DATASET
            </small>
          </span>
        </div>
        <p className="nav-label">EXPLORE</p>
        <nav aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={view === item.key ? "nav-item active" : "nav-item"}
              aria-current={view === item.key ? "page" : undefined}
              onClick={() => navigate(item.key)}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
              {item.key === "events" &&
                data &&
                typeof data.windowEventCount === "number" && (
                  <b>{n(data.windowEventCount)}</b>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="section-label">DATA PROVENANCE</div>
          <strong>Synthetic manufacturing</strong>
          <p>
            {data
              ? `${date(analysisWindow?.sourceStart || data.periodStart)} – ${date(analysisWindow?.sourceEnd || data.asOf)}`
              : "Reading source records…"}
          </p>
          <span>
            Every signal links to its source.
            <br />
            Recorded history. No live feed.
          </span>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">FT</span>
          <span>
            Factory Triage<small>Pacific time · source evidence</small>
          </span>
          <ShieldCheck size={15} />
        </div>
      </aside>
      <div className="main-shell" inert={selectedJob ? true : undefined}>
        <header className="topbar">
          <div className="breadcrumbs">
            <span className="workspace-crumb">WORKSPACE</span>
            <ChevronRight size={13} />
            <strong>{viewNames[view]}</strong>
          </div>
          <div className="command-actions">
            <details className="saved-menu" ref={presetMenu}>
              <summary>
                <Bookmark size={14} /> Saved views <ChevronDown size={12} />
              </summary>
              <div className="saved-menu-popover">
                <div className="section-label">QUICK VIEWS</div>
                {[
                  ["Overdue jobs", "overdue"],
                  ["Blocked jobs", "blocked"],
                ].map(([name, status]) => (
                  <button
                    key={status}
                    onClick={() =>
                      applyView({
                        id: status,
                        name,
                        view: "jobs",
                        filters: { ...filters, status, watch: "" },
                      })
                    }
                  >
                    {name}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
                <button
                  onClick={() => {
                    navigate("quality");
                    if (presetMenu.current) presetMenu.current.open = false;
                  }}
                >
                  Quality review
                  <ArrowUpRight size={13} />
                </button>
                <div className="saved-divider" />
                <div className="section-label">SAVED IN THIS BROWSER</div>
                {savedViews.map((saved) => (
                  <div className="saved-item" key={saved.id}>
                    <button onClick={() => applyView(saved)}>
                      {saved.name}
                      <small>{viewNames[saved.view]}</small>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete saved view ${saved.name}`}
                      onClick={() =>
                        setSavedViews((current) =>
                          current.filter((value) => value.id !== saved.id),
                        )
                      }
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {!savedViews.length && (
                  <p className="saved-empty">
                    Save your current filters and time window.
                  </p>
                )}
                <div className="save-current">
                  <input
                    aria-label="Saved view name"
                    placeholder="Name this view…"
                    maxLength={48}
                    value={savedName}
                    onChange={(event) => setSavedName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveView();
                    }}
                  />
                  <button className="button" onClick={saveView}>
                    Save
                  </button>
                </div>
              </div>
            </details>
            <button className="button share-button" onClick={shareView}>
              <Copy size={13} /> Share view
            </button>
            <span className="source-badge">
              <span className="tiny-dot" /> SYNTHETIC
            </span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">MANUFACTURING / ANALYSIS</div>
              <h1 ref={heading} tabIndex={-1}>
                {viewNames[view]}
              </h1>
              <p>
                {view === "overview"
                  ? "Production state, recorded signals, and the jobs that need attention."
                  : view === "machines"
                    ? "Inspect cycle behavior and recorded activity across the fleet."
                    : view === "events"
                      ? "Search the source timeline and inspect every recorded event."
                      : view === "jobs"
                        ? "Investigate lifecycle state, deadlines, quantities, and source records."
                        : view === "quality"
                          ? "Reconcile reported quantities and inspect every source exception."
                          : "Definitions, data lineage, and the limits of the source log."}
              </p>
            </div>
            <div className="heading-meta">
              <span className="mode-badge">
                <HistoryIcon replay={analysisWindow?.isReplay || false} />
                {analysisWindow?.isReplay ? "REPLAY" : "HISTORICAL SNAPSHOT"}
              </span>
              {data && (
                <span className="snapshot">{date(data.asOf, true)}</span>
              )}
            </div>
          </div>
          {analysisWindow && (
            <WindowControls
              window={analysisWindow}
              value={{ from: filters.from, asOf: filters.asOf }}
              onChange={(next) => changeScope(next)}
            />
          )}
          {data && view !== "guide" && (
            <section
              className="global-scope"
              aria-label="Global analysis filters"
            >
              <div className="scope-top">
                <label className="search-box">
                  <Search size={15} />
                  <input
                    ref={searchInput}
                    aria-label="Search jobs, parts, or customers"
                    placeholder="Search jobs, parts, customers…"
                    value={filters.search}
                    onChange={(event) => update("search", event.target.value)}
                  />
                  {filters.search ? (
                    <button
                      aria-label="Clear search"
                      onClick={() => update("search", "")}
                    >
                      <X size={12} />
                    </button>
                  ) : (
                    <kbd>⌘ K</kbd>
                  )}
                </label>
                <button
                  className={`button filter-button ${activeFilters ? "filter-active" : ""}`}
                  aria-expanded={showFilters}
                  aria-controls="global-filter-fields"
                  onClick={() => setShowFilters((value) => !value)}
                >
                  <SlidersHorizontal size={14} /> Scope{" "}
                  {activeFilters > 0 && <b>{activeFilters}</b>}
                  <ChevronDown size={12} />
                </button>
                {filters.machine && (
                  <button
                    className="machine-scope-pill"
                    onClick={() => update("machine", "")}
                  >
                    <Activity size={12} />
                    {filters.machine === "unassigned"
                      ? "Unassigned records"
                      : filters.machine}
                    <X size={12} />
                  </button>
                )}
                <span className="scope-summary">
                  {n(data.stats.jobs)} jobs in scope
                </span>
                {["overview", "jobs", "quality"].includes(view) &&
                  (exportWatchlist ? (
                    <button
                      className="button export-button"
                      disabled={
                        resultsStale || loading || !displayedJobs.length
                      }
                      onClick={() => {
                        downloadWatchlist(
                          displayedJobs,
                          analysisWindow?.to || data.asOf,
                        );
                        setNotice(
                          `Exported ${displayedJobs.length} pinned ${displayedJobs.length === 1 ? "job" : "jobs"} in this selection.`,
                        );
                      }}
                    >
                      <ArrowDownToLine size={14} />
                      Export watchlist
                    </button>
                  ) : (
                    <a
                      className="button export-button"
                      href={`/api/export?${exportParams}`}
                      download
                      title="Export modeled jobs matching this scope"
                    >
                      <ArrowDownToLine size={14} />
                      Export CSV
                    </a>
                  ))}
              </div>
              {showFilters && (
                <div className="filter-row" id="global-filter-fields">
                  <FilterFields
                    filters={filters}
                    options={data.filters}
                    update={update}
                  />
                  <button className="text-button" onClick={resetScope}>
                    Clear scope
                  </button>
                </div>
              )}
              <ScopeChips
                filters={filters}
                update={update}
                reset={resetScope}
              />
            </section>
          )}
          {error && (
            <div className="error-state" role="alert">
              <CircleAlert size={20} />
              <div>
                <strong>This selection could not be loaded.</strong>
                <p>{error}</p>
              </div>
              <button
                className="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Try again
              </button>
              {activeFilters > 0 && (
                <button className="button" onClick={resetScope}>
                  Clear scope
                </button>
              )}
              {(filters.from || filters.asOf) && (
                <button
                  className="button"
                  onClick={() => changeScope({ from: "", asOf: "" })}
                >
                  Reset analysis window
                </button>
              )}
            </div>
          )}
          {!data && loading && (
            <div className="loading-state">
              <LoaderCircle className="spin" size={22} />
              <strong>Reading source telemetry</strong>
              <span>
                Reconstructing the production state and event evidence.
              </span>
            </div>
          )}
          {data && !(error && resultsStale) && (
            <div
              className={
                loading || resultsStale ? "content refreshing" : "content"
              }
              aria-busy={loading || resultsStale}
            >
              <div className="request-status" role="status" aria-live="polite">
                {loading || resultsStale ? (
                  <>
                    <LoaderCircle size={13} className="spin" /> Updating
                    analysis window…
                  </>
                ) : (
                  ""
                )}
              </div>
              {(view === "overview" || view === "jobs") && (
                <>
                  <div
                    className="stat-grid"
                    inert={resultsStale ? true : undefined}
                  >
                    <Stat
                      label="Open jobs"
                      value={n(data.stats.open)}
                      detail={`${n(data.stats.jobs)} jobs in selected scope`}
                      icon={<Layers3 size={16} />}
                    />
                    <Stat
                      label="Overdue"
                      value={n(data.stats.overdueOpen)}
                      detail="Past due at replay time"
                      icon={<Clock3 size={16} />}
                      tone="amber"
                      onClick={() => update("status", "overdue")}
                    />
                    <Stat
                      label="Blocked"
                      value={n(data.stats.blockedOpen)}
                      detail="Unresolved recorded blocks"
                      icon={<CircleAlert size={16} />}
                      tone="red"
                      onClick={() => update("status", "blocked")}
                    />
                    <Stat
                      label="On-time completion"
                      value={pct(data.stats.onTimeRate)}
                      detail={`${n(data.stats.completed)} completed · ${n(data.stats.lateCompleted)} late`}
                      icon={<CheckCheck size={16} />}
                    />
                  </div>
                  {view === "overview" && (
                    <OverviewTelemetry
                      query={telemetryQuery}
                      onOpenJob={setSelectedJob}
                      onSelectMachine={selectMachine}
                    />
                  )}
                  <section className="panel queue-panel">
                    <div className="panel-heading">
                      <div>
                        <div className="section-label">
                          {view === "overview"
                            ? "OPERATIONAL EXCEPTIONS"
                            : "PRODUCTION REGISTER"}
                        </div>
                        <h2>
                          {view === "overview"
                            ? "Attention queue"
                            : "Job register"}
                          <span className="count-badge">
                            {n(displayedJobs.length)}
                          </span>
                        </h2>
                      </div>
                      <div className="queue-actions">
                        <button
                          className={
                            filters.watch
                              ? "button watch-toggle selected"
                              : "button watch-toggle"
                          }
                          aria-pressed={!!filters.watch}
                          onClick={() =>
                            update("watch", filters.watch ? "" : "1")
                          }
                        >
                          <Star
                            size={13}
                            fill={filters.watch ? "currentColor" : "none"}
                          />{" "}
                          Watchlist <b>{pins.length}</b>
                        </button>
                        <span className="panel-subtitle">
                          {view === "overview"
                            ? `Sorted by ${sortOptions.find(([key]) => key === filters.sort)?.[1].toLowerCase() || "urgency"}`
                            : "Select up to 4 jobs to compare"}
                        </span>
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
                            aria-pressed={filters.status === value}
                            className={
                              filters.status === value ? "selected" : ""
                            }
                            onClick={() => update("status", value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <label className="sort-control">
                        <span>Sort</span>
                        <select
                          aria-label="Sort jobs"
                          value={filters.sort}
                          onChange={(event) =>
                            update("sort", event.target.value)
                          }
                        >
                          {sortOptions.map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="queue-scope-note">
                        {view === "overview"
                          ? "Status & watchlist filter this queue. Summaries include every status."
                          : "Watchlist filters this list. Pins are saved in this browser."}
                      </span>
                    </div>
                    {displayedJobs.length ? (
                      <>
                        <div
                          className="table-scroll job-table-region"
                          role="region"
                          aria-label="Scrollable job register"
                          tabIndex={0}
                        >
                          <table className="jobs-table">
                            <thead>
                              <tr>
                                <th aria-label="Compare selection">
                                  <GitCompareArrows size={13} />
                                </th>
                                <th>Job / part</th>
                                <th>Status</th>
                                <th>Customer / material</th>
                                <th>Target due · Pacific</th>
                                <th>Good / target</th>
                                <th>Attention</th>
                                <th aria-label="Watchlist pin">
                                  <Star size={12} />
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {displayedJobs
                                .slice(safePage * 12, (safePage + 1) * 12)
                                .map((job) => (
                                  <tr
                                    key={job.id}
                                    className={
                                      comparedJobs.some(
                                        (value) => value.id === job.id,
                                      )
                                        ? "compare-selected"
                                        : ""
                                    }
                                    onClick={() => {
                                      if (!resultsStale) setSelectedJob(job.id);
                                    }}
                                  >
                                    <td
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                    >
                                      <input
                                        type="checkbox"
                                        aria-label={`Compare ${job.id}`}
                                        checked={comparedJobs.some(
                                          (value) => value.id === job.id,
                                        )}
                                        disabled={resultsStale}
                                        onChange={() => toggleCompare(job)}
                                      />
                                    </td>
                                    <td>
                                      <button
                                        className="job-link"
                                        disabled={resultsStale}
                                        aria-label={`Inspect job ${job.id}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setSelectedJob(job.id);
                                        }}
                                      >
                                        {job.id}
                                      </button>
                                      <small className="job-part-meta">
                                        <span>{job.partId}</span>
                                        <span
                                          className={`job-priority ${["urgent", "critical", "high"].includes(job.priority) ? "elevated" : ""}`}
                                          aria-label={`${human(job.priority)} priority`}
                                        >
                                          {human(job.priority)}
                                        </span>
                                      </small>
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
                                            : `${human(job.priority)} priority`}
                                      </small>
                                    </td>
                                    <td>
                                      <strong className="mono">
                                        {job.goodQuantity === null
                                          ? "—"
                                          : n(job.goodQuantity)}
                                        <span className="muted">
                                          {" "}
                                          / {n(job.targetQuantity)}
                                        </span>
                                      </strong>
                                      <small>
                                        {job.machineIds.map((id) => (
                                          <button
                                            key={id}
                                            className="inline-machine"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              selectMachine(id);
                                            }}
                                          >
                                            {id}
                                          </button>
                                        ))}
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
                                      <button
                                        className={`icon-button pin-button ${pins.includes(job.id) ? "pinned" : ""}`}
                                        aria-label={`${pins.includes(job.id) ? "Unpin" : "Pin"} ${job.id}`}
                                        aria-pressed={pins.includes(job.id)}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          togglePin(job.id);
                                        }}
                                      >
                                        <Star
                                          size={14}
                                          fill={
                                            pins.includes(job.id)
                                              ? "currentColor"
                                              : "none"
                                          }
                                        />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="table-footer">
                          <span>
                            {n(safePage * 12 + 1)}–
                            {n(
                              Math.min(
                                (safePage + 1) * 12,
                                displayedJobs.length,
                              ),
                            )}{" "}
                            / {n(displayedJobs.length)} jobs
                          </span>
                          <div>
                            <button
                              aria-label="Previous page"
                              disabled={safePage === 0}
                              onClick={() => setPage(safePage - 1)}
                            >
                              <ChevronLeft size={15} />
                            </button>
                            <span>
                              {safePage + 1} /{" "}
                              {Math.ceil(displayedJobs.length / 12)}
                            </span>
                            <button
                              aria-label="Next page"
                              disabled={
                                (safePage + 1) * 12 >= displayedJobs.length
                              }
                              onClick={() => setPage(safePage + 1)}
                            >
                              <ChevronRight size={15} />
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">
                        <Search size={24} />
                        <h3>
                          {filters.watch
                            ? "No pinned jobs in this selection"
                            : "No jobs match this selection"}
                        </h3>
                        <p>
                          {filters.watch
                            ? "Pin jobs with the star icon. Your watchlist is private to this browser."
                            : "Adjust the filters or widen the analysis window."}
                        </p>
                        <button className="button" onClick={resetAll}>
                          Reset queue filters
                        </button>
                      </div>
                    )}
                  </section>
                  <div className="page-footnote">
                    <ShieldCheck size={13} />
                    {n(data.dataQuality.uniqueEvents)} supporting source events
                    through replay time · Pacific time · quantities retain
                    source uncertainty.
                    <button onClick={() => navigate("guide")}>
                      Metric definitions
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </>
              )}
              {view === "machines" && (
                <MachineTelemetry
                  query={telemetryQuery}
                  onOpenJob={setSelectedJob}
                  onSelectMachine={selectMachine}
                  onOpenEvent={openEvent}
                  onInspectWindow={(from, asOf) => changeScope({ from, asOf })}
                />
              )}
              {view === "events" && (
                <EventExplorer
                  query={telemetryQuery}
                  onOpenJob={setSelectedJob}
                  onSelectMachine={selectMachine}
                  viewState={eventViewState}
                  onStateChange={updateEventState}
                />
              )}
              {view === "quality" && (
                <div inert={resultsStale ? true : undefined}>
                  <Quality data={data} selectJob={setSelectedJob} />
                </div>
              )}
              {view === "guide" && <Guide data={data} />}
              {comparedJobs.length > 0 && (
                <CompareTray
                  jobs={comparedJobs}
                  onOpenJob={setSelectedJob}
                  onRemove={(id) =>
                    setComparedJobs((current) =>
                      current.filter((job) => job.id !== id),
                    )
                  }
                  onClear={() => setComparedJobs([])}
                />
              )}
            </div>
          )}
        </main>
      </div>
      {comparedJobs.length > 0 && (
        <div className="comparison-dock" inert={selectedJob ? true : undefined}>
          <GitCompareArrows size={16} />
          <strong>{comparedJobs.length} jobs selected</strong>
          <div className="comparison-dock-jobs">
            {comparedJobs.map((job) => (
              <button
                key={job.id}
                aria-label={`Remove ${job.id} from comparison`}
                onClick={() =>
                  setComparedJobs((current) =>
                    current.filter((value) => value.id !== job.id),
                  )
                }
              >
                {job.id}
                <X size={11} />
              </button>
            ))}
          </div>
          <button
            className="button primary"
            onClick={() =>
              document.querySelector(".compare-workspace")?.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "auto"
                  : "smooth",
                block: "start",
              })
            }
          >
            Inspect comparison
            <ArrowRight size={12} />
          </button>
          <button
            className="icon-button"
            aria-label="Clear comparison"
            onClick={() => setComparedJobs([])}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {selectedJob && (
        <JobDrawer
          key={`${selectedJob}:${filters.asOf}`}
          id={selectedJob}
          asOf={filters.asOf || data?.asOf || ""}
          onClose={closeJob}
        />
      )}
    </div>
  );
}
function downloadWatchlist(jobs: Job[], snapshotAsOf: string) {
  const url = URL.createObjectURL(
    new Blob([watchlistCsv(jobs, snapshotAsOf)], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `factory-triage-watchlist.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function HistoryIcon({ replay }: { replay: boolean }) {
  return replay ? <Clock3 size={11} /> : <Radio size={11} />;
}

function OverviewTelemetry({
  query,
  onOpenJob,
  onSelectMachine,
}: {
  query: string;
  onOpenJob: (id: string) => void;
  onSelectMachine: (id: string) => void;
}) {
  const [data, setData] = useState<TelemetryResponse | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [loaded, setLoaded] = useState(""),
    [hover, setHover] = useState<number | null>(null);
  const [plotWidth, setPlotWidth] = useState(700);
  const plotContainer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!plotContainer.current) return;
    const observer = new ResizeObserver((entries) =>
      setPlotWidth(Math.max(300, entries[0].contentRect.width)),
    );
    observer.observe(plotContainer.current);
    return () => observer.disconnect();
  }, [Boolean(data)]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch(`/api/telemetry?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Telemetry could not be loaded.");
        return response.json() as Promise<TelemetryResponse>;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoaded(query);
          setHover(null);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [query, retry]);
  if (error)
    return (
      <div className="error-state telemetry-error">
        <CircleAlert size={17} />
        {error}
        <button
          className="button"
          onClick={() => setRetry((value) => value + 1)}
        >
          Try again
        </button>
      </div>
    );
  if (!data)
    return (
      <section className="panel telemetry-loading">
        <LoaderCircle size={18} className="spin" /> Loading recorded signals…
      </section>
    );
  const series = data.series,
    maxCycles = Math.max(1, ...series.map((bucket) => bucket.cycles)),
    maxSeconds = Math.max(
      1,
      ...series.map((bucket) => bucket.p50CycleSeconds || 0),
    );
  const width = plotWidth,
    height = 176,
    plotSpan = width - 84,
    x = (index: number) =>
      42 + (index * plotSpan) / Math.max(1, series.length - 1),
    yCycles = (value: number) => 150 - (value / maxCycles) * 125,
    ySeconds = (value: number) => 150 - (value / maxSeconds) * 125;
  const line = series
    .map((bucket, index) =>
      bucket.p50CycleSeconds === null
        ? ""
        : `${index === 0 || series[index - 1].p50CycleSeconds === null ? "M" : "L"}${x(index)},${ySeconds(bucket.p50CycleSeconds)}`,
    )
    .join(" ");
  const selected = hover === null ? null : series[hover];
  const maxStage = Math.max(
    1,
    data.flow.stages.reduce((sum, stage) => sum + stage.jobs, 0),
  );
  return (
    <div
      className={
        loaded !== query
          ? "overview-telemetry refreshing"
          : "overview-telemetry"
      }
      aria-busy={loaded !== query}
      inert={loaded !== query ? true : undefined}
    >
      <div className="telemetry-microstats">
        <span>
          <i />
          RECORDED TELEMETRY
        </span>
        <div>
          Cycle events <strong>{n(data.summary.cycles)}</strong>
        </div>
        <div>
          Reported units <strong>{n(data.summary.reportedUnits)}</strong>
        </div>
        <div>
          Median cycle{" "}
          <strong>
            {data.summary.p50CycleSeconds === null
              ? "—"
              : `${Math.round(data.summary.p50CycleSeconds)}s`}
          </strong>
        </div>
        <div>
          Recorded signals <strong>{n(data.summary.recordedSignals)}</strong>
        </div>
      </div>
      <div className="telemetry-overview-grid">
        <section className="panel signal-chart-panel">
          <div className="panel-heading">
            <div>
              <div className="section-label">TIME SERIES / PACIFIC</div>
              <h2>Production signal</h2>
            </div>
            <div className="chart-legend">
              <span>
                <i className="cyan" />
                Cycle events
              </span>
              <span>
                <i className="amber" />
                P50 cycle duration
              </span>
            </div>
          </div>
          <div className="signal-chart-readout">
            {selected ? (
              <>
                <strong>{date(selected.timestamp, true)}</strong>
                <span>{n(selected.cycles)} cycle events</span>
                <span>
                  {selected.p50CycleSeconds === null
                    ? "No cycle duration"
                    : `${Math.round(selected.p50CycleSeconds)}s median cycle`}
                </span>
              </>
            ) : (
              <>
                <strong>
                  {date(data.window.from)} — {date(data.window.to)}
                </strong>
                <span>Hover to inspect a time bucket</span>
              </>
            )}
          </div>
          <div className="overview-plot-container" ref={plotContainer}>
            <svg
              className="overview-signal-chart"
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={`Recorded production telemetry: ${n(data.summary.cycles)} cycle events, median duration ${data.summary.p50CycleSeconds ?? "unknown"} seconds.`}
              onMouseMove={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const plotX =
                  ((event.clientX - bounds.left) / bounds.width) * width;
                setHover(
                  Math.max(
                    0,
                    Math.min(
                      series.length - 1,
                      Math.round(
                        ((plotX - 42) / plotSpan) *
                          Math.max(1, series.length - 1),
                      ),
                    ),
                  ),
                );
              }}
              onMouseLeave={() => setHover(null)}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                <g key={fraction}>
                  <line
                    x1="38"
                    x2={width - 36}
                    y1={150 - fraction * 125}
                    y2={150 - fraction * 125}
                    className="plot-grid"
                  />
                  <text
                    x="30"
                    y={154 - fraction * 125}
                    textAnchor="end"
                    className="plot-axis"
                  >
                    {Math.round(maxCycles * fraction)}
                  </text>
                  <text
                    x={width - 28}
                    y={154 - fraction * 125}
                    className="plot-axis"
                  >
                    {Math.round(maxSeconds * fraction)}s
                  </text>
                </g>
              ))}
              {series.map((bucket, index) => (
                <rect
                  key={bucket.timestamp}
                  x={x(index) - Math.min(8, 330 / Math.max(1, series.length))}
                  y={yCycles(bucket.cycles)}
                  width={Math.min(16, 660 / Math.max(1, series.length))}
                  height={Math.max(0, 150 - yCycles(bucket.cycles))}
                  className={
                    hover === index ? "signal-bar hovered" : "signal-bar"
                  }
                >
                  <title>
                    {date(bucket.timestamp, true)} · {bucket.cycles} cycles
                  </title>
                </rect>
              ))}
              <path d={line} fill="none" className="signal-duration" />
              {hover !== null && series[hover] && (
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1="20"
                  y2="151"
                  className="plot-crosshair"
                />
              )}
              <text x="42" y="170" className="plot-axis">
                {date(series[0]?.timestamp || data.window.from)}
              </text>
              <text
                x={width - 42}
                y="170"
                textAnchor="end"
                className="plot-axis"
              >
                {date(series.at(-1)?.timestamp || data.window.to)}
              </text>
            </svg>
          </div>
          <div className="panel-note">
            <Activity size={12} /> Recorded cycle events and durations. Bars and
            line use independent labeled scales.
          </div>
        </section>
        <section className="panel flow-panel">
          <div className="panel-heading">
            <div>
              <div className="section-label">LIFECYCLE STATE</div>
              <h2>Job state distribution</h2>
            </div>
            <GitCompareArrows size={16} />
          </div>
          <div className="flow-stages">
            {data.flow.stages.map((stage, index) => (
              <div className="flow-stage" key={stage.key}>
                <span className="flow-index">0{index + 1}</span>
                <div>
                  <span>{stage.label}</span>
                  <div className="flow-track">
                    <i style={{ width: `${(stage.jobs / maxStage) * 100}%` }} />
                  </div>
                </div>
                <strong>{stage.jobs}</strong>
              </div>
            ))}
          </div>
          <div className="flow-readouts">
            <div>
              <span>Lead time P50</span>
              <strong>
                {data.flow.leadHours.p50 === null
                  ? "—"
                  : hours(data.flow.leadHours.p50)}
              </strong>
            </div>
            <div>
              <span>Queue P50</span>
              <strong>
                {data.flow.queueHours.p50 === null
                  ? "—"
                  : hours(data.flow.queueHours.p50)}
              </strong>
            </div>
          </div>
          <div className="panel-note">
            Exclusive states at replay time. Each job appears once.
          </div>
        </section>
      </div>
      <section className="panel recorded-signals">
        <div className="panel-heading">
          <div>
            <div className="section-label">SOURCE-RECORDED EXCEPTIONS</div>
            <h2>
              Signals to investigate
              <span className="count-badge">{data.signals.length}</span>
            </h2>
          </div>
          <span className="panel-subtitle">
            Recorded observations · no inferred root cause
          </span>
        </div>
        <div className="recorded-signal-list">
          {data.signals.slice(0, 5).map((signal) => (
            <div
              className={`recorded-signal ${signal.severity}`}
              key={signal.id}
            >
              <span className="signal-severity">
                <CircleAlert size={15} />
              </span>
              <div className="signal-copy">
                <strong>{signal.title}</strong>
                <p>{signal.detail}</p>
              </div>
              <div className="signal-entities">
                {signal.machineId && (
                  <button onClick={() => onSelectMachine(signal.machineId!)}>
                    <Activity size={11} />
                    {signal.machineId}
                  </button>
                )}
                <button
                  className="signal-job"
                  onClick={() => onOpenJob(signal.jobId)}
                >
                  {signal.jobId}
                  <ArrowUpRight size={12} />
                </button>
              </div>
              <time>{date(signal.timestamp, true)}</time>
            </div>
          ))}
          {!data.signals.length && (
            <div className="small-empty">
              <ShieldCheck size={18} />
              No recorded exceptions in this selection.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function FilterFields({
  filters,
  options,
  update,
}: {
  filters: Filters;
  options: Overview["filters"];
  update: (key: keyof Filters, value: string) => void;
}) {
  return (
    <>
      {(
        [
          ["customer", "Customer", "customers", options.customers],
          ["material", "Material", "materials", options.materials],
          ["machine", "Machine", "machines", options.machines],
          ["facility", "Facility", "facilities", options.facilities],
        ] as [keyof Filters, string, string, string[]][]
      ).map(([key, label, plural, values]) => (
        <label key={key}>
          {label}
          <select
            value={filters[key]}
            onChange={(event) => update(key, event.target.value)}
          >
            <option value="">All {plural}</option>
            {filters[key] && !values.includes(filters[key]) && (
              <option value={filters[key]}>{filters[key]} (not found)</option>
            )}
            {values.map((value) => (
              <option key={value} value={value}>
                {human(value)}
              </option>
            ))}
          </select>
        </label>
      ))}
    </>
  );
}
function ScopeChips({
  filters,
  update,
  reset,
}: {
  filters: Filters;
  update: (key: keyof Filters, value: string) => void;
  reset: () => void;
}) {
  const selected = Object.entries(filters).filter(
    ([key, value]) => scopeKeys.includes(key as keyof Filters) && value,
  ) as [keyof Filters, string][];
  if (!selected.length) return null;
  return (
    <div className="scope-chips" aria-label="Active scope filters">
      {selected.map(([key, value]) => (
        <button
          key={key}
          onClick={() => update(key, "")}
          aria-label={`Remove ${key} filter: ${value}`}
        >
          <span>
            {key === "search" ? "Search" : human(key)}: <strong>{value}</strong>
          </span>
          <X size={12} />
        </button>
      ))}
      <button className="clear-scope" onClick={reset}>
        Clear scope
      </button>
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
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`stat-card ${tone}`} onClick={onClick}>
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
    </Tag>
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
      <div className="quality-provenance-note">
        <ShieldCheck size={13} /> Supporting records include earlier events
        needed to reconstruct active jobs through replay time. Telemetry and
        event feeds count only the selected window.
      </div>
      <div className="stat-grid">
        <Stat
          label="Supporting source records"
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
                  {issue.jobIds.map((id) => (
                    <button key={id} onClick={() => selectJob(id)}>
                      {id}
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
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
function Guide({ data }: { data: WindowedOverview }) {
  const definitions = [
    [
      "Replay time & analysis window",
      "Open-job ages, lifecycle state, and overdue calculations use the selected replay time. The default is the last source timestamp. The analysis window includes jobs active at any point in that window. Human-readable timestamps use Pacific time with the appropriate PDT or PST offset. Raw source JSON retains its original UTC timestamps.",
    ],
    [
      "Open and overdue jobs",
      "Open jobs have no recorded job_completed event. An open job is overdue when its target due time is earlier than the selected replay time. Completed jobs retain a separate late-completion flag.",
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
      "Recorded job_blocked and job_unblocked events define blocked intervals. Still-open intervals end at the selected replay time for duration calculations; a terminal completion closes an unresolved block. Block reasons are recorded labels, not inferred root causes.",
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
      "Unassigned records",
      "Unassigned records groups events whose machine_id is null, including expected creation and completion records. It is a source association, not a physical machine. Filtering it may retain many jobs with unassigned lifecycle events.",
    ],
    [
      "Filters and scope",
      "Customer, material, machine, facility, and time-window filters define the shared scope. Overview summaries and telemetry include every job status; status tabs filter the queue and CSV export. Watchlist pins filter the local list, and are saved only in this browser. All jobs summaries follow status filters. Quality checks include every status in scope. A replay shows only source events recorded at or before its cursor.",
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
            <span>Analysis window</span>
            <strong>
              {date(data.periodStart)} – {date(data.asOf)}
            </strong>
          </div>
          {data.window && (
            <div className="guide-datum">
              <span>Source coverage</span>
              <strong>
                {date(data.window.sourceStart)} – {date(data.window.sourceEnd)}
              </strong>
            </div>
          )}
          <div className="guide-datum">
            <span>Display timezone</span>
            <strong>Pacific · America/Los_Angeles</strong>
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
function JobDrawer({
  id,
  asOf,
  onClose,
}: {
  id: string;
  asOf: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [eventType, setEventType] = useState("all");
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [eventPage, setEventPage] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError("");
    fetch(
      `/api/jobs/${encodeURIComponent(id)}${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ""}`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            r.status === 404
              ? "This job was not found. Check the job ID in the shared link."
              : `Job could not be loaded (${r.status}). Please try again.`,
          );
        return r.json();
      })
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [id, asOf, retry]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const candidates = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], select, input, textarea, summary, [tabindex="0"]',
        );
        const elements = candidates
          ? [...candidates].filter(
              (element) => element.getClientRects().length > 0,
            )
          : [];
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !dialog.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !dialog.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = scroll;
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLElement>("main h1")?.focus();
    };
  }, [onClose]);
  useEffect(() => setEventPage(0), [eventType, conflictsOnly]);
  const job = detail?.job;
  const snapshotAsOf =
    (detail as (JobDetail & { asOf?: string }) | null)?.asOf || asOf;
  const events =
    detail?.events.filter(
      (e) =>
        (eventType === "all" || e.event_type === eventType) &&
        (!conflictsOnly || e.conflict),
    ) ?? [];
  const safeEventPage = Math.min(
    eventPage,
    Math.max(0, Math.ceil(events.length / 25) - 1),
  );
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
            <CircleAlert size={20} />
            <p>{error}</p>
            <button
              className="button secondary"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again
            </button>
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
                      ? `${hours(job.overdueHours)} overdue at replay time`
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
            <InvestigationNotes jobId={id} asOf={snapshotAsOf} />
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
                          {b.end
                            ? date(b.end, true)
                            : "Still open at replay time"}
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
                  .slice(safeEventPage * 25, (safeEventPage + 1) * 25)
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
                        <div className="original-record-label">
                          ORIGINAL SOURCE JSON · TIMESTAMPS PRESERVED
                        </div>
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
                    {safeEventPage * 25 + 1}–
                    {Math.min((safeEventPage + 1) * 25, events.length)} of{" "}
                    {events.length} events
                  </span>
                  <div>
                    <button
                      disabled={!safeEventPage}
                      onClick={() => setEventPage(safeEventPage - 1)}
                      aria-label="Previous event page"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      disabled={(safeEventPage + 1) * 25 >= events.length}
                      onClick={() => setEventPage(safeEventPage + 1)}
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
              log. Times shown in Pacific time. Original timestamps are
              preserved in source JSON.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
