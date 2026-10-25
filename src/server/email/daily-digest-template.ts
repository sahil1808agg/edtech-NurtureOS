import { signActionToken, actionTokenExpiry } from './action-token.js';
import type { CurrentPlanActivity } from '../db/plans.js';

function activityActionUrl(baseUrl: string, activityId: string, action: 'done' | 'not_today' | 'remove'): string {
  const token = signActionToken({ action, targetId: activityId, exp: actionTokenExpiry() });
  return `${baseUrl}/api/email/activity-action?token=${encodeURIComponent(token)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The daily digest, built from the same getTodaysRemainingActivities() output
 * the in-app Today panels render — one source of truth, so the email never
 * says something different from what opening the app would show.
 */
export function buildDailyDigestEmail(input: {
  childName: string;
  activities: CurrentPlanActivity[];
  baseUrl: string;
  unsubscribeUrl: string;
}): { subject: string; html: string; text: string } {
  const { childName, activities, baseUrl, unsubscribeUrl } = input;

  const htmlCards = activities
    .map((a) => {
      const materials = a.materials.length ? `You'll need: ${a.materials.join(', ')}` : 'No materials needed';
      const steps = a.steps.map((s) => `<li style="margin-bottom:4px;">${escapeHtml(s)}</li>`).join('');
      const time = a.estimatedMinutes != null ? ` &middot; ~${a.estimatedMinutes} min` : '';
      return `
        <div style="border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:12px;">
          <h3 style="margin:0 0 4px;font-size:15px;">${escapeHtml(a.title)}${time}</h3>
          <p style="margin:0 0 8px;color:#555;font-size:14px;">${escapeHtml(a.instructions)}</p>
          <p style="margin:0 0 8px;color:#777;font-size:12px;">${escapeHtml(materials)}</p>
          <ol style="margin:0 0 12px;padding-left:20px;font-size:14px;">${steps}</ol>
          <a href="${activityActionUrl(baseUrl, a.id, 'done')}" style="margin-right:12px;">Done</a>
          <a href="${activityActionUrl(baseUrl, a.id, 'not_today')}" style="margin-right:12px;">Not today</a>
          <a href="${activityActionUrl(baseUrl, a.id, 'remove')}" style="color:#c00;">Remove</a>
        </div>`;
    })
    .join('');

  const textCards = activities
    .map((a) => {
      const materials = a.materials.length ? `You'll need: ${a.materials.join(', ')}` : 'No materials needed';
      const steps = a.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
      const time = a.estimatedMinutes != null ? ` (~${a.estimatedMinutes} min)` : '';
      return [
        `${a.title}${time}`,
        a.instructions,
        materials,
        steps,
        `Done: ${activityActionUrl(baseUrl, a.id, 'done')}`,
        `Not today: ${activityActionUrl(baseUrl, a.id, 'not_today')}`,
        `Remove: ${activityActionUrl(baseUrl, a.id, 'remove')}`,
      ].join('\n');
    })
    .join('\n\n');

  const subject = `${childName}'s activities for today`;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;">
      <h2 style="font-size:18px;">${escapeHtml(childName)}'s plan for today</h2>
      ${htmlCards}
      <p style="margin-top:24px;font-size:11px;color:#999;">
        <a href="${unsubscribeUrl}" style="color:#999;">Unsubscribe from daily emails</a>
      </p>
    </div>`;

  const text = [
    `${childName}'s plan for today`,
    '',
    textCards,
    '',
    `Unsubscribe from daily emails: ${unsubscribeUrl}`,
  ].join('\n');

  return { subject, html, text };
}
