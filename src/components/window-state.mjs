import { fromPacificInput, pacificInput } from "../time.mjs";

/** Keep source seconds when a minute-resolution input has not changed. */
export function preservePacificInput(draft, original) {
  return draft === pacificInput(original) ? original : fromPacificInput(draft);
}

/** Move by Pacific calendar days while retaining the source seconds. */
export function stepPacificDay(value, direction) {
  const instant = new Date(value);
  const wall = new Date(pacificInput(value) + ":00Z");
  wall.setUTCDate(wall.getUTCDate() + direction);
  const remainder =
    instant.getUTCSeconds() * 1000 + instant.getUTCMilliseconds();
  return new Date(
    Date.parse(fromPacificInput(wall.toISOString().slice(0, 16))) + remainder,
  ).toISOString();
}

export function clampReplayEnd(value, sourceStart, sourceEnd) {
  return Math.min(sourceEnd, Math.max(sourceStart, value));
}

/** Match the API's source-boundary normalization without reordering a window. */
export function clampSourceInstant(value, fallback, sourceStart, sourceEnd) {
  const requested = Date.parse(value || fallback);
  return new Date(
    Math.min(
      Date.parse(sourceEnd),
      Math.max(Date.parse(sourceStart), requested),
    ),
  ).toISOString();
}
