import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpDown,
  Braces,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleAlert,
  Copy,
  Filter,
  Layers3,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import type {
  EventsResponse,
  EventViewState,
  ExplorerProps,
} from "../telemetry-types";
import type { ManufacturingEvent } from "../types";
import { formatPacific, formatPacificTime, pacificDay } from "../time.mjs";
import {
  normalizeEventViewState,
  eventParameters,
  eventExportParameters,
  eventBucketBounds,
} from "../event-state.mjs";
import "./EventExplorer.css";

type SourceEvent = ManufacturingEvent & {
  sourceLineNumbers?: number[];
  exactDuplicateCount?: number;
  variantSourceLineNumbers?: number[][];
};
type BucketWindow = { from: string; to: string; label: string };
type Sort = "timestamp_desc" | "timestamp_asc" | "type_asc" | "quantity_desc";
type ExplorerState = Required<EventViewState>;

const number = (value: number) => new Intl.NumberFormat("en-US").format(value);
const human = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const eventTone = (type: string) =>
  type === "inspection_failed" || type === "job_blocked"
    ? "warning"
    : type === "inspection_passed" ||
        type === "job_completed" ||
        type === "job_unblocked"
      ? "positive"
      : type === "sensor_glitch" || type === "job_hold"
        ? "notice"
        : "neutral";

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

