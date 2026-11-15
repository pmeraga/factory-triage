export interface ManufacturingEvent {
  event_id: string;
  timestamp: string;
  event_type: string;
  job_id: string;
  part_id: string;
  customer_id: string;
  machine_id: string | null;
  material: string;
  quantity: number | null;
  metadata: Record<string, any>;
  conflict?: boolean;
  variants?: ManufacturingEvent[];
}
export interface BlockInterval {
  start: string;
  end: string | null;
  reason: string;
  hours: number;
  eventId: string;
}
export interface Job {
  id: string;
  partId: string;
  customerId: string;
  material: string;
  facility: string;
  priority: string;
  createdAt: string;
  dueAt: string;
  startedAt: string | null;
  toolReadyAt: string | null;
  completedAt: string | null;
  lastEventAt: string;
  status: "completed" | "blocked" | "in_progress" | "not_started";
  overdue: boolean;
  late: boolean;
  blocked: boolean;
  blockReason: string | null;
  blockedSince: string | null;
  blockedHours: number;
  totalBlockedHours: number;
  ageHours: number;
  overdueHours: number;
  targetQuantity: number;
  goodQuantity: number | null;
  scrapQuantity: number | null;
  machineIds: string[];
  unassignedMachineEvents?: number;
  toolId: string | null;
  eventCount: number;
  qualityMismatch: boolean;
  conflictIds: string[];
  queueHours: number | null;
  cycleSecondsMedian: number | null;
  inspectionPassed: number;
  inspectionFailed: number;
}
export interface Stats {
  jobs: number;
  completed: number;
  open: number;
  overdueOpen: number;
  blockedOpen: number;
  lateCompleted: number;
  totalGood: number;
  totalScrap: number;
  scrapRate: number | null;
  onTimeRate: number | null;
  qualityMismatchJobs: number;
}
export interface DataQuality {
  rawEvents: number;
  uniqueEvents: number;
  exactDuplicates: number;
  conflictingIds: string[];
  qualityMismatchJobIds: string[];
  issues: {
    type: string;
    title: string;
    description: string;
    count: number;
    jobIds: string[];
    eventIds?: string[];
  }[];
}
export interface Overview {
  window?: import("./telemetry-types").AnalysisWindow;
  windowEventCount?: number;
  asOf: string;
  periodStart: string;
  stats: Stats;
  jobs: Job[];
  trends: {
    date: string;
    completed: number;
    late: number;
    good: number;
    scrap: number;
  }[];
  defects: { code: string; quantity: number }[];
  blockReasons: {
    reason: string;
    jobs: number;
    openJobs: number;
    totalHours: number;
  }[];
  materials: {
    material: string;
    completedJobs: number;
    good: number;
    scrap: number;
    scrapRate: number | null;
  }[];
  dataQuality: DataQuality;
  filters: {
    customers: string[];
    materials: string[];
    machines: string[];
    facilities: string[];
  };
}
export interface JobDetail {
  asOf?: string;
  job: Job;
  events: ManufacturingEvent[];
  blockIntervals: BlockInterval[];
}
