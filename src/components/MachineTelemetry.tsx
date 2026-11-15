import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Crosshair,
  Factory,
  LoaderCircle,
  RotateCcw,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import type {
  CycleSample,
  MachineTelemetryProps,
  RecordedSignal,
  SignalBucket,
  TelemetryResponse,
} from "../telemetry-types";
import {
  formatPacific,
  formatPacificTime,
  pacificHourBounds,
  pacificDay,
} from "../time.mjs";
import { csvCell } from "./job-view-utils.mjs";
import "./MachineTelemetry.css";

const number = (value: number) => value.toLocaleString("en-US");
const seconds = (value: number | null) =>
  value === null ? "—" : `${Number(value.toFixed(1)).toLocaleString()} s`;
const elapsed = (value: number | null) =>
  value === null
    ? "—"
    : value < 48
      ? `${value.toFixed(1)} h`
      : `${(value / 24).toFixed(1)} d`;
const human = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
const machineName = (id: string) =>
  id === "unassigned" ? "Unassigned records" : id;
function downloadCsv(rows: unknown[][], filename: string) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadSamples(samples: CycleSample[], machineId: string) {
  downloadCsv(
    [
      [
        "event_id",
        "job_id",
        "machine_id",
        "timestamp_utc",
        "time_pacific",
        "cycle_seconds",
        "reported_quantity",
        "quantity_conflict",
      ],
      ...samples.map((sample) => [
        sample.eventId,
        sample.jobId,
        sample.machineId,
        sample.timestamp,
        formatPacific(sample.timestamp, true),
        sample.seconds,
        sample.quantity ?? "",
        sample.conflict,
      ]),
    ],
    `${machineId}-displayed-cycles.csv`,
  );
}
function downloadBuckets(buckets: SignalBucket[], machineId: string) {
  downloadCsv(
    [
      [
        "machine_id",
        "bucket_start_utc",
        "bucket_start_pacific",
        "events",
        "cycle_events",
        "reported_units",
        "completion_good",
        "completion_scrap",
        "median_cycle_seconds",
        "p90_cycle_seconds",
      ],
      ...buckets.map((bucket) => [
        machineId,
        bucket.timestamp,
        formatPacific(bucket.timestamp, true),
        bucket.events,
        bucket.cycles,
        bucket.reportedUnits,
        bucket.good,
        bucket.scrap,
        bucket.p50CycleSeconds,
        bucket.p90CycleSeconds,
      ]),
    ],
    `${machineId}-event-buckets.csv`,
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <svg viewBox="0 0 130 24" aria-hidden="true">
      <path
        d={values
          .map(
            (value, i) =>
              `${i ? "L" : "M"}${(i / Math.max(1, values.length - 1)) * 130},${23 - (value / max) * 21}`,
          )
          .join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function MachineTelemetry({
  query,
  onOpenJob,
  onSelectMachine,
  onInspectWindow,
  onOpenEvent,
}: MachineTelemetryProps) {
  const [data, setData] = useState<TelemetryResponse | null>(null);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedMachine, setSelectedMachine] = useState("");
  const [channel, setChannel] = useState<"cycles" | "events">("cycles");
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [signalKind, setSignalKind] = useState("all");
  const [showMarkers, setShowMarkers] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/telemetry?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Telemetry could not be loaded (${response.status}).`,
          );
        return response.json();
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoadedQuery(query);
        }
      })
      .catch((cause) => {
        if (cause.name !== "AbortError") setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, retry]);
  const machine =
    data?.machines.find((item) => item.id === selectedMachine) ??
    data?.machines.find((item) => item.kind === "press") ??
    data?.machines[0];
  useEffect(() => {
    setZoom(null);
    setThreshold(null);
  }, [query, machine?.id]);
  const samples = useMemo(
    () =>
      (data?.cycleSamples ?? [])
        .filter((sample) => sample.machineId === machine?.id)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [data, machine?.id],
  );
  const visibleSamples = useMemo(
    () =>
      zoom
        ? samples.filter((sample) => {
            const time = Date.parse(sample.timestamp);
            return time >= zoom[0] && time <= zoom[1];
          })
        : samples,
    [samples, zoom],
  );
  const signalBuckets = machine?.activity ?? data?.series ?? [];
  const visibleBuckets = useMemo(
    () =>
      zoom
        ? signalBuckets.filter((bucket, index) => {
            const next = signalBuckets[index + 1];
            return (
              Date.parse(bucket.timestamp) <= zoom[1] &&
              (!next || Date.parse(next.timestamp) > zoom[0])
            );
          })
        : signalBuckets,
    [signalBuckets, zoom],
  );
  const limit = threshold ?? machine?.p90CycleSeconds ?? null;
  const flagged =
    limit === null
      ? 0
      : visibleSamples.filter((sample) => sample.seconds > limit).length;
  const signals = (data?.signals ?? []).filter(
    (signal) => signalKind === "all" || signal.kind === signalKind,
  );
  const markers = (data?.signals ?? []).filter(
    (signal) =>
      signal.kind !== "unresolved_block" &&
      (signal.machineId ?? "unassigned") === machine?.id,
  );
  if (error)
    return (
      <section className="panel tele-error" role="alert">
        <TriangleAlert size={22} />
        <h2>Telemetry is unavailable</h2>
        <p>{error}</p>
        <button
          className="button secondary"
          onClick={() => setRetry((value) => value + 1)}
        >
          Try again
        </button>
      </section>
    );
  if (!data || loading || loadedQuery !== query)
    return (
      <div className="tele-loading" role="status">
        <LoaderCircle className="spin" size={22} /> Loading recorded machine
        signals…
      </div>
    );
  return (
    <div className="telemetry-workspace">
      <div className="tele-stat-grid">
        {[
          [
            "Scope cycle events",
            number(data.summary.cycles),
            `${number(data.summary.events)} events in window`,
          ],
          [
            "Scope median cycle",
            seconds(data.summary.p50CycleSeconds),
            "Known unique cycle durations",
          ],
          [
            "Scope P90 cycle",
            seconds(data.summary.p90CycleSeconds),
            "90th percentile across this scope",
          ],
          [
            "Scope review signals",
            number(data.summary.recordedSignals),
            `${number(data.summary.unresolvedQuantityEvents)} unresolved cycle quantities`,
          ],
        ].map(([label, value, note]) => (
          <div className="tele-stat panel" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <div className="tele-workbench-grid">
        <section className="panel tele-fleet">
          <div className="panel-heading">
            <div>
              <div className="section-label">ASSET REGISTER</div>
              <h2>
                Machines{" "}
                <span className="count-badge">
                  {
                    data.machines.filter((item) => item.id !== "unassigned")
                      .length
                  }
                </span>
              </h2>
            </div>
          </div>
          <div className="tele-machine-grid">
            {data.machines.map((item) => (
              <button
                key={item.id}
                className={`tele-machine ${machine?.id === item.id ? "selected" : ""}`}
                onClick={() => {
                  setSelectedMachine(item.id);
                  setChannel(item.cycleCount ? "cycles" : "events");
                }}
                aria-pressed={machine?.id === item.id}
              >
                <div className="tele-machine-title">
                  <Factory size={14} />
                  <strong>{machineName(item.id)}</strong>
                  <span>
                    {item.kind === "inspection"
                      ? "QC"
                      : item.kind.toUpperCase()}
                  </span>
                </div>
                <Sparkline
                  values={item.activity.map((bucket) => bucket.events)}
                />
                <div className="tele-machine-numbers">
                  <span>
                    <b>{number(item.cycleCount || item.eventCount)}</b>{" "}
                    {item.cycleCount ? "cycles" : "events"}
                  </span>
                  <span>
                    {item.cycleCount
                      ? seconds(item.p50CycleSeconds)
                      : `${number(item.jobCount)} jobs`}
                  </span>
                </div>
                <small className={item.blockedJobCount ? "tele-warning" : ""}>
                  {item.blockedJobCount
                    ? `${item.blockedJobCount} associated blocked ${item.blockedJobCount === 1 ? "job" : "jobs"}`
                    : `${item.eventCount ? "Last " + formatPacific(item.lastEventAt, true) : "No observations in this window"}`}
                </small>
              </button>
            ))}
          </div>
          {!data.machines.length && (
            <div className="empty-state">
              <Factory size={24} />
              <h3>No machine observations in this scope.</h3>
              <p>Broaden the analysis window or remove a machine filter.</p>
            </div>
          )}
        </section>
        {machine && (
          <section className="panel tele-signal-panel">
            <div className="panel-heading">
              <div>
                <div className="section-label">
                  SIGNAL WORKBENCH / {machineName(machine.id).toUpperCase()}
                </div>
                <h2>
                  {channel === "cycles" ? "Cycle duration" : "Event activity"}{" "}
                  <span className="tele-channel-unit">
                    {channel === "cycles" ? "seconds" : "recorded events"}
                  </span>
                </h2>
              </div>
              <div className="tele-actions">
                <button
                  className="button secondary"
                  onClick={() => onSelectMachine(machine.id)}
                >
                  <Crosshair size={13} /> Apply machine scope
                </button>
                <button
                  className="button secondary"
                  disabled={
                    channel === "cycles"
                      ? !visibleSamples.length
                      : !visibleBuckets.length
                  }
                  onClick={() =>
                    channel === "cycles"
                      ? downloadSamples(visibleSamples, machine.id)
                      : downloadBuckets(visibleBuckets, machine.id)
                  }
                  title={
                    channel === "cycles"
                      ? "Download displayed cycle observations"
                      : "Download displayed event buckets"
                  }
                >
                  <ArrowDownToLine size={13} />{" "}
                  {channel === "cycles" ? "Cycle CSV" : "Bucket CSV"}
                </button>
              </div>
            </div>
            <div className="tele-asset-summary">
              <span>
                <strong>{number(machine.eventCount)}</strong> events
              </span>
              <span>
                <strong>{number(machine.jobCount)}</strong> associated jobs
              </span>
              <span>
                Median <strong>{seconds(machine.p50CycleSeconds)}</strong>
              </span>
              <span>
                P90 <strong>{seconds(machine.p90CycleSeconds)}</strong>
              </span>
            </div>
            <div className="tele-plot-toolbar">
              <div
                className="tele-tabs"
                role="group"
                aria-label="Telemetry channel"
              >
                <button
                  aria-pressed={channel === "cycles"}
                  className={channel === "cycles" ? "active" : ""}
                  onClick={() => setChannel("cycles")}
                >
                  Cycle duration
                </button>
                <button
                  aria-pressed={channel === "events"}
                  className={channel === "events" ? "active" : ""}
                  onClick={() => setChannel("events")}
                >
                  Event volume
                </button>
              </div>
              <div className="tele-plot-controls">
                <button
                  className={`tele-markers-toggle ${showMarkers ? "selected" : ""}`}
                  aria-pressed={showMarkers}
                  onClick={() => setShowMarkers((value) => !value)}
                >
                  <TriangleAlert size={12} />
                  Source markers <b>{markers.length}</b>
                </button>
                {channel === "cycles" && (
                  <label>
                    <SlidersHorizontal size={13} /> Review threshold{" "}
                    <input
                      type="number"
                      min="0"
                      step="10"
                      value={limit === null ? "" : Math.round(limit)}
                      onChange={(event) =>
                        setThreshold(
                          event.target.value === ""
                            ? null
                            : Math.max(0, Number(event.target.value)),
                        )
                      }
                      aria-label="Cycle review threshold in seconds"
                    />
                    <span>s</span>
                  </label>
                )}
                <button
                  className="text-button"
                  disabled={!zoom}
                  onClick={() => setZoom(null)}
                >
                  <RotateCcw size={12} /> Reset zoom
                </button>
              </div>
            </div>
            <CyclePlot
              samples={visibleSamples}
              buckets={visibleBuckets}
              channel={channel}
              threshold={limit}
              markers={showMarkers ? markers : []}
              onOpenEvent={onOpenEvent}
              bounds={
                zoom ?? [
                  Date.parse(data.window.from),
                  Date.parse(data.window.to),
                ]
              }
              onZoom={setZoom}
              onOpenJob={onOpenJob}
            />
            <div className="tele-plot-footer">
              <span>
                Drag to zoom. Arrow keys inspect{" "}
                {channel === "cycles"
                  ? "cycles; Enter opens a job"
                  : "event buckets"}
                .
              </span>
              <span>
                {channel === "cycles"
                  ? `${number(visibleSamples.length)} displayed · ${flagged} above threshold`
                  : `${number(visibleBuckets.reduce((sum, bucket) => sum + bucket.events, 0))} events across ${visibleBuckets.length} buckets`}
              </span>
            </div>
            <div className="tele-provenance-note">
              Each cycle point is a recorded duration, not a continuous sensor
              measurement. Review markers link to source-recorded exceptions at
              their observed times.{" "}
              {data.cycleSampleTotal > data.cycleSamples.length
                ? `The plot is evenly sampled from ${number(data.cycleSampleTotal)} observations; percentiles use every qualifying observation. `
                : ""}
              The default review threshold is the selected machine’s P90, a
              descriptive comparison rather than a process limit.
            </div>
          </section>
        )}
      </div>
      <div className="tele-bottom-grid">
        <section className="panel tele-flow">
          <div className="panel-heading">
            <div>
              <div className="section-label">PROCESS TIMING</div>
              <h2>Associated job states</h2>
            </div>
            <Activity size={17} />
          </div>
          <div className="tele-stage-list">
            {data.flow.stages.map((stage, i) => (
              <div key={stage.key}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <strong>{stage.label}</strong>
                <b>{number(stage.jobs)}</b>
                <div>
                  <i
                    style={{
                      width: `${
                        (stage.jobs /
                          Math.max(
                            1,
                            data.flow.stages.reduce(
                              (total, item) => total + item.jobs,
                              0,
                            ),
                          )) *
                        100
                      }%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="tele-timing-grid">
            {[
              ["Completed lead time", data.flow.leadHours],
              ["Tool-ready queue", data.flow.queueHours],
              ["Blocks within window", data.flow.blockedHours],
            ].map(([label, metrics]) => {
              const values = metrics as {
                p50: number | null;
                p90: number | null;
              };
              return (
                <div key={label as string}>
                  <span>{label as string}</span>
                  <strong>{elapsed(values.p50)}</strong>
                  <small>P90 {elapsed(values.p90)}</small>
                </div>
              );
            })}
          </div>
          <div className="panel-note">
            Each associated job appears once at the replay cursor. Lead and
            queue timing use job lifetimes; blocked timing uses positive waiting
            intervals within the analysis window.
          </div>
        </section>
        <section className="panel tele-recorded-signals">
          <div className="panel-heading">
            <div>
              <div className="section-label">REVIEW QUEUE</div>
              <h2>Recorded signals</h2>
            </div>
            <select
              value={signalKind}
              onChange={(event) => setSignalKind(event.target.value)}
              aria-label="Recorded signal type"
            >
              <option value="all">All signals</option>
              <option value="sensor_glitch">Sensor glitches</option>
              <option value="unresolved_block">Open blocks</option>
              <option value="quantity_conflict">Quantity conflicts</option>
              <option value="quality_mismatch">Quality mismatches</option>
            </select>
          </div>
          <div className="tele-signal-list">
            {signals.slice(0, 60).map((signal) => (
              <button key={signal.id} onClick={() => onOpenJob(signal.jobId)}>
                <span className={`tele-signal-dot ${signal.severity}`} />
                <div>
                  <strong>{signal.title}</strong>
                  <p>{signal.detail}</p>
                  <small>
                    {signal.jobId} · {formatPacific(signal.timestamp, true)}
                    {signal.machineId ? " · " + signal.machineId : ""}
                  </small>
                </div>
                <ArrowUpRight size={14} />
              </button>
            ))}
            {!signals.length && (
              <div className="empty-state">
                <Activity size={24} />
                <h3>No recorded signals in this selection.</h3>
                <p>
                  This does not certify machine health; it reflects the event
                  records available.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
      <ActivityHeatmap
        cells={data.heatmap}
        window={data.window}
        onSelect={(day, hour) => {
          const selected = pacificHourBounds(day, hour);
          const from = new Date(
            Math.max(Date.parse(selected.from), Date.parse(data.window.from)),
          ).toISOString();
          const to = new Date(
            Math.min(Date.parse(selected.to), Date.parse(data.window.to)),
          ).toISOString();
          onInspectWindow?.(from, to);
          setZoom(null);
          setSelectedMachine("");
          setChannel("events");
          document.querySelector(".tele-signal-panel")?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "auto"
              : "smooth",
            block: "start",
          });
        }}
      />
    </div>
  );
}

function CyclePlot({
  samples,
  buckets,
  channel,
  threshold,
  markers,
  onOpenEvent,
  bounds,
  onZoom,
  onOpenJob,
}: {
  samples: CycleSample[];
  buckets: SignalBucket[];
  markers: RecordedSignal[];
  onOpenEvent?: (eventId: string) => void;
  channel: "cycles" | "events";
  threshold: number | null;
  bounds: [number, number];
  onZoom: (range: [number, number]) => void;
  onOpenJob: (id: string) => void;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const [brush, setBrush] = useState<[number, number] | null>(null);
  const [markerId, setMarkerId] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const clipId = useId();
  useEffect(() => {
    setIndex(null);
    setMarkerId(null);
  }, [samples, buckets, channel]);
  const width = 1000,
    height = 310,
    left = 68,
    right = 25,
    top = 36,
    bottom = 42;
  const span = Math.max(1, bounds[1] - bounds[0]);
  const x = (time: number) =>
    left + ((time - bounds[0]) / span) * (width - left - right);
  const max =
    channel === "cycles"
      ? Math.max(
          1,
          ...samples.map((sample) => sample.seconds),
          threshold ?? 0,
        ) * 1.12
      : Math.max(1, ...buckets.map((bucket) => bucket.events)) * 1.12;
  const y = (value: number) =>
    height - bottom - (value / max) * (height - top - bottom);
  const observations = channel === "cycles" ? samples : buckets;
  const timeAt = (clientX: number) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect) return bounds[0];
    const localX = ((clientX - rect.left) / rect.width) * width;
    return (
      bounds[0] +
      Math.max(0, Math.min(1, (localX - left) / (width - left - right))) * span
    );
  };
  const nearest = (time: number) => {
    if (!observations.length) return null;
    let closest = 0;
    for (let i = 1; i < observations.length; i++)
      if (
        Math.abs(Date.parse(observations[i].timestamp) - time) <
        Math.abs(Date.parse(observations[closest].timestamp) - time)
      )
        closest = i;
    return closest;
  };
  const active =
    channel === "cycles" && index !== null
      ? samples[Math.min(index, samples.length - 1)]
      : null;
  const activeBucket =
    channel === "events" && index !== null
      ? buckets[Math.min(index, buckets.length - 1)]
      : null;
  const visibleMarkers = markers.filter(
    (marker) =>
      Date.parse(marker.timestamp) >= bounds[0] &&
      Date.parse(marker.timestamp) <= bounds[1],
  );
  const activeMarker = visibleMarkers.find((marker) => marker.id === markerId);
  const inspectMarker = (marker: RecordedSignal) =>
    marker.eventId && onOpenEvent
      ? onOpenEvent(marker.eventId)
      : onOpenJob(marker.jobId);
  const barWidth =
    buckets.length > 1
      ? Math.max(
          2,
          x(Date.parse(buckets[1].timestamp)) -
            x(Date.parse(buckets[0].timestamp)) -
            2,
        )
      : width - left - right;
  return (
    <>
      <div className="tele-plot-scroll">
        <svg
          className="tele-chart"
          ref={svg}
          viewBox={`0 0 ${width} ${height}`}
          tabIndex={0}
          role="group"
          aria-label={`Interactive ${channel === "cycles" ? "cycle duration" : "event volume"} chart. Left and right arrows inspect observations.${channel === "cycles" ? " Enter opens a job." : ""} Drag to zoom.`}
          onKeyDown={(event) => {
            if (!observations.length) return;
            if (
              ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              setIndex((value) =>
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? observations.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          observations.length - 1,
                          value === null
                            ? 0
                            : value + (event.key === "ArrowRight" ? 1 : -1),
                        ),
                      ),
              );
            }
            if (
              ["Enter", "Return", " "].includes(event.key) &&
              channel === "cycles"
            ) {
              const selected =
                samples[Math.min(index ?? 0, samples.length - 1)];
              if (selected) {
                event.preventDefault();
                onOpenJob(selected.jobId);
              }
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const time = timeAt(event.clientX);
            setIndex(nearest(time));
            setBrush([time, time]);
          }}
          onPointerMove={(event) => {
            setMarkerId(null);
            const time = timeAt(event.clientX);
            setIndex(nearest(time));
            setBrush((current) => (current ? [current[0], time] : null));
          }}
          onPointerUp={(event) => {
            const end = timeAt(event.clientX);
            if (brush && Math.abs(end - brush[0]) > span / 100)
              onZoom([Math.min(end, brush[0]), Math.max(end, brush[0])]);
            setBrush(null);
          }}
          onPointerCancel={() => setBrush(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect
                x={left}
                y={top}
                width={width - left - right}
                height={height - top - bottom}
              />
            </clipPath>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line
                x1={left}
                x2={width - right}
                y1={y((max * i) / 4)}
                y2={y((max * i) / 4)}
                className="tele-grid-line"
              />
              <text x={left - 12} y={y((max * i) / 4) + 4} textAnchor="end">
                {Math.round((max * i) / 4).toLocaleString()}
              </text>
            </g>
          ))}
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const time = bounds[0] + (span * i) / 6;
            return (
              <g key={i}>
                <line
                  x1={x(time)}
                  x2={x(time)}
                  y1={top}
                  y2={height - bottom}
                  className="tele-grid-line vertical"
                />
                <text
                  x={x(time)}
                  y={height - 18}
                  textAnchor={i === 0 ? "start" : i === 6 ? "end" : "middle"}
                >
                  {span <= 72 * 3_600_000
                    ? formatPacificTime(new Date(time).toISOString()).slice(
                        0,
                        5,
                      )
                    : formatPacific(new Date(time).toISOString())}
                </text>
              </g>
            );
          })}
          {visibleMarkers.map((marker) => (
            <g
              key={marker.id}
              className="tele-source-marker"
              role="button"
              tabIndex={0}
              aria-label={`${marker.title}, ${formatPacific(marker.timestamp, true)}. Inspect source event.`}
              transform={`translate(${x(Date.parse(marker.timestamp))},18)`}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerMove={(event) => {
                event.stopPropagation();
                setMarkerId(marker.id);
              }}
              onFocus={() => setMarkerId(marker.id)}
              onClick={(event) => {
                event.stopPropagation();
                inspectMarker(marker);
              }}
              onKeyDown={(event) => {
                if (["Enter", "Return", " "].includes(event.key)) {
                  event.preventDefault();
                  event.stopPropagation();
                  inspectMarker(marker);
                }
              }}
            >
              <path d="M0 -6L6 0L0 6L-6 0Z" />
              <title>
                {marker.title} · {marker.detail}
              </title>
            </g>
          ))}
          <g clipPath={`url(#${clipId})`}>
            {channel === "cycles" ? (
              <>
                {threshold !== null && (
                  <g>
                    <line
                      x1={left}
                      x2={width - right}
                      y1={y(threshold)}
                      y2={y(threshold)}
                      className="tele-threshold"
                    />
                    <text
                      x={width - right}
                      y={y(threshold) - 7}
                      textAnchor="end"
                      className="tele-threshold-label"
                    >
                      REVIEW {Math.round(threshold)} s
                    </text>
                  </g>
                )}
                {samples.map((sample) => (
                  <circle
                    key={sample.eventId}
                    cx={x(Date.parse(sample.timestamp))}
                    cy={y(sample.seconds)}
                    r={sample.conflict ? 3.2 : 2.2}
                    className={`tele-cycle-point ${sample.conflict ? "conflict" : threshold !== null && sample.seconds > threshold ? "above" : ""}`}
                  >
                    <title>
                      {sample.eventId} · {sample.seconds}s · {sample.jobId} ·{" "}
                      {formatPacific(sample.timestamp, true)}
                    </title>
                  </circle>
                ))}
              </>
            ) : (
              buckets.map((bucket) => (
                <rect
                  key={bucket.timestamp}
                  x={x(Date.parse(bucket.timestamp))}
                  y={y(bucket.events)}
                  width={barWidth}
                  height={height - bottom - y(bucket.events)}
                  className={`tele-event-bar ${activeBucket === bucket ? "active" : ""}`}
                >
                  <title>
                    {formatPacific(bucket.timestamp, true)} · {bucket.events}{" "}
                    events
                  </title>
                </rect>
              ))
            )}
            {active && (
              <g>
                <line
                  x1={x(Date.parse(active.timestamp))}
                  x2={x(Date.parse(active.timestamp))}
                  y1={top}
                  y2={height - bottom}
                  className="tele-crosshair"
                />
                <circle
                  cx={x(Date.parse(active.timestamp))}
                  cy={y(active.seconds)}
                  r="5.5"
                  className="tele-active-point"
                />
              </g>
            )}
            {brush && (
              <rect
                x={x(Math.min(...brush))}
                y={top}
                width={Math.max(0, Math.abs(x(brush[1]) - x(brush[0])))}
                height={height - bottom - top}
                className="tele-brush"
              />
            )}
          </g>
          {!observations.length && (
            <text
              x={width / 2}
              y={height / 2}
              textAnchor="middle"
              className="tele-chart-empty"
            >
              {channel === "cycles"
                ? "No cycle durations. Try event volume or broaden the window."
                : "No recorded activity in this window."}
            </text>
          )}
        </svg>
      </div>
      <div className="tele-readout" aria-live="polite">
        {activeMarker ? (
          <>
            <TriangleAlert size={14} />
            <strong>{activeMarker.title}</strong>
            <span>{formatPacific(activeMarker.timestamp, true)}</span>
            <code>{activeMarker.eventId}</code>
            <button onClick={() => inspectMarker(activeMarker)}>
              Inspect source
              <ArrowUpRight size={13} />
            </button>
          </>
        ) : active ? (
          <>
            <span className="tele-readout-dot" />
            <strong>{seconds(active.seconds)}</strong>
            <span>{formatPacific(active.timestamp, true)}</span>
            <code>{active.eventId}</code>
            <span>
              {active.quantity === null
                ? "Quantity unresolved"
                : `${active.quantity} reported units`}
            </span>
            <button onClick={() => onOpenJob(active.jobId)}>
              Inspect {active.jobId}
              <ArrowUpRight size={13} />
            </button>
          </>
        ) : activeBucket ? (
          <>
            <span className="tele-readout-dot" />
            <strong>{number(activeBucket.events)} events</strong>
            <span>
              Bucket begins {formatPacific(activeBucket.timestamp, true)}
            </span>
            <span>{number(activeBucket.cycles)} cycle events</span>
            <span>P50 {seconds(activeBucket.p50CycleSeconds)}</span>
          </>
        ) : (
          <>
            <Crosshair size={14} />
            <span>
              {channel === "cycles"
                ? "Hover or focus the chart to inspect a recorded cycle."
                : "Hover or use arrow keys to inspect event buckets; gaps are not inferred downtime."}
            </span>
          </>
        )}
      </div>
    </>
  );
}

