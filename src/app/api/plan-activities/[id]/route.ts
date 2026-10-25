import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { getPlanActivityForEdit, updatePlanActivity } from '../../../../server/db/plans';
import { setActivityDayStatus, type DayStatus } from '../../../../server/db/schedule';

export const runtime = 'nodejs';

/**
 * The web (non-chat) equivalent of chat's edit_plan_activity tool — backs
 * the Today card and plan page's Done / Not today / Remove buttons.
 *
 * `today: 'done' | 'skipped' | 'todo'` acts on this activity's entry in
 * today's schedule only (plan_activity_days) — Done on Monday doesn't hide
 * Thursday's. Removing (declined: true) acts on the whole activity; triggering
 * a plan regeneration afterward is the caller's job (TodayActivityActions.tsx
 * POSTs /api/children/[id]/plan itself), not this route's.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: activityId } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const activity = await getPlanActivityForEdit(activityId);
  if (!activity || activity.familyId !== user.familyId) {
    return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const completed = typeof body?.completed === 'boolean' ? body.completed : undefined;
  const declined = typeof body?.declined === 'boolean' ? body.declined : undefined;
  const snoozedUntil =
    body?.snoozedUntil === null ? null : typeof body?.snoozedUntil === 'string' ? body.snoozedUntil : undefined;

  const today: DayStatus | undefined = ['done', 'skipped', 'todo'].includes(body?.today) ? body.today : undefined;

  if (completed === undefined && declined === undefined && snoozedUntil === undefined && today === undefined) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  }

  if (today !== undefined && !(await setActivityDayStatus(activityId, today))) {
    return NextResponse.json({ error: 'This activity isn’t scheduled for today.' }, { status: 409 });
  }

  if (completed !== undefined || declined !== undefined || snoozedUntil !== undefined) {
    await updatePlanActivity({ activityId, completed, declined, snoozedUntil });
  }

  return NextResponse.json({ ok: true });
}
