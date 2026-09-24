import { afterEach, expect, it, vi } from 'vitest';
import { createSeedData } from '../lib/seed';
import { calendarDate, localDateTimeValue } from '../lib/calendar';
afterEach(() => vi.useRealTimers());
it('keeps demo overdue tasks and outing times on the church calendar across device timezones', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T03:00:00Z'));
  const data = createSeedData();
  const tasha = data.residents.find(person => person.name === 'Tasha')!;
  const task = data.followUps.find(task => task.residentId === tasha.id)!;
  expect(calendarDate(new Date(), data.church.timezone)).toBe('2026-09-23');
  expect(task.dueAt).toBe('2026-09-22');
  expect(localDateTimeValue(data.events[0].startsAt, data.church.timezone)).toBe('2026-09-23T09:30');
});
