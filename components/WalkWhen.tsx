"use client";

import { useId, useState } from "react";
import { calendarDate, calendarDaysFromNow, formatCalendarDate } from "../lib/calendar";
import { clockLabel, durationLabel } from "../lib/walk-schedule";
import { selectionTick } from "../mobile/haptics";

const startChoices = ["09:00", "09:30", "10:00"];
const lengthChoices = [60, 120, 180];

/** The coming Saturday, the Sunday after it, and the Saturday after that. */
export function walkDayCards(timezone: string, now = new Date()) {
  const today = calendarDate(now, timezone);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const untilSaturday = ((6 - weekday + 7) % 7) || 7;
  return [untilSaturday, untilSaturday + 1, untilSaturday + 7].map((offset) => calendarDaysFromNow(offset, timezone, now));
}

/** When? Day cards, start chips, how long, and where to meet (BD10). */
export function WalkWhenFields({ timezone, day, time, duration, meetingPoint, lastMeetingPoint, onDay, onTime, onDuration, onMeetingPoint }: {
  timezone: string; day: string; time: string; duration: number; meetingPoint: string; lastMeetingPoint?: string;
  onDay: (day: string) => void; onTime: (time: string) => void; onDuration: (minutes: number) => void; onMeetingPoint: (value: string) => void;
}) {
  const id = useId();
  const cards = walkDayCards(timezone);
  const [pickingDay, setPickingDay] = useState(!cards.includes(day));
  const [pickingTime, setPickingTime] = useState(!startChoices.includes(time));
  const month = (date: string) => formatCalendarDate(date, { month: "short" });
  const firstMonth = month(cards[0]);
  const lengths = [...new Set([...lengthChoices, duration])].sort((a, b) => a - b);
  const pick = <T,>(set: (value: T) => void, value: T) => { selectionTick(); set(value); };
  return <div className="when-fields">
    <div className="day-cards" role="group" aria-label="Day">
      {cards.map((date) => <button type="button" key={date} aria-pressed={!pickingDay && day === date} aria-label={formatCalendarDate(date, { weekday: "long", month: "long", day: "numeric" })} onClick={() => { setPickingDay(false); pick(onDay, date); }}>
        <small>{formatCalendarDate(date, { weekday: "short" })}</small><b>{month(date) === firstMonth ? formatCalendarDate(date, { day: "numeric" }) : formatCalendarDate(date, { month: "short", day: "numeric" })}</b>
      </button>)}
      <button type="button" aria-pressed={pickingDay} aria-label="Pick another day" onClick={() => setPickingDay(true)}><small>Pick</small><b aria-hidden="true">•••</b></button>
    </div>
    {pickingDay && <input type="date" aria-label="Walk day" value={day} min={calendarDaysFromNow(0, timezone)} onChange={(event) => { if (event.target.value) onDay(event.target.value); }} />}
    <div className="walk-field">
      <span className="mono-meta" id={`${id}-start`}>Start</span>
      <div className="walk-chips" role="group" aria-labelledby={`${id}-start`}>
        {startChoices.map((choice) => <button type="button" key={choice} aria-pressed={!pickingTime && time === choice} aria-label={clockLabel(choice)} onClick={() => { setPickingTime(false); pick(onTime, choice); }}>{!pickingTime && time === choice ? clockLabel(choice) : clockLabel(choice).replace(/ [AP]M$/, "")}</button>)}
        <button type="button" aria-pressed={pickingTime} onClick={() => setPickingTime(true)}>{pickingTime ? clockLabel(time) : "Other"}</button>
      </div>
      {pickingTime && <input type="time" aria-label="Start time" value={time} onChange={(event) => { if (event.target.value) onTime(event.target.value); }} />}
    </div>
    <div className="walk-field">
      <span className="mono-meta" id={`${id}-length`}>How long</span>
      <div className="walk-chips" role="group" aria-labelledby={`${id}-length`}>
        {lengths.map((minutes) => <button type="button" key={minutes} aria-pressed={duration === minutes} onClick={() => pick(onDuration, minutes)}>{durationLabel(minutes)}</button>)}
      </div>
    </div>
    <label className="walk-field"><span className="mono-meta">Meet at</span><input value={meetingPoint} maxLength={300} enterKeyHint="done" placeholder="Church welcome table" onChange={(event) => onMeetingPoint(event.target.value)} /></label>
    {lastMeetingPoint && meetingPoint === lastMeetingPoint && <p className="mono-meta when-same">Same as last time</p>}
  </div>;
}
