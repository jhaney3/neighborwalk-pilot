export const DEFAULT_CHURCH_TIMEZONE = "America/Chicago";

export function calendarDate(value: string | Date, timezone = DEFAULT_CHURCH_TIMEZONE): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function calendarDaysFromNow(days: number, timezone = DEFAULT_CHURCH_TIMEZONE, now = new Date()): string {
  const date = new Date(`${calendarDate(now, timezone)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatCalendarDate(value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

export function localDateTimeValue(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** Convert a wall-clock choice in the church timezone, rejecting DST gaps and
 * ambiguous repeated hours rather than silently changing an outing time. */
export function churchDateTimeToIso(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a complete date and time.");
  const wallTime = Date.parse(value + ":00Z");
  const offsets = new Set([-86400000, 0, 86400000].map((delta) => {
    const instant = wallTime + delta;
    return Date.parse(localDateTimeValue(new Date(instant).toISOString(), timezone) + ":00Z") - instant;
  }));
  const matches = [...offsets].map((offset) => new Date(wallTime - offset).toISOString()).filter((instant) => localDateTimeValue(instant, timezone) === value);
  if (matches.length !== 1) throw new Error(matches.length ? "This time repeats when daylight saving ends. Choose a time outside the repeated hour." : "This local time does not exist when daylight saving begins. Choose another time.");
  return matches[0];
}