function ActivityHeatmap({
  cells,
  window,
  onSelect,
}: {
  cells: TelemetryResponse["heatmap"];
  window: TelemetryResponse["window"];
  onSelect: (day: string, hour: number) => void;
}) {
  const days: string[] = [];
  const first = Date.parse(pacificDay(window.from) + "T00:00:00Z");
  const last = Date.parse(pacificDay(window.to) + "T00:00:00Z");
  for (let day = first; day <= last; day += 86_400_000)
    days.push(new Date(day).toISOString().slice(0, 10));
  const lookup = new Map(
    cells.map((cell) => [`${cell.day}:${cell.hour}`, cell]),
  );
  const max = Math.max(1, ...cells.map((cell) => cell.events));
  return (
    <section className="panel tele-heatmap">
      <div className="panel-heading">
        <div>
          <div className="section-label">TEMPORAL DISTRIBUTION</div>
          <h2>Scope activity · Pacific Time</h2>
        </div>
        <span className="tele-caption">
          Select an observed hour to focus the analysis window
        </span>
      </div>
      <div className="tele-heatmap-scroll">
        <div className="tele-heatmap-grid">
          <div className="tele-heatmap-row tele-heatmap-hours">
            <span>DAY / HOUR</span>
            {Array.from({ length: 24 }, (_, hour) => (
              <small key={hour}>{String(hour).padStart(2, "0")}</small>
            ))}
          </div>
          {days.map((day) => (
            <div className="tele-heatmap-row" key={day}>
              <span>{formatPacific(day)}</span>
              {Array.from({ length: 24 }, (_, hour) => {
                const cell = lookup.get(`${day}:${hour}`);
                return (
                  <button
                    key={hour}
                    disabled={!cell?.events}
                    onClick={() => onSelect(day, hour)}
                    style={{
                      background: `rgba(83,214,223,${cell?.events ? 0.14 + (cell.events / max) * 0.78 : 0.025})`,
                    }}
                    aria-label={`${day} ${hour}:00 Pacific, ${cell?.events ?? 0} events`}
                    title={`${day} ${String(hour).padStart(2, "0")}:00 Pacific · ${cell?.events ?? 0} events · ${cell?.cycles ?? 0} cycles`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="panel-note">
        Recorded events, including simultaneous jobs. Empty cells indicate no
        recorded events, not measured machine availability.
      </div>
    </section>
  );
}
