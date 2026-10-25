import { z } from 'zod';
import { callModel } from '../llm/client.js';
import { buildScheduleMessage, type ScheduleActivity } from '../prompts/plan-schedule.js';

/** How long one plan's schedule runs. The plan page already promises "the next two weeks". */
export const SCHEDULE_DAYS = 14;
export const MAX_PER_DAY = 3;

const ScheduleOutputSchema = z.object({
  days: z.array(z.object({
    day: z.number().int(),
    activityIndexes: z.array(z.number().int()),
  })),
});

export interface ScheduleResult {
  /** days[i] = activity indexes for day i+1 (day 1 = startDate). */
  days: number[][];
  source: 'model' | 'fallback';
}

/** Saturday or Sunday for day `dayIndex` (0-based) counted from `startDate`. */
function isWeekend(startDate: string, dayIndex: number): boolean {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayIndex);
  const wd = d.getUTCDay();
  return wd === 0 || wd === 6;
}

/**
 * Cleans the model's schedule rather than trusting it: drops unknown or
 * duplicate indexes, "local" outings on weekdays, and anything past
 * MAX_PER_DAY. Returns null — so the caller falls back — when the result
 * isn't usable: wrong number of days, or an activity that never appears.
 */
export function sanitizeSchedule(
  raw: z.infer<typeof ScheduleOutputSchema>,
  activities: Array<{ kind: string }>,
  startDate: string,
  numberOfDays: number,
): number[][] | null {
  const byDay = new Map(raw.days.map(d => [d.day, d.activityIndexes]));
  const days: number[][] = [];

  for (let i = 0; i < numberOfDays; i++) {
    const seen = new Set<number>();
    const clean: number[] = [];
    for (const idx of byDay.get(i + 1) ?? []) {
      if (idx < 0 || idx >= activities.length || seen.has(idx)) continue;
      if (activities[idx].kind === 'local' && !isWeekend(startDate, i)) continue;
      seen.add(idx);
      clean.push(idx);
      if (clean.length === MAX_PER_DAY) break;
    }
    days.push(clean);
  }

  const used = new Set(days.flat());
  if (activities.some((_, idx) => !used.has(idx))) return null;
  if (days.every(d => d.length === 0)) return null;
  return days;
}

/**
 * No-model schedule, used when the schedule call fails or returns something
 * unusable, so a plan is never left without a Today list. Round-robins
 * through the activities, filling each day up to its share of the weekly
 * budget (always at least one activity), with outings on weekends only.
 */
export function fallbackSchedule(
  activities: Array<{ kind: string; estimatedMinutes: number | null }>,
  weeklyMinutes: number,
  startDate: string,
  numberOfDays: number,
): number[][] {
  const dailyBudget = Math.max(10, Math.round(weeklyMinutes / 7));
  const home = activities.map((a, i) => ({ a, i })).filter(x => x.a.kind !== 'local');
  const local = activities.map((a, i) => ({ a, i })).filter(x => x.a.kind === 'local');
  let homePtr = 0;
  let localPtr = 0;
  const days: number[][] = [];

  for (let d = 0; d < numberOfDays; d++) {
    const day: number[] = [];
    let minutes = 0;
    const add = (idx: number) => {
      day.push(idx);
      minutes += activities[idx].estimatedMinutes ?? 15;
    };

    if (isWeekend(startDate, d) && local.length > 0) {
      add(local[localPtr % local.length].i);
      localPtr++;
    }
    for (let tries = 0; tries < home.length && day.length < MAX_PER_DAY; tries++) {
      const next = home[homePtr % home.length];
      const cost = next.a.estimatedMinutes ?? 15;
      if (day.length > 0 && minutes + cost > dailyBudget) break;
      homePtr++;
      if (!day.includes(next.i)) add(next.i);
    }
    if (day.length === 0 && local.length > 0 && home.length === 0) add(local[0].i);
    days.push(day);
  }
  return days;
}

/**
 * Day-by-day schedule for a freshly generated plan: one model call
 * (stage "schedule"), checked by sanitizeSchedule, falling back to
 * fallbackSchedule on any failure. Never throws for a model problem — a
 * plan with a plain schedule beats a plan that failed over its calendar.
 */
export async function buildPlanSchedule(
  activities: Array<{ kind: string; title: string; instructions: string; estimatedMinutes: number | null }>,
  weeklyMinutes: number,
  startDate: string,
  familyId?: string,
  requestId?: string,
): Promise<ScheduleResult> {
  const numberOfDays = SCHEDULE_DAYS;
  const input: ScheduleActivity[] = activities.map((a, index) => ({
    index,
    title: a.title,
    kind: a.kind,
    estimatedMinutes: a.estimatedMinutes ?? 15,
    why: a.instructions,
  }));

  try {
    const result = await callModel(
      'schedule',
      buildScheduleMessage({ startDate, numberOfDays, weeklyMinutes, activities: input }),
      ScheduleOutputSchema,
      familyId,
      requestId,
    );
    if (result.ok) {
      const days = sanitizeSchedule(result.value, activities, startDate, numberOfDays);
      if (days) return { days, source: 'model' };
      console.warn('[plan.schedule] model schedule unusable after cleaning — using fallback');
    } else {
      console.warn('[plan.schedule] model call failed — using fallback:', JSON.stringify(result.error));
    }
  } catch (err) {
    console.warn('[plan.schedule] model call threw — using fallback:', err);
  }

  return { days: fallbackSchedule(activities, weeklyMinutes, startDate, numberOfDays), source: 'fallback' };
}
