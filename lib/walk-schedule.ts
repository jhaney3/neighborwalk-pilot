import { calendarDate, calendarDaysFromNow, formatCalendarDate } from "./calendar";

export type DayChoice = { label: string; date: string };

/** Quick day choices for planning a walk: tomorrow and the coming weekend. */
export function walkDayChoices(timezone: string, now = new Date()): DayChoice[] {
  const today = calendarDate(now, timezone);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const untilSaturday = ((6 - weekday + 7) % 7) || 7;
  const days = [1, untilSaturday, untilSaturday + 1];
  const seen = new Set<string>();
  return days.flatMap((offset) => {
    const date = calendarDaysFromNow(offset, timezone, now);
    if (seen.has(date)) return [];
    seen.add(date);
    return [{ label: offset === 1 ? "Tomorrow" : `${formatCalendarDate(date, { weekday: "short" })} ${formatCalendarDate(date, { day: "numeric" })}`, date }];
  });
}

export const walkStartTimes = ["09:00", "09:30", "10:00", "18:00"];
export const walkDurations = [60, 90, 120, 180];

/** Adds minutes to a church-local "YYYY-MM-DDTHH:mm" value without timezone math. */
export function addLocalMinutes(value: string, minutes: number) {
  const date = new Date(`${value}:00Z`);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 16);
}

export function localMinutesBetween(start: string, end: string) {
  return Math.round((Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`)) / 60000);
}

export function clockLabel(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function durationLabel(minutes: number) {
  return minutes % 60 ? `${minutes / 60} hrs` : minutes === 60 ? "1 hr" : `${minutes / 60} hrs`;
}
