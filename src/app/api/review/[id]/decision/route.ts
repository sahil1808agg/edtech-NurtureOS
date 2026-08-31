import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../lib/db/server';
import { serviceClient } from '../../../../../lib/db/clients';
import { enqueue } from '../../../../../server/queue/enqueue';

export const runtime = 'nodejs';

/**
 * Publish or reject a reviewed finding set. This is the only path by which
 * anything model-generated becomes visible to a parent.
 *
 *   { "decision": "publish" }                      -> parent can see it
 *   { "decision": "reject", "violations": [...] }  -> held, parent sees nothing
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!user.isOps) return NextResponse.json({ error: 'Not authorised' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const decision = body?.decision;
  if (decision !== 'publish' && decision !== 'reject') {
    return NextResponse.json({ error: 'decision must be "publish" or "reject"' }, { status: 400 });
  }

  const admin = serviceClient();

  const { data: set } = await admin
    .from('finding_sets')
    .select('id, report_id, child_id, status')
    .eq('id', id)
    .maybeSingle();

  if (!set) return NextResponse.json({ error: 'Finding set not found' }, { status: 404 });
  if (set.status === 'published') {
    return NextResponse.json({ error: 'Already published' }, { status: 409 });
  }

  const now = new Date().toISOString();
  const publishing = decision === 'publish';

  const { error: setError } = await admin
    .from('finding_sets')
    .update({
      status: publishing ? 'published' : 'rejected',
      published_at: publishing ? now : null,
    })
    .eq('id', id);

  if (setError) return NextResponse.json({ error: setError.message }, { status: 500 });

  await admin
    .from('review_queue')
    .update({
      status: publishing ? 'approved' : 'rejected',
      reviewer_id: user.id,
      reviewed_at: now,
      violations: Array.isArray(body?.violations) ? body.violations : null,
      checklist: body?.checklist ?? null,
    })
    .eq('artifact_type', 'finding_set')
    .eq('artifact_id', id);

  // 'held' is terminal and honest: the parent is told we could not produce
  // something we stand behind, rather than being shown nothing at all.
  await admin
    .from('reports')
    .update({ status: publishing ? 'published' : 'held' })
    .eq('id', set.report_id);

  // Publishing findings starts the plan. A held report produces none, by
  // design: we do not suggest activities off findings we would not stand behind.
  //
  // The parent's matches / does-not-match answers cannot reach this first plan —
  // they can only respond once a finding is published, which is this moment. So
  // their feedback shapes the *next* plan, and the child page keeps a control
  // for rebuilding once they have given it. The singleton key stops a publish
  // and a manual rebuild from racing into two plans.
  // One plan in flight per child, the same rule the manual route enforces.
  // Without it, publishing a second report while the first plan is still
  // unreviewed leaves two drafts in the queue for one child — and the singleton
  // key does not help, since it only collapses jobs that are still queued, not
  // a plan that was already produced and is sitting in review.
  let planQueued = false;
  if (publishing) {
    const { data: pendingPlan } = await admin
      .from('plans')
      .select('id')
      .eq('child_id', set.child_id)
      .in('status', ['draft', 'in_review'])
      .maybeSingle();

    if (!pendingPlan) {
      await enqueue('plan.generate', { childId: set.child_id }, { singletonKey: `plan:${set.child_id}` });
      planQueued = true;
    }
  }

  return NextResponse.json({
    findingSetId: id,
    decision,
    status: publishing ? 'published' : 'held',
    planQueued,
  });
}
