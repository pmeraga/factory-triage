import { useEffect, useRef, useState } from "react";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  History,
  RotateCcw,
} from "lucide-react";
import type { AnalysisWindow } from "../telemetry-types";
import { formatPacific, pacificInput } from "../time.mjs";
import {
  preservePacificInput,
  stepPacificDay,
  clampReplayEnd,
  clampSourceInstant,
} from "./window-state.mjs";

export interface WindowValue {
  from: string;
  asOf: string;
}
interface Props {
  window: AnalysisWindow;
  value: WindowValue;
  onChange: (value: WindowValue) => void;
}
const DAY = 86_400_000;
export default function WindowControls({
  window: range,
  value,
  onChange,
}: Props) {
  const from = clampSourceInstant(
    value.from,
    range.sourceStart,
    range.sourceStart,
    range.sourceEnd,
  );
  const to = clampSourceInstant(
    value.asOf,
    range.sourceEnd,
    range.sourceStart,
    range.sourceEnd,
  );
  const [draftFrom, setDraftFrom] = useState(pacificInput(from));
  const [draftTo, setDraftTo] = useState(pacificInput(to));
  const [cursor, setCursor] = useState(Date.parse(to));
  const [error, setError] = useState("");
  const lastCommitted = useRef(`${Date.parse(from)}:${Date.parse(to)}`);
  useEffect(() => {
    lastCommitted.current = `${Date.parse(from)}:${Date.parse(to)}`;
    setDraftFrom(pacificInput(from));
    setDraftTo(pacificInput(to));
    setCursor(Date.parse(to));
    setError("");
  }, [from, to]);
  const sourceStart = Date.parse(range.sourceStart),
    sourceEnd = Date.parse(range.sourceEnd);
  const selectedDays = (Date.parse(to) - Date.parse(from)) / DAY;
  const replay = Date.parse(to) < sourceEnd;
  const apply = () => {
    try {
      const nextFrom = preservePacificInput(draftFrom, from),
        nextTo = preservePacificInput(draftTo, to);
      if (Date.parse(nextFrom) > Date.parse(nextTo))
        throw new Error("The start must be before the replay time.");
      if (
        Date.parse(nextFrom) < sourceStart - 60_000 ||
        Date.parse(nextTo) > sourceEnd + 60_000
      )
        throw new Error("Choose a window within the source dataset.");
      if (draftFrom === pacificInput(from) && draftTo === pacificInput(to)) {
        setEnd(cursor);
        setError("");
        return;
      }
      setError("");
      onChange({
        from: new Date(
          Math.max(sourceStart, Date.parse(nextFrom)),
        ).toISOString(),
        asOf: new Date(Math.min(sourceEnd, Date.parse(nextTo))).toISOString(),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Choose a valid time window.",
      );
    }
  };
  const setEnd = (next: number) => {
    const clamped = clampReplayEnd(next, sourceStart, sourceEnd);
    const nextFrom = Math.min(Date.parse(from), clamped);
    const key = `${nextFrom}:${clamped}`;
    setCursor(clamped);
    if (key === lastCommitted.current) return;
    lastCommitted.current = key;
    onChange({
      from: new Date(nextFrom).toISOString(),
      asOf: clamped === sourceEnd ? "" : new Date(clamped).toISOString(),
    });
  };
  const stepDay = (direction: number) => {
    try {
      setEnd(Date.parse(stepPacificDay(to, direction)));
      setError("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That Pacific time is unavailable. Choose another time.",
      );
    }
  };
  const preset = (days: number | null) => {
    setError("");
    if (days === null) {
      onChange({ from: "", asOf: "" });
      return;
    }
    onChange({
      from: new Date(
        Math.max(sourceStart, Date.parse(to) - days * DAY),
      ).toISOString(),
      asOf: value.asOf,
    });
  };
  return (
    <section className="window-control" aria-label="Analysis time window">
      <div className="window-main">
        <div className="window-label">
          <CalendarRange size={15} />
          <span>ANALYSIS WINDOW</span>
          <b>Pacific</b>
        </div>
        <div className="window-presets" aria-label="Window duration">
          {[
            [null, "All"],
            [7, "7d"],
            [14, "14d"],
            [30, "30d"],
          ].map(([days, label]) => (
            <button
              key={String(label)}
              aria-pressed={
                days === null
                  ? Date.parse(from) === sourceStart &&
                    Date.parse(to) === sourceEnd
                  : Math.abs(selectedDays - Number(days)) < 0.01
              }
              onClick={() => preset(days as number | null)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="window-inputs">
          <label>
            From
            <input
              aria-label="Window start in Pacific time"
              type="datetime-local"
              value={draftFrom}
              min={pacificInput(range.sourceStart)}
              max={pacificInput(to)}
              onChange={(e) => setDraftFrom(e.target.value)}
            />
          </label>
          <span className="window-arrow">→</span>
          <label>
            As of
            <input
              aria-label="Replay time in Pacific time"
              type="datetime-local"
              value={draftTo}
              min={pacificInput(from)}
              max={pacificInput(range.sourceEnd)}
              onChange={(e) => setDraftTo(e.target.value)}
            />
          </label>
          <button className="button window-apply" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
      <div className="replay-row">
        <span className={replay ? "replay-mode active" : "replay-mode"}>
          <History size={13} />
          {replay ? "Historical replay" : "Source end"}
        </span>
        <button
          className="icon-button"
          aria-label="Step replay back one Pacific day"
          disabled={Date.parse(to) <= sourceStart}
          onClick={() => stepDay(-1)}
        >
          <ChevronLeft size={15} />
        </button>
        <input
          className="replay-slider"
          aria-label="Historical replay cursor"
          aria-valuetext={formatPacific(new Date(cursor).toISOString(), true)}
          type="range"
          min={sourceStart}
          max={sourceEnd}
          step={1000}
          value={cursor}
          onChange={(e) => setCursor(Number(e.target.value))}
          onPointerUp={(e) => setEnd(Number(e.currentTarget.value))}
          onBlur={(e) => setEnd(Number(e.currentTarget.value))}
          onKeyUp={(e) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(e.key)
            )
              setEnd(Number(e.currentTarget.value));
          }}
        />
        <button
          className="icon-button"
          aria-label="Step replay forward one Pacific day"
          disabled={Date.parse(to) >= sourceEnd}
          onClick={() => stepDay(1)}
        >
          <ChevronRight size={15} />
        </button>
        <span className="replay-readout">
          {formatPacific(new Date(cursor).toISOString(), true)}
        </span>
        <button
          className="text-button"
          disabled={!replay}
          onClick={() => setEnd(sourceEnd)}
        >
          <RotateCcw size={12} /> Source end
        </button>
      </div>
      {error && (
        <p className="window-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
