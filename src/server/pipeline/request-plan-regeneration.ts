import { serviceClient } from '../../lib/db/clients.js';
import { assertConsent } from '../consent/assert.js';
import { ConsentError } from '../consent/policy.js';
import { enqueue } from '../queue/enqueue.js';

export type RequestPlanRegenerationResult =
  | { ok: true }
  | { ok: false; status: number; error: string; reason?: string; planId?: string };

/**
 * The core of POST /api/children/[id]/plan — consent check, published-set
 * check, one-in-flight-at-a-time check, enqueue — pulled out so the
 * unauthenticated email action route (src/app/api/email/activity-action/route.ts,
 * whose authorization is the signed token, not a session) can trigger the
 * same regeneration a "Remove" click already does, without a session to
 * check against. assertConsent takes a plain SupabaseClient (no RLS
 * requirement — see src/server/consent/assert.ts), so the service client
 * works the same way here as it already does for every other check below.
 */
export async function requestPlanRegeneration(childId: string): Promise<RequestPlanRegenerationResult> {
  const admin = serviceClient();

  try {
    await assertConsent(admin, childId, 'plan_generation');
  } catch (err) {
    if (err instanceof ConsentError) {
      return { ok: false, status: 403, error: 'No live consent to build a plan for this child.', reason: err.reason };
    }
    throw err;
  }

  const { data: publishedSet } = await admin
    .from('finding_sets')
    .select('id')
    .eq('child_id', childId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!publishedSet) {
    return { ok: false, status: 409, error: 'There are no published findings for this child yet.' };
  }

  const { data: pending } = await admin
    .from('plans')
    .select('id, status')
    .eq('child_id', childId)
    .in('status', ['draft', 'in_review'])
    .maybeSingle();

  if (pending) {
    return { ok: false, status: 409, error: 'A plan for this child is already being prepared.', planId: pending.id };
  }

  const jobId = await enqueue(
    'plan.generate',
    { childId, requestId: crypto.randomUUID() },
    { singletonKey: `plan:${childId}` },
  );

  if (!jobId) {
    return { ok: false, status: 409, error: 'A plan for this child is already being prepared.' };
  }

  // A fresh attempt is under way, so the last failure is no longer the news;
  // the job sets it again if this attempt fails too.
  await admin.from('children').update({ plan_error: null, plan_error_at: null }).eq('id', childId);

  return { ok: true };
}
