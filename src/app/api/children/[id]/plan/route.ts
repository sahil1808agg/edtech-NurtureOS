import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../lib/db/server';
import { serviceClient } from '../../../../../lib/db/clients';
import { assertConsent } from '../../../../../server/consent/assert';
import { ConsentError } from '../../../../../server/consent/policy';
import { enqueue } from '../../../../../server/queue/enqueue';

export const runtime = 'nodejs';

/**
 * The parent asks for a plan, once they have read the findings.
 *
 * Deliberately parent-triggered rather than fired on publish: a plan is a set
 * of things we are asking a family to actually do, so it should be built from
 * findings they have seen and not from ones they have told us are wrong.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: childId } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: child } = await db
    .from('children')
    .select('id')
    .eq('id', childId)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!child) return NextResponse.json({ error: 'Child not found' }, { status: 404 });

  // Consent covers analysis and plan generation separately; this is the second.
  try {
    await assertConsent(db, childId, 'plan_generation');
  } catch (err) {
    if (err instanceof ConsentError) {
      return NextResponse.json(
        { error: 'No live consent to build a plan for this child.', reason: err.reason },
        { status: 403 },
      );
    }
    throw err;
  }

  const admin = serviceClient();

  // Nothing to plan against until a finding set has been published.
  const { data: publishedSet } = await admin
    .from('finding_sets')
    .select('id')
    .eq('child_id', childId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!publishedSet) {
    return NextResponse.json(
      { error: 'There are no published findings for this child yet.' },
      { status: 409 },
    );
  }

  // One plan in flight at a time, so a double click does not produce two
  // cycles a reviewer then has to triage.
  const { data: pending } = await admin
    .from('plans')
    .select('id, status')
    .eq('child_id', childId)
    .in('status', ['draft', 'in_review'])
    .maybeSingle();

  if (pending) {
    return NextResponse.json(
      { error: 'A plan for this child is already being prepared.', planId: pending.id },
      { status: 409 },
    );
  }

  // The check above cannot catch a double click: between enqueueing and the
  // worker inserting the plan row there is no row to find. The singleton key
  // closes that window at the queue, where the race actually is.
  const jobId = await enqueue('plan.generate', { childId }, { singletonKey: `plan:${childId}` });

  if (!jobId) {
    return NextResponse.json({ error: 'A plan for this child is already being prepared.' }, { status: 409 });
  }

  return NextResponse.json({ status: 'queued' }, { status: 202 });
}