export default function EventExplorer({
  query,
  onOpenJob,
  onSelectMachine,
  viewState,
  onStateChange,
}: ExplorerProps) {
  const [localViewState, setLocalViewState] = useState<ExplorerState>(() =>
    normalizeEventViewState(viewState),
  );
  const controlled = viewState !== undefined;
  const currentViewState = useMemo(
    () => normalizeEventViewState(viewState ?? localViewState),
    [viewState, localViewState],
  );
  const currentViewRef = useRef(currentViewState);
  currentViewRef.current = currentViewState;
  const updateView = useCallback(
    (patch: EventViewState) => {
      const next = normalizeEventViewState({
        ...currentViewRef.current,
        ...patch,
      });
      currentViewRef.current = next;
      if (!controlled) setLocalViewState(next);
      onStateChange?.(next);
    },
    [controlled, onStateChange],
  );
  const eventSearch = currentViewState.eSearch;
  const eventType = currentViewState.eType;
  const conflictsOnly = currentViewState.eConflict === "true";
  const sort = currentViewState.eSort as Sort;
  const pageSize = Number(currentViewState.eSize);
  const bucketWindow = useMemo<BucketWindow | null>(
    () =>
      currentViewState.eFrom && currentViewState.eTo
        ? {
            from: currentViewState.eFrom,
            to: currentViewState.eTo,
            label: formatPacific(currentViewState.eFrom, true),
          }
        : null,
    [currentViewState.eFrom, currentViewState.eTo],
  );
  const setEventSearch = (value: string) => {
    updateView({ eSearch: value, event: "" });
    setPage(1);
  };
  const setEventType = (value: string) => {
    updateView({ eType: value, event: "" });
    setPage(1);
  };
  const setConflictsOnly = (value: boolean) => {
    updateView({ eConflict: value ? "true" : "", event: "" });
    setPage(1);
  };
  const setSort = (value: Sort) => {
    updateView({ eSort: value, event: "" });
    setPage(1);
  };
  const setPageSize = (value: number) => {
    updateView({ eSize: String(value), event: "" });
    setPage(1);
  };
  const setBucketWindow = (value: BucketWindow | null) => {
    updateView({ eFrom: value?.from ?? "", eTo: value?.to ?? "", event: "" });
    setPage(1);
  };
  const search = useDebounced(eventSearch, 250);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EventsResponse | null>(null);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<SourceEvent | null>(null);
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorError, setInspectorError] = useState("");
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const searchInput = useRef<HTMLInputElement>(null);
  const inspectorClose = useRef<HTMLButtonElement>(null);
  const inspectorRequest = useRef<AbortController | null>(null);
  const focusAfterLoad = useRef(false);
  const selectedId = useRef<string | null>(null);
  const selectedScope = useRef("");
  const previousGlobalQuery = useRef(query);
  const deepLink = currentViewState.event;

  useEffect(() => {
    if (previousGlobalQuery.current === query) return;
    previousGlobalQuery.current = query;
    setPage(1);
    // The app clears focus for user scope edits, while navigation can restore it.
    if (!controlled) updateView({ eFrom: "", eTo: "", event: "" });
  }, [query, controlled, updateView]);
  useEffect(() => {
    setPage(1);
  }, [search, eventType, conflictsOnly, sort, pageSize, bucketWindow]);

  const requestQuery = useMemo(() => {
    return eventParameters(
      query,
      {
        eSearch: search,
        eType: eventType,
        eConflict: conflictsOnly ? "true" : "",
        eSort: sort,
        eSize: String(pageSize),
        eFrom: bucketWindow?.from,
        eTo: bucketWindow?.to,
      },
      page,
    ).toString();
  }, [
    query,
    search,
    eventType,
    conflictsOnly,
    sort,
    page,
    pageSize,
    bucketWindow,
  ]);
  const eventLookupQuery = useMemo(() => {
    const params = new URLSearchParams(requestQuery);
    params.delete("page");
    params.delete("pageSize");
    params.delete("sort");
    return params.toString();
  }, [requestQuery]);

  useEffect(() => {
    inspectorRequest.current?.abort();
    inspectorRequest.current = null;
    focusAfterLoad.current = false;
    setSelected(null);
    setInspectorError("");
    setInspectorLoading(false);
  }, [eventLookupQuery]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/events?${requestQuery}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `The event log could not be loaded (${response.status}).`,
          );
        const result = (await response.json()) as EventsResponse;
        if (!Array.isArray(result.items) || !Array.isArray(result.eventTypes))
          throw new Error("The event service returned an incomplete response.");
        return result;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoadedQuery(requestQuery);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "The event log could not be loaded.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestQuery, retry]);

  useEffect(() => {
    if (!deepLink) {
      focusAfterLoad.current = false;
      setSelected(null);
      setInspectorError("");
      setInspectorLoading(false);
      return;
    }
    if (eventSearch !== search) {
      setSelected(null);
      setInspectorLoading(true);
      setInspectorError("");
      return;
    }
    if (
      selected?.event_id === deepLink &&
      selectedScope.current === eventLookupQuery
    )
      return;
    const controller = new AbortController();
    inspectorRequest.current = controller;
    focusAfterLoad.current = true;
    setInspectorLoading(true);
    setInspectorError("");
    window.requestAnimationFrame(() => inspectorClose.current?.focus());
    fetch(`/api/events/${encodeURIComponent(deepLink)}?${eventLookupQuery}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "This event is outside the selected window or does not exist."
              : "The selected event could not be loaded.",
          );
        const result = await response.json();
        return (result.event ?? result) as SourceEvent;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          selectedId.current = result.event_id;
          selectedScope.current = eventLookupQuery;
          setSelected(result);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setInspectorError(
            reason instanceof Error
              ? reason.message
              : "The selected event could not be loaded.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setInspectorLoading(false);
        if (inspectorRequest.current === controller)
          inspectorRequest.current = null;
      });
    return () => {
      controller.abort();
      if (inspectorRequest.current === controller)
        inspectorRequest.current = null;
    };
  }, [deepLink, eventLookupQuery, eventSearch, search]);

  useEffect(() => {
    if (
      !focusAfterLoad.current ||
      inspectorLoading ||
      (!selected && !inspectorError)
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      const close = inspectorClose.current;
      if (!close) return;
      focusAfterLoad.current = false;
      close.focus({ preventScroll: true });
      const panel = close.closest<HTMLElement>(".event-inspector");
      if (panel && window.getComputedStyle(panel).position !== "fixed") {
        panel.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected?.event_id, inspectorLoading, inspectorError]);

  const isStale =
    loading || loadedQuery !== requestQuery || eventSearch !== search;
  const exportQuery = useMemo(
    () => eventExportParameters(requestQuery).toString(),
    [requestQuery],
  );
  const closeInspector = useCallback(() => {
    const id = selectedId.current;
    inspectorRequest.current?.abort();
    inspectorRequest.current = null;
    focusAfterLoad.current = false;
    setSelected(null);
    setInspectorError("");
    setInspectorLoading(false);
    updateView({ event: "" });
    window.requestAnimationFrame(() =>
      (id
        ? (rowButtons.current.get(id) ?? searchInput.current)
        : searchInput.current
      )?.focus(),
    );
  }, [updateView]);
  useEffect(() => {
    if (!selected && !inspectorError && !inspectorLoading) return;
    const listener = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[aria-modal="true"]')
      ) {
        event.preventDefault();
        closeInspector();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [selected, inspectorError, inspectorLoading, closeInspector]);

  const selectEvent = (event: SourceEvent, focusInspector = false) => {
    if (isStale) return;
    inspectorRequest.current?.abort();
    inspectorRequest.current = null;
    focusAfterLoad.current = false;
    selectedId.current = event.event_id;
    selectedScope.current = eventLookupQuery;
    setSelected(event);
    setInspectorError("");
    setInspectorLoading(false);
    updateView({ event: event.event_id });
    if (focusInspector)
      window.requestAnimationFrame(() => inspectorClose.current?.focus());
  };
  const selectWithKeyboard = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (
      !data ||
      isStale ||
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    )
      return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? data.items.length - 1
          : Math.max(
              0,
              Math.min(
                data.items.length - 1,
                index + (event.key === "ArrowDown" ? 1 : -1),
              ),
            );
    const item = data.items[next];
    if (item) {
      rowButtons.current.get(item.event_id)?.focus();
      if (selected) selectEvent(item);
    }
  };
  const resetLocalFilters = () => {
    updateView({
      eSearch: "",
      eType: "",
      eConflict: "",
      eFrom: "",
      eTo: "",
      event: "",
    });
    setPage(1);
  };
  const goToPage = (next: number) => {
    updateView({ event: "" });
    setPage(next);
  };
  const focusBucket = (index: number) => {
    if (!data || isStale) return;
    const bounds = eventBucketBounds(data, index);
    if (!bounds) return;
    setBucketWindow({ ...bounds, label: formatPacific(bounds.from, true) });
    setPage(1);
  };
  const maxBucket = Math.max(
    1,
    ...(data?.series.map((bucket) => bucket.count) ?? []),
  );
  const facetTotal =
    data?.eventTypes.reduce((total, facet) => total + facet.count, 0) ?? 0;
  const hasLocalFilters = !!(
    eventSearch ||
    eventType ||
    conflictsOnly ||
    bucketWindow
  );
  const inspectorOpen = !!(selected || inspectorLoading || inspectorError);
  const pages = Math.max(1, data?.pages ?? 1);
  const currentPage = data?.page ?? page;
  const first = data?.total
    ? (currentPage - 1) * (data.pageSize || pageSize) + 1
    : 0;
  const last = data ? Math.min(data.total, first + data.items.length - 1) : 0;

  return (
    <section className="event-explorer" aria-labelledby="event-explorer-title">
      <div className="event-section-heading">
        <div>
          <h2 id="event-explorer-title">
            <Activity size={16} />
            Source records
          </h2>
          <p>
            Recorded metadata, conflict variants, and source-line provenance.
          </p>
        </div>
        <a
          className={`event-button event-export ${isStale ? "event-disabled" : ""}`}
          href={`/api/events/export?${exportQuery}`}
          aria-disabled={isStale}
          onClick={(event) => {
            if (isStale) event.preventDefault();
          }}
        >
          <ArrowDownToLine size={15} /> Export events
        </a>
      </div>

      <div className="event-workbench">
        <div className="event-toolbar">
          <label className="event-search">
            <Search size={16} />
            <span className="event-sr-only">
              Search event IDs, jobs, metadata, and recorded reasons
            </span>
            <input
              ref={searchInput}
              type="search"
              value={eventSearch}
              onChange={(event) => setEventSearch(event.target.value)}
              placeholder="Search events, metadata, reasons…"
              autoComplete="off"
            />
            {eventSearch && (
              <button
                type="button"
                onClick={() => setEventSearch("")}
                aria-label="Clear event search"
              >
                <X size={14} />
              </button>
            )}
          </label>
          <label className="event-conflict-toggle">
            <input
              type="checkbox"
              checked={conflictsOnly}
              onChange={(event) => setConflictsOnly(event.target.checked)}
            />
            <CircleAlert size={14} />
            <span>Conflicts only</span>
          </label>
          <label className="event-sort">
            <ArrowUpDown size={14} />
            <span className="event-sr-only">Sort events</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
            >
              <option value="timestamp_desc">Newest first</option>
              <option value="timestamp_asc">Oldest first</option>
              <option value="type_asc">Event type</option>
              <option value="quantity_desc">Largest quantity</option>
            </select>
            <ChevronDown size={12} />
          </label>
        </div>

        <div className="event-type-strip" aria-label="Filter by event type">
          <button
            type="button"
            className={`event-type-chip ${!eventType ? "event-active" : ""}`}
            onClick={() => setEventType("")}
            aria-pressed={!eventType}
          >
            All events <span>{data ? number(facetTotal) : "—"}</span>
          </button>
          {data?.eventTypes.map((facet) => (
            <button
              key={facet.type}
              type="button"
              className={`event-type-chip ${eventType === facet.type ? "event-active" : ""}`}
              onClick={() =>
                setEventType(eventType === facet.type ? "" : facet.type)
              }
              aria-pressed={eventType === facet.type}
            >
              <i
                className={`event-type-dot event-tone-${eventTone(facet.type)}`}
              />
              {human(facet.type)}
              <span>{number(facet.count)}</span>
            </button>
          ))}
          {eventType &&
            !data?.eventTypes.some((facet) => facet.type === eventType) && (
              <button
                type="button"
                className="event-type-chip event-active"
                onClick={() => setEventType("")}
              >
                {human(eventType)} <X size={12} />
              </button>
            )}
        </div>

        <div
          className="event-activity-panel"
          aria-busy={loading || eventSearch !== search}
        >
          <div className="event-activity-heading">
            <span>
              <Activity size={13} /> Event density
            </span>
            <span>
              {loading || eventSearch !== search ? (
                <>
                  <LoaderCircle size={12} className="event-spin" /> Updating
                </>
              ) : error ? (
                "Log unavailable"
              ) : data ? (
                `${number(data.total)} matching events`
              ) : (
                "Loading log"
              )}
            </span>
          </div>
          <div
            className="event-histogram"
            aria-label="Event activity over the selected window. Select a bar to focus that time bucket."
          >
            {data?.series.length && data.total > 0 ? (
              data.series.map((bucket, index) => {
                const bounds = eventBucketBounds(data, index);
                const period = bounds
                  ? `${formatPacific(bounds.from, true)} → ${formatPacific(bounds.to, true)}`
                  : formatPacific(bucket.timestamp, true);
                return (
                  <button
                    key={bucket.timestamp}
                    type="button"
                    className={`event-histogram-bar ${bucket.count === 0 ? "event-bucket-empty" : ""}`}
                    disabled={isStale || bucket.count === 0 || !bounds}
                    onClick={() => focusBucket(index)}
                    style={
                      {
                        "--event-bar-height": `${Math.max(3, (bucket.count / maxBucket) * 100)}%`,
                      } as React.CSSProperties
                    }
                    title={`${period} · ${number(bucket.count)} events`}
                    aria-label={`${number(bucket.count)} events, ${period}. Focus this time bucket.`}
                  >
                    <span />
                  </button>
                );
              })
            ) : !data && loading ? (
              Array.from({ length: 36 }, (_, index) => (
                <span
                  key={index}
                  className="event-histogram-placeholder"
                  style={{ height: "20%" }}
                />
              ))
            ) : (
              <div className="event-histogram-empty">
                <Activity size={15} />
                <span>
                  {error
                    ? "Activity is unavailable until the log loads."
                    : "No recorded events in this selection."}
                </span>
              </div>
            )}
          </div>
          <div className="event-histogram-axis">
            <span>
              {data ? formatPacific(data.window.from, true) : "Window start"}
            </span>
            <span>Pacific time · select a bar to focus</span>
            <span>
              {data ? formatPacific(data.window.to, true) : "Window end"}
            </span>
          </div>
        </div>

        {(hasLocalFilters || inspectorError) && (
          <div className="event-active-filters">
            <Filter size={12} />
            {bucketWindow && (
              <button type="button" onClick={() => setBucketWindow(null)}>
                Focused: {bucketWindow.label}
                <X size={12} />
              </button>
            )}
            {eventType && <span>{human(eventType)}</span>}
            {conflictsOnly && <span>Unresolved quantity conflicts</span>}
            {eventSearch && <span>Search: “{eventSearch}”</span>}
            <button
              type="button"
              className="event-clear-filters"
              onClick={resetLocalFilters}
            >
              Clear event filters
            </button>
          </div>
        )}

        {error && (
          <div className="event-error" role="alert">
            <CircleAlert size={17} />
            <div>
              <strong>Unable to load events</strong>
              <p>{error}</p>
            </div>
            <button
              className="event-button"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        )}

        <div
          className={`event-results-grid ${inspectorOpen ? "event-with-inspector" : ""}`}
        >
          <div
            className="event-table-panel"
            aria-busy={loading || eventSearch !== search}
          >
            <div className="event-table-scroll">
              <table className="event-table">
                <caption className="event-sr-only">
                  Recorded manufacturing events. Select an event ID to inspect
                  its full metadata and provenance.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      Recorded at <span>Pacific</span>
                    </th>
                    <th scope="col">Event / ID</th>
                    <th scope="col">Job</th>
                    <th scope="col">Machine</th>
                    <th scope="col" className="event-number-column">
                      Quantity
                    </th>
                    <th scope="col">Trust</th>
                    <th scope="col">
                      <span className="event-sr-only">Inspect</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((item, index) => {
                    const event = item as SourceEvent;
                    return (
                      <tr
                        key={event.event_id}
                        className={`${selected?.event_id === event.event_id ? "event-row-selected" : ""} ${isStale ? "event-row-stale" : ""}`}
                        onClick={() => selectEvent(event)}
                      >
                        <td className="event-time-cell">
                          <span>{formatPacificTime(event.timestamp)}</span>
                          <small>
                            {formatPacific(pacificDay(event.timestamp))}
                          </small>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="event-record-button"
                            disabled={isStale}
                            ref={(element) => {
                              if (element)
                                rowButtons.current.set(event.event_id, element);
                              else rowButtons.current.delete(event.event_id);
                            }}
                            onClick={(click) => {
                              click.stopPropagation();
                              selectEvent(event, click.detail === 0);
                            }}
                            onKeyDown={(key) => selectWithKeyboard(key, index)}
                            aria-label={`Inspect ${human(event.event_type)} event ${event.event_id}`}
                            aria-expanded={
                              selected?.event_id === event.event_id
                            }
                          >
                            <span className="event-record-type">
                              <i
                                className={`event-type-dot event-tone-${eventTone(event.event_type)}`}
                              />
                              {human(event.event_type)}
                            </span>
                            <small>{event.event_id}</small>
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="event-inline-link"
                            disabled={isStale}
                            onClick={(click) => {
                              click.stopPropagation();
                              onOpenJob(event.job_id);
                            }}
                          >
                            {event.job_id}
                          </button>
                        </td>
                        <td>
                          {event.machine_id ? (
                            <button
                              type="button"
                              className="event-machine-link"
                              disabled={isStale}
                              onClick={(click) => {
                                click.stopPropagation();
                                onSelectMachine(event.machine_id!);
                              }}
                            >
                              {event.machine_id}
                              <ArrowRight size={11} />
                            </button>
                          ) : (
                            <span className="event-muted">—</span>
                          )}
                        </td>
                        <td
                          className={`event-number-column ${event.quantity === null ? "event-unresolved" : ""}`}
                        >
                          {event.quantity === null
                            ? "Unresolved"
                            : number(event.quantity)}
                        </td>
                        <td>
                          {event.conflict ? (
                            <span className="event-trust-badge event-trust-warning">
                              <CircleAlert size={11} /> Conflict
                            </span>
                          ) : (event.exactDuplicateCount ?? 0) > 0 ? (
                            <span className="event-trust-badge">
                              <Layers3 size={11} /> Deduped
                            </span>
                          ) : (
                            <span className="event-trust-badge event-trust-recorded">
                              <Check size={11} /> Recorded
                            </span>
                          )}
                        </td>
                        <td>
                          <ChevronRight
                            size={14}
                            className="event-row-chevron"
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {!data &&
                    loading &&
                    Array.from({ length: 8 }, (_, index) => (
                      <tr
                        key={index}
                        aria-hidden="true"
                        className="event-skeleton-row"
                      >
                        {Array.from({ length: 7 }, (_, cell) => (
                          <td key={cell}>
                            <span />
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {data?.items.length === 0 && !loading && (
              <div className="event-empty">
                <Search size={25} />
                <h3>No matching events</h3>
                <p>Try another event type, search term, or analysis window.</p>
                {hasLocalFilters && (
                  <button
                    className="event-button"
                    type="button"
                    onClick={resetLocalFilters}
                  >
                    Clear event filters
                  </button>
                )}
              </div>
            )}
            <div className="event-pagination">
              <span className="event-pagination-count">
                {data
                  ? `${number(first)}–${number(Math.max(0, last))} of ${number(data.total)} events`
                  : error
                    ? "Events unavailable"
                    : "Loading events…"}
              </span>
              <label>
                Rows{" "}
                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                  aria-label="Events per page"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </label>
              <div className="event-page-controls">
                <button
                  type="button"
                  onClick={() => goToPage(1)}
                  disabled={isStale || currentPage <= 1}
                  aria-label="First event page"
                >
                  <ChevronsLeft size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => goToPage(Math.max(1, currentPage - 1))}
                  disabled={isStale || currentPage <= 1}
                  aria-label="Previous event page"
                >
                  <ChevronLeft size={15} />
                </button>
                <span>
                  {number(currentPage)} <i>/</i> {number(pages)}
                </span>
                <button
                  type="button"
                  onClick={() => goToPage(Math.min(pages, currentPage + 1))}
                  disabled={isStale || currentPage >= pages}
                  aria-label="Next event page"
                >
                  <ChevronRight size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => goToPage(pages)}
                  disabled={isStale || currentPage >= pages}
                  aria-label="Last event page"
                >
                  <ChevronsRight size={15} />
                </button>
              </div>
            </div>
            <p className="event-table-footnote">
              Quantities describe each event type, not unique finished units.
              Use completion summaries for final good and scrap output.
            </p>
          </div>

          {inspectorOpen && (
            <aside
              className="event-inspector"
              role="dialog"
              aria-modal="false"
              aria-labelledby="event-inspector-title"
            >
              <div className="event-inspector-top">
                <span>
                  <Braces size={14} /> Event inspector
                </span>
                <button
                  type="button"
                  ref={inspectorClose}
                  onClick={closeInspector}
                  aria-label="Close event inspector"
                >
                  <X size={17} />
                </button>
              </div>
              {inspectorLoading ? (
                <div className="event-inspector-loading">
                  <LoaderCircle className="event-spin" size={22} />
                  <h3 id="event-inspector-title">Loading event</h3>
                  <p>Retrieving its source record…</p>
                </div>
              ) : inspectorError ? (
                <div className="event-inspector-loading">
                  <CircleAlert size={22} />
                  <h3 id="event-inspector-title">Event unavailable</h3>
                  <p>{inspectorError}</p>
                  {hasLocalFilters && (
                    <button
                      type="button"
                      className="event-button"
                      onClick={() => {
                        updateView({
                          eType: "",
                          eSearch: "",
                          eConflict: "",
                          eFrom: "",
                          eTo: "",
                        });
                        setPage(1);
                      }}
                    >
                      Clear event filters and retry
                    </button>
                  )}
                </div>
              ) : (
                selected && (
                  <EventInspector
                    key={selected.event_id}
                    event={selected}
                    onOpenJob={onOpenJob}
                    onSelectMachine={onSelectMachine}
                  />
                )
              )}
            </aside>
          )}
        </div>
      </div>
    </section>
  );
}

function EventInspector({
  event,
  onOpenJob,
  onSelectMachine,
}: {
  event: SourceEvent;
  onOpenJob: ExplorerProps["onOpenJob"];
  onSelectMachine: ExplorerProps["onSelectMachine"];
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [rawOpen, setRawOpen] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  const copyEvent = async () => {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error(
          "Clipboard unavailable. Expand the raw record to select and copy it.",
        );
      await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
      setCopied(true);
      setCopyError("");
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch (reason) {
      setCopyError(
        reason instanceof Error ? reason.message : "Could not copy this event.",
      );
      setRawOpen(true);
    }
  };
  return (
    <div className="event-inspector-content">
      <div className="event-inspector-title">
        <span
          className={`event-type-label event-tone-${eventTone(event.event_type)}`}
        >
          {human(event.event_type)}
        </span>
        <h3 id="event-inspector-title">{event.event_id}</h3>
        <p>
          {formatPacific(event.timestamp, true)}
          <span>{formatPacificTime(event.timestamp)} Pacific</span>
        </p>
      </div>
      {event.conflict && (
        <div className="event-conflict-notice">
          <CircleAlert size={16} />
          <div>
            <strong>Quantity is unresolved</strong>
            <p>
              This ID has conflicting source records and no revision marker.
              Both variants remain available below; neither quantity is selected
              for totals.
            </p>
          </div>
        </div>
      )}
      <div className="event-inspector-section">
        <h4>Record context</h4>
        <dl className="event-metadata-list">
          <div>
            <dt>Job</dt>
            <dd>
              <button
                type="button"
                className="event-inline-link"
                onClick={() => onOpenJob(event.job_id)}
              >
                {event.job_id}
                <ArrowRight size={12} />
              </button>
            </dd>
          </div>
          <div>
            <dt>Machine</dt>
            <dd>
              {event.machine_id ? (
                <button
                  type="button"
                  className="event-inline-link"
                  onClick={() => onSelectMachine(event.machine_id!)}
                >
                  {event.machine_id}
                  <ArrowRight size={12} />
                </button>
              ) : (
                "Not recorded"
              )}
            </dd>
          </div>
          <div>
            <dt>Part</dt>
            <dd>{event.part_id}</dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>{event.customer_id}</dd>
          </div>
          <div>
            <dt>Material</dt>
            <dd>{human(event.material)}</dd>
          </div>
          <div>
            <dt>Reported quantity</dt>
            <dd className={event.quantity === null ? "event-unresolved" : ""}>
              {event.quantity === null ? "Unresolved" : number(event.quantity)}
            </dd>
          </div>
        </dl>
      </div>
      <div className="event-inspector-section">
        <h4>
          Recorded metadata{" "}
          <span>{Object.keys(event.metadata ?? {}).length} fields</span>
        </h4>
        {Object.keys(event.metadata ?? {}).length ? (
          <dl className="event-metadata-list">
            {Object.entries(event.metadata).map(([key, value]) => (
              <div key={key}>
                <dt>{human(key)}</dt>
                <dd>{metadataValue(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="event-muted">
            No metadata was recorded for this event.
          </p>
        )}
      </div>
      <div className="event-inspector-section">
        <h4>Source provenance</h4>
        <dl className="event-metadata-list">
          <div>
            <dt>Source</dt>
            <dd>manufacturing_events.jsonl</dd>
          </div>
          <div>
            <dt>Source lines</dt>
            <dd>
              {event.sourceLineNumbers?.length
                ? event.sourceLineNumbers.map(number).join(", ")
                : "Not included"}
            </dd>
          </div>
          <div>
            <dt>Exact duplicate rows</dt>
            <dd>{number(event.exactDuplicateCount ?? 0)} removed</dd>
          </div>
          <div>
            <dt>Distinct variants</dt>
            <dd>{number(event.variants?.length ?? 1)}</dd>
          </div>
        </dl>
        <p className="event-provenance-note">
          Line numbers refer to the unchanged source log. Displayed timestamps
          use Pacific time; the raw record preserves its original ISO
          timestamps.
        </p>
      </div>
      {event.variants && (
        <div className="event-inspector-section">
          <h4>Conflicting source variants</h4>
          {event.variants.map((variant, index) => (
            <details className="event-variant" key={index}>
              <summary>
                <span>Variant {index + 1}</span>
                <strong>
                  Quantity:{" "}
                  {variant.quantity === null
                    ? "Unresolved"
                    : number(variant.quantity)}
                </strong>
                <ChevronDown size={13} />
              </summary>
              {event.variantSourceLineNumbers?.[index]?.length ? (
                <p className="event-variant-provenance">
                  Source lines:{" "}
                  {event.variantSourceLineNumbers[index].map(number).join(", ")}
                </p>
              ) : null}
              <pre>{JSON.stringify(variant, null, 2)}</pre>
            </details>
          ))}
        </div>
      )}
      <div className="event-inspector-section event-raw-section">
        <div className="event-raw-heading">
          <button
            type="button"
            className="event-raw-toggle"
            onClick={() => setRawOpen((value) => !value)}
            aria-expanded={rawOpen}
          >
            <Braces size={14} /> Raw record{" "}
            <ChevronDown size={13} className={rawOpen ? "event-rotate" : ""} />
          </button>
          <button type="button" className="event-copy" onClick={copyEvent}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>
        {rawOpen && (
          <pre className="event-raw-json">{JSON.stringify(event, null, 2)}</pre>
        )}
        <span className="event-copy-status" role="status">
          {copied ? "Event JSON copied to clipboard." : copyError}
        </span>
      </div>
    </div>
  );
}

function metadataValue(value: unknown): string {
  if (value === null || value === undefined) return "Not recorded";
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
    return formatPacific(value, true);
  if (typeof value === "number") return number(value);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
