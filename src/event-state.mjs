/** @typedef {{eType?: string, eSearch?: string, eConflict?: string, eSort?: string, eSize?: string, eFrom?: string, eTo?: string, event?: string}} EventViewState */

export const EVENT_VIEW_KEYS = [
  "eType",
  "eSearch",
  "eConflict",
  "eSort",
  "eSize",
  "eFrom",
  "eTo",
  "event",
];

function validInstant(value) {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map((part) => Number(part ?? 0));
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate() &&
    hour < 24 &&
    minute < 60 &&
    second < 60
  );
}

/** Canonicalize URL state without writing history or changing the caller's object.
 * @param {EventViewState} value
 * @returns {Required<EventViewState>}
 */
export function normalizeEventViewState(value = {}) {
  const validWindow =
    validInstant(value.eFrom) &&
    validInstant(value.eTo) &&
    Date.parse(value.eFrom) <= Date.parse(value.eTo);
  return {
    eSearch: value.eSearch ?? "",
    eType: value.eType ?? "",
    eConflict: ["true", "1", "yes"].includes(
      (value.eConflict ?? "").toLowerCase(),
    )
      ? "true"
      : "",
    eSort: [
      "timestamp_desc",
      "timestamp_asc",
      "type_asc",
      "quantity_desc",
    ].includes(value.eSort ?? "")
      ? value.eSort
      : "timestamp_desc",
    eSize: ["25", "50", "100", "200"].includes(value.eSize ?? "")
      ? value.eSize
      : "50",
    eFrom: validWindow ? new Date(value.eFrom).toISOString() : "",
    eTo: validWindow ? new Date(value.eTo).toISOString() : "",
    event: value.event ?? "",
  };
}

/** Build the single request scope used by the table, event inspector, and export.
 * @param {string} query
 * @param {EventViewState} state
 * @param {number} page
 */
export function eventParameters(query, state = {}, page = 1) {
  const params = new URLSearchParams(
    query.startsWith("?") ? query.slice(1) : query,
  );
  for (const key of EVENT_VIEW_KEYS) params.delete(key);
  const normalized = normalizeEventViewState(state);
  for (const [name, value] of [
    ["eventSearch", normalized.eSearch],
    ["eventType", normalized.eType],
    ["conflictsOnly", normalized.eConflict],
  ]) {
    if (value) params.set(name, value);
    else params.delete(name);
  }
  if (normalized.eFrom && normalized.eTo) {
    params.set("from", normalized.eFrom);
    params.set("to", normalized.eTo);
    params.set("asOf", normalized.eTo);
  }
  params.set("sort", normalized.eSort);
  params.set("page", String(Math.max(1, Math.floor(page))));
  params.set("pageSize", normalized.eSize);
  return params;
}

/** Export the full matching cohort, preserving scope and sort but not pagination. */
export function eventExportParameters(query) {
  const params = new URLSearchParams(query);
  params.delete("page");
  params.delete("pageSize");
  return params;
}

/** Clip a histogram bucket to the actual visible window, including DST boundaries.
 * @param {{series: {timestamp: string}[], window: {from: string, to: string}} data
 * @param {number} index
 */
export function eventBucketBounds(data, index) {
  const bucket = data.series[index];
  if (!bucket) return null;
  const start = Math.max(
    Date.parse(bucket.timestamp),
    Date.parse(data.window.from),
  );
  const end = Math.min(
    data.series[index + 1]
      ? Date.parse(data.series[index + 1].timestamp) - 1
      : Date.parse(data.window.to),
    Date.parse(data.window.to),
  );
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? { from: new Date(start).toISOString(), to: new Date(end).toISOString() }
    : null;
}
