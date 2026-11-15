import type { Job, ManufacturingEvent } from "./types";

export interface AnalysisWindow {
  from: string;
  to: string;
  sourceStart: string;
  sourceEnd: string;
  timezone: string;
  isReplay: boolean;
}
export interface SignalBucket {
  timestamp: string;
  events: number;
  cycles: number;
  reportedUnits: number;
  good: number;
  scrap: number;
  p50CycleSeconds: number | null;
  p90CycleSeconds: number | null;
}
export interface MachineSummary {
  id: string;
  kind: "press" | "inspection" | "tooling" | "other";
  eventCount: number;
  jobCount: number;
  cycleCount: number;
  reportedUnits: number;
  unresolvedQuantityEvents: number;
  p50CycleSeconds: number | null;
  p90CycleSeconds: number | null;
  inspectionPassed: number;
  inspectionFailed: number;
  blockedJobCount: number;
  lastEventAt: string | null;
  lastEventType: string | null;
  activity: SignalBucket[];
}
export interface CycleSample {
  eventId: string;
  jobId: string;
  machineId: string;
  partId: string;
  material: string;
  timestamp: string;
  seconds: number;
  quantity: number | null;
  conflict: boolean;
}
export interface RecordedSignal {
  id: string;
  kind:
    | "sensor_glitch"
    | "quantity_conflict"
    | "quality_mismatch"
    | "unresolved_block";
  severity: "warning" | "critical" | "info";
  timestamp: string;
  jobId: string;
  machineId: string | null;
  eventId?: string;
  title: string;
  detail: string;
}
export interface TelemetryResponse {
  window: AnalysisWindow;
  summary: {
    events: number;
    cycles: number;
    reportedUnits: number;
    unresolvedQuantityEvents: number;
    p50CycleSeconds: number | null;
    p90CycleSeconds: number | null;
    completions: number;
    blockedJobs: number;
    recordedSignals: number;
  };
  series: SignalBucket[];
  machines: MachineSummary[];
  cycleSamples: CycleSample[];
  cycleSampleTotal: number;
  signals: RecordedSignal[];
  heatmap: { day: string; hour: number; events: number; cycles: number }[];
  flow: {
    stages: { key: string; label: string; jobs: number }[];
    leadHours: { p50: number | null; p90: number | null };
    queueHours: { p50: number | null; p90: number | null };
    blockedHours: { p50: number | null; p90: number | null };
  };
}
export interface EventsResponse {
  window: AnalysisWindow;
  items: ManufacturingEvent[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  eventTypes: { type: string; count: number }[];
  series: { timestamp: string; count: number }[];
}
export interface EventViewState {
  eType?: string;
  eSearch?: string;
  eConflict?: string;
  eSort?: string;
  eSize?: string;
  eFrom?: string;
  eTo?: string;
  event?: string;
}
export interface ExplorerProps {
  query: string;
  onOpenJob: (jobId: string) => void;
  onSelectMachine: (machineId: string) => void;
  onOpenEvent?: (eventId: string) => void;
  viewState?: EventViewState;
  onStateChange?: (state: EventViewState) => void;
  onInspectWindow?: (from: string, to: string) => void;
}
export interface MachineTelemetryProps extends ExplorerProps {}
export interface CompareProps {
  jobs: Job[];
  onOpenJob: (jobId: string) => void;
  onRemove: (jobId: string) => void;
  onClear: () => void;
}
