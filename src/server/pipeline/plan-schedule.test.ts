import { describe, it, expect } from 'vitest';
import { sanitizeSchedule, fallbackSchedule, MAX_PER_DAY } from './plan-schedule.js';

// 2026-10-26 is a Monday, so days 6 and 7 (indexes 5, 6) are Sat/Sun.
const MONDAY = '2026-10-26';

const activities = [
  { kind: 'home', estimatedMinutes: 10 },
  { kind: 'resource', estimatedMinutes: 15 },
  { kind: 'home', estimatedMinutes: 10 },
  { kind: 'local', estimatedMinutes: 45 },
];

function raw(days: number[][]) {
  return { days: days.map((activityIndexes, i) => ({ day: i + 1, activityIndexes })) };
}

describe('sanitizeSchedule', () => {
  it('keeps a valid schedule as-is', () => {
    const days = [[0, 1], [2], [0], [1], [2], [3, 0], [1, 2]];
    expect(sanitizeSchedule(raw(days), activities, MONDAY, 7)).toEqual(days);
  });

  it('drops unknown and duplicate indexes and caps each day', () => {
    const result = sanitizeSchedule(raw([[0, 0, 9, -1, 1, 2, 3], [1], [2], [0], [1], [3], [2]]), activities, MONDAY, 7);
    expect(result?.[0]).toEqual([0, 1, 2]);
    expect(result?.[0].length).toBeLessThanOrEqual(MAX_PER_DAY);
  });

  it('removes outings scheduled on weekdays', () => {
    const result = sanitizeSchedule(raw([[3, 0], [1], [2], [0], [1], [3], [2]]), activities, MONDAY, 7);
    expect(result?.[0]).toEqual([0]);
    expect(result?.[5]).toEqual([3]);
  });

  it('rejects a schedule that never uses an activity', () => {
    expect(sanitizeSchedule(raw([[0], [1], [0], [1], [0], [1], [0]]), activities, MONDAY, 7)).toBeNull();
  });

  it('treats missing days as empty and still requires coverage', () => {
    const result = sanitizeSchedule({ days: [{ day: 1, activityIndexes: [0, 1, 2] }, { day: 6, activityIndexes: [3] }] }, activities, MONDAY, 7);
    expect(result).toEqual([[0, 1, 2], [], [], [], [], [3], []]);
  });
});

describe('fallbackSchedule', () => {
  const days = fallbackSchedule(activities, 105, MONDAY, 14); // 15 min/day budget

  it('schedules every day with at least one activity', () => {
    expect(days).toHaveLength(14);
    for (const d of days) expect(d.length).toBeGreaterThan(0);
  });

  it('puts outings only on weekends', () => {
    days.forEach((d, i) => {
      const weekend = i % 7 === 5 || i % 7 === 6;
      if (!weekend) expect(d).not.toContain(3);
    });
  });

  it('uses every activity and never repeats one within a day', () => {
    expect(new Set(days.flat())).toEqual(new Set([0, 1, 2, 3]));
    for (const d of days) expect(new Set(d).size).toBe(d.length);
  });

  it('keeps weekdays within the daily budget beyond the first activity', () => {
    days.forEach((d, i) => {
      const weekend = i % 7 === 5 || i % 7 === 6;
      if (weekend || d.length <= 1) return;
      const minutes = d.reduce((sum, idx) => sum + activities[idx].estimatedMinutes, 0);
      expect(minutes).toBeLessThanOrEqual(15);
    });
  });
});
