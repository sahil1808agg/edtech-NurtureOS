import { serviceClient } from '../../lib/db/clients.js';
import { buildPlanSchedule, SCHEDULE_DAYS } from '../pipeline/plan-schedule.js';
import { getCurrentPlan, getFamilyConstraints, type CurrentPlanActivity } from './plans.js';

// The day-by-day schedule behind Today (migration 0020, plan_activity_days).
// Dates are plain calendar dates compared against the server's UTC date —
// the same convention snoozed_until already uses; no timezone concept
// exists anywhere in this schema.

export type DayStatus = 'todo' | 'done' | 'skipped';

export function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Writes the day-by-day schedule for a plan whose activities are already
 * saved: asks the schedule model (with its fallback — see
 * pipeline/plan-schedule.ts) which activities go on which day, starting
 * `startDate`, and stores one row per activity per day. Called right after
 * savePlanActivities() by both plan-generation paths, before the plan is
 * approved, so a plan never becomes visible without a Today list.
 */
export async function createScheduleForPlan(planId: string, requestId?: string, startDate = todayISODate()): Promise<'model' | 'fallback'> {
  const admin = serviceClient();
  const { data: plan, error: planError } = await admin
    .from('plans')
    .select('id, family_id, child_id')
    .eq('id', planId)
    .single();
  if (planError || !plan) throw new Error(`reading plan ${planId} for scheduling: ${planError?.message ?? 'not found'}`);

  const { data: activities, error: actError } = await admin
    .from('plan_activities')
    .select('id, kind, title, instructions, estimated_minutes')
    .eq('plan_id', planId)
    .eq('declined', false)
    .order('position');
  if (actError) throw new Error(`reading activities for plan ${planId}: ${actError.message}`);
  if (!activities?.length) return 'fallback';

  const { weeklyMinutes } = await getFamilyConstraints(plan.family_id);
  const schedule = await buildPlanSchedule(
    activities.map(a => ({ kind: a.kind, title: a.title, instructions: a.instructions, estimatedMinutes: a.estimated_minutes })),
    weeklyMinutes,
    startDate,
    plan.family_id,
    requestId,
  );

  const rows = schedule.days.flatMap((indexes, dayIndex) =>
    indexes.map(idx => ({
      plan_id: planId,
      activity_id: activities[idx].id,
      family_id: plan.family_id,
      child_id: plan.child_id,
      day: addDays(startDate, dayIndex),
    })),
  );

  // Replace rather than append, so re-scheduling a plan (the backfill script)
  // doesn't leave yesterday's attempt alongside today's.
  const { error: clearError } = await admin.from('plan_activity_days').delete().eq('plan_id', planId);
  if (clearError) throw new Error(`clearing schedule for plan ${planId}: ${clearError.message}`);

  if (rows.length) {
    const { error } = await admin.from('plan_activity_days').insert(rows);
    if (error) throw new Error(`saving schedule for plan ${planId}: ${error.message}`);
  }
  return schedule.source;
}

export interface ScheduledActivity extends CurrentPlanActivity {
  dayStatus: DayStatus;
}

export interface TodaySchedule {
  planId: string;
  /** Today's activities (not removed), including ones already ticked off today. */
  activities: ScheduledActivity[];
  /** First and last scheduled day of the plan, or null when it has no schedule. */
  startsOn: string | null;
  endsOn: string | null;
}

/**
 * What's on for a child on `date` (default today), from their current plan's
 * schedule. Removed activities are left out; done and skipped ones are kept
 * with their status so each surface decides whether to show them. Callers
 * check the plan is ready first.
 */
export async function getScheduleForDay(childId: string, date = todayISODate()): Promise<TodaySchedule | null> {
  const plan = await getCurrentPlan(childId);
  if (!plan) return null;

  const admin = serviceClient();
  const [{ data: dayRows, error }, { data: range, error: rangeError }] = await Promise.all([
    admin.from('plan_activity_days').select('activity_id, status').eq('plan_id', plan.planId).eq('day', date),
    admin.from('plan_activity_days').select('day').eq('plan_id', plan.planId).order('day'),
  ]);
  if (error) throw new Error(`reading schedule for plan ${plan.planId}: ${error.message}`);
  if (rangeError) throw new Error(`reading schedule range for plan ${plan.planId}: ${rangeError.message}`);

  const statusByActivity = new Map((dayRows ?? []).map(r => [r.activity_id as string, r.status as DayStatus]));
  const days = (range ?? []).map(r => r.day as string);

  return {
    planId: plan.planId,
    activities: plan.activities
      .filter(a => !a.declined && statusByActivity.has(a.id))
      .map(a => ({ ...a, dayStatus: statusByActivity.get(a.id)! })),
    startsOn: days[0] ?? null,
    endsOn: days[days.length - 1] ?? null,
  };
}

/** Today's activities still to do — the daily digest and chat context use this. */
export async function getTodaysRemainingActivities(childId: string): Promise<ScheduledActivity[]> {
  const today = await getScheduleForDay(childId);
  return (today?.activities ?? []).filter(a => a.dayStatus === 'todo');
}

/**
 * Done / Not today for one activity on one day. Returns false when the
 * activity isn't scheduled that day (nothing to mark).
 */
export async function setActivityDayStatus(activityId: string, status: DayStatus, date = todayISODate()): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from('plan_activity_days')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('activity_id', activityId)
    .eq('day', date)
    .select('id');
  if (error) throw new Error(`updating activity ${activityId} for ${date}: ${error.message}`);
  return (data ?? []).length > 0;
}

export interface ActivityScheduleEntry {
  day: string;
  status: DayStatus;
}

/** Every scheduled day per activity for a plan — the Report & plan tab's "Mon 26 · Thu 29" and "done 2 of 4". */
export async function getPlanScheduleByActivity(planId: string): Promise<Map<string, ActivityScheduleEntry[]>> {
  const { data, error } = await serviceClient()
    .from('plan_activity_days')
    .select('activity_id, day, status')
    .eq('plan_id', planId)
    .order('day');
  if (error) throw new Error(`reading schedule for plan ${planId}: ${error.message}`);

  const byActivity = new Map<string, ActivityScheduleEntry[]>();
  for (const r of data ?? []) {
    const list = byActivity.get(r.activity_id) ?? [];
    list.push({ day: r.day, status: r.status as DayStatus });
    byActivity.set(r.activity_id, list);
  }
  return byActivity;
}

export { SCHEDULE_DAYS };
