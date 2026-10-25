import { verifyActionToken } from '../../../../server/email/action-token';
import { getPlanActivityForEdit, updatePlanActivity } from '../../../../server/db/plans';
import { setActivityDayStatus } from '../../../../server/db/schedule';
import { requestPlanRegeneration } from '../../../../server/pipeline/request-plan-regeneration';

export const runtime = 'nodejs';

type Action = 'done' | 'not_today' | 'remove';

const ACTION_LABEL: Record<Action, string> = {
  done: 'Mark done',
  not_today: 'Skip it today',
  remove: 'Remove from the plan',
};

function isAction(value: string): value is Action {
  return value === 'done' || value === 'not_today' || value === 'remove';
}

function page(body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>NurtureOS</title></head>` +
      `<body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:0 16px;">${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/**
 * The email equivalent of TodayActivityActions.tsx's three buttons — except
 * there's no session here, so the signed token (see action-token.ts) is the
 * authorization. GET renders a confirmation page rather than acting
 * immediately, and only the POST that confirmation button submits actually
 * changes anything — the same split the (unbuilt) checkins design specifies,
 * to survive mail clients that prefetch links in the background.
 */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const payload = verifyActionToken(token);
  if (!payload || !isAction(payload.action)) {
    return page('<p>This link has expired or is no longer valid.</p>');
  }

  const activity = await getPlanActivityForEdit(payload.targetId);
  if (!activity) {
    return page('<p>This activity is no longer part of the plan.</p>');
  }

  return page(`
    <h1 style="font-size:18px;">${ACTION_LABEL[payload.action]}</h1>
    <p>${activity.title}</p>
    <form method="POST" action="?token=${encodeURIComponent(token)}">
      <button type="submit" style="padding:8px 16px;font-size:14px;">Confirm</button>
    </form>`);
}

export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const payload = verifyActionToken(token);
  if (!payload || !isAction(payload.action)) {
    return page('<p>This link has expired or is no longer valid.</p>');
  }

  const activity = await getPlanActivityForEdit(payload.targetId);
  if (!activity) {
    return page('<p>This activity is no longer part of the plan.</p>');
  }

  // Done / Not today act on today's scheduled entry only (db/schedule.ts),
  // the same as the Today tab's buttons. A link opened on a later day acts
  // on that day — or says so if the activity isn't on that day's list.
  if (payload.action === 'done' || payload.action === 'not_today') {
    const marked = await setActivityDayStatus(activity.id, payload.action === 'done' ? 'done' : 'skipped');
    if (!marked) return page(`<p>"${activity.title}" isn’t on today’s list, so there’s nothing to change.</p>`);
    return page(
      payload.action === 'done'
        ? `<p>Marked "${activity.title}" done for today. Nice work!</p>`
        : `<p>Skipped "${activity.title}" for today. It stays on the days it’s scheduled.</p>`,
    );
  }

  // remove
  await updatePlanActivity({ activityId: activity.id, declined: true });
  const regen = await requestPlanRegeneration(activity.childId);
  return page(
    regen.ok
      ? `<p>Removed "${activity.title}" — updating the plan.</p>`
      : `<p>Removed "${activity.title}". ${regen.error}</p>`,
  );
}
