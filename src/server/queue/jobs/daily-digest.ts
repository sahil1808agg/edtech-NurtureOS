import type { PgBoss } from 'pg-boss';
import { serviceClient } from '../../../lib/db/clients.js';
import { getChild, getCurrentPlan } from '../../db/plans.js';
import { getTodaysRemainingActivities } from '../../db/schedule.js';
import { getFamilyProfile, getParentEmail } from '../../db/profiles.js';
import { signActionToken, actionTokenExpiry } from '../../email/action-token.js';
import { buildDailyDigestEmail } from '../../email/daily-digest-template.js';
import { sendEmail } from '../../email/resend.js';

export const QUEUE = 'plan.daily-digest';

export async function createDailyDigestQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE, { retryLimit: 2, retryDelay: 60, expireInSeconds: 600 });
}

/**
 * The first fan-out job in this codebase — every other job
 * (report-extract/normalise/analyse, plan-generate, checkin-process) is
 * triggered reactively for one entity. This one iterates every child with a
 * ready plan once a day, which is a different shape: no pagination (current
 * scale doesn't need it — this is the first job of its kind at all), and
 * failures are per-family (one bad send shouldn't block the rest), not
 * per-job-retry the way the reactive jobs are.
 */
export interface DailyDigestJobData {
  requestId?: string;
}

export async function registerDailyDigestWorker(boss: PgBoss): Promise<void> {
  await boss.work<DailyDigestJobData>(QUEUE, { localConcurrency: 1 }, async () => {
    const admin = serviceClient();
    const appUrl = process.env.APP_URL;
    if (!appUrl) throw new Error('APP_URL is not set');

    const { data: planRows, error } = await admin.from('plans').select('child_id');
    if (error) throw new Error(`listing children with plans: ${error.message}`);
    const childIds = [...new Set((planRows ?? []).map(r => r.child_id as string))];

    for (const childId of childIds) {
      try {
        await sendDigestForChild(childId, appUrl);
      } catch (err) {
        // One family's bad address/consent/send failure must not stop the
        // rest of the run — there's no per-child retry queue here (unlike
        // the reactive jobs) since tomorrow's run supersedes today's anyway.
        console.error(`[daily-digest] failed for child ${childId}:`, err);
      }
    }
  });
}

async function sendDigestForChild(childId: string, appUrl: string): Promise<void> {
  const plan = await getCurrentPlan(childId);
  const ready = plan?.status === 'approved' || plan?.status === 'published';
  if (!plan || !ready) return;

  const activities = await getTodaysRemainingActivities(childId);
  if (activities.length === 0) return;

  const child = await getChild(childId);
  const profile = await getFamilyProfile(child.familyId);
  if (!profile || profile.emailOptOut) return;

  const email = await getParentEmail(profile.id);
  if (!email) return;

  const unsubscribeToken = signActionToken({ action: 'unsubscribe', targetId: profile.id, exp: actionTokenExpiry() });
  const unsubscribeUrl = `${appUrl}/api/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;

  const { subject, html, text } = buildDailyDigestEmail({
    childName: child.firstName,
    activities,
    baseUrl: appUrl,
    unsubscribeUrl,
  });

  await sendEmail({ to: email, subject, html, text });
}
