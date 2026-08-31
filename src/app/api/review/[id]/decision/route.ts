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

  // Publishing does not generate a plan. It makes the findings visible so the
  // parent can read them, say which ones match, and ask for a plan when they
  // are ready — see POST /api/children/[id]/plan. Generating here would build
  // activities from findings the parent has not seen yet, and would ignore the
  // ones they go on to reject.
  return NextResponse.json({
    findingSetId: id,
    decision,
    status: publishing ? 'published' : 'held',
  });
}
