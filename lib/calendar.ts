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
