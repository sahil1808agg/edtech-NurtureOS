import type { LlmMessage } from '../llm/types.js';

const SYSTEM = `
You turn a child's home-learning plan into a day-by-day schedule for a parent.

The plan is a fixed set of activities meant to be practised over the whole period — repeating an activity on several days is expected and good (practice is the point). Your job is only to decide which activities happen on which day. Do not invent, rename or change activities; refer to them by their index.

Rules:
- Schedule exactly the days given (day 1 is startDate; weekdays are listed for every day).
- Time: each 7-day week's total estimatedMinutes must not exceed weeklyMinutes. Spread it fairly evenly — roughly dailyMinutes a day — rather than piling it onto a few days. A day may be left empty only when the budget genuinely can't stretch to every day.
- Each day has 1 to 3 activities, never the same activity twice on one day.
- Every activity appears at least once in each week; the shorter home activities can repeat more often than long ones.
- kind "local" (an outing: library, park, class) goes only on Saturday or Sunday, at most once per week each. Everything else can go on any day.
- Vary each day: avoid putting two activities for the same skill area on the same day, and avoid the same activity on consecutive days when there are alternatives.

Return exactly this JSON:
{
  "days": [
    { "day": number, "activityIndexes": number[] }
  ]
}
with one entry per day, day numbers 1..numberOfDays in order.
`.trim();

export interface ScheduleActivity {
  index: number;
  title: string;
  kind: string;
  estimatedMinutes: number;
  /** The activity's own one-or-two-sentence "what and why" — lets the model judge skill area and variety. */
  why: string;
}

export interface ScheduleInput {
  startDate: string;
  numberOfDays: number;
  weeklyMinutes: number;
  activities: ScheduleActivity[];
}

export function buildScheduleMessage(input: ScheduleInput): LlmMessage {
  const start = new Date(`${input.startDate}T00:00:00Z`);
  const weekdays = Array.from({ length: input.numberOfDays }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return { day: i + 1, date: d.toISOString().slice(0, 10), weekday: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) };
  });

  return {
    system: SYSTEM,
    user: JSON.stringify({
      startDate: input.startDate,
      numberOfDays: input.numberOfDays,
      days: weekdays,
      weeklyMinutes: input.weeklyMinutes,
      dailyMinutes: Math.round(input.weeklyMinutes / 7),
      activities: input.activities,
    }),
  };
}
