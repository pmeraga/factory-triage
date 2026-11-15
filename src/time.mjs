export const DISPLAY_TIME_ZONE = "America/Los_Angeles";
export const DISPLAY_ZONE_LABEL = "Pacific";

const calendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const wallClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const parts = (formatter, value) =>
  Object.fromEntries(
    formatter
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
export function pacificDay(value) {
  const p = parts(calendar, value);
  return `${p.year}-${p.month}-${p.day}`;
}
export function formatPacific(value, includeTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(value + "T12:00:00Z")
    : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
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
  }).format(date);
}
export function formatPacificTime(value) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
export function pacificInput(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const p = parts(wallClock, value);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function fromPacificInput(value) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!match) throw new Error("Choose a valid Pacific date and time.");
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map((part) => Number(part || 0));
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wanted);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error("Choose a valid Pacific date and time.");
  }
  let guess = wanted;
  for (let i = 0; i < 5; i++) {
    const p = parts(wallClock, guess);
    const actual = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    const adjustment = wanted - actual;
    if (adjustment === 0) return new Date(guess).toISOString();
    guess += adjustment;
  }
  throw new Error(
    "That local time does not exist because of daylight saving time. Choose another time.",
  );
}

/** Inclusive bounds for one Pacific heatmap cell, including a repeated DST hour. */
export function pacificHourBounds(day, hour) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23
  ) {
    throw new Error("Choose a valid Pacific calendar day and hour.");
  }
  const input = `${day}T${String(hour).padStart(2, "0")}:00`;
  let start = Date.parse(fromPacificInput(input));
  // If a wall-clock resolver chooses the later occurrence, include the earlier
  // matching hour too. This leaves unambiguous hours unchanged.
  const matches = (value) => {
    const p = parts(wallClock, value);
    return `${p.year}-${p.month}-${p.day}` === day && Number(p.hour) === hour;
  };
  while (matches(start - 3_600_000)) start -= 3_600_000;
  const calendarStart = Date.parse(day + "T00:00:00Z");
  let end;
  for (let next = hour + 1; next <= hour + 3; next++) {
    const nextInput = new Date(calendarStart + next * 3_600_000)
      .toISOString()
      .slice(0, 16);
    try {
      end = Date.parse(fromPacificInput(nextInput));
      break;
    } catch (error) {
      if (!String(error.message).includes("daylight saving time")) throw error;
      // Spring forward skips a wall-clock hour. The next valid local boundary
      // still ends the preceding observed hour after one real elapsed hour.
    }
  }
  if (!Number.isFinite(end) || end <= start)
    throw new Error("Unable to resolve that Pacific hour.");
  return {
    from: new Date(start).toISOString(),
    to: new Date(end - 1).toISOString(),
  };
}
