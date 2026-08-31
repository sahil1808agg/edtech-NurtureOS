import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../../lib/db/server';
import { serviceClient } from '../../../../../../lib/db/clients';

export const runtime = 'nodejs';

/**
 * Approve or reject a reviewed plan.
 *
 * Approved plans stop at 'approved', not 'published': publishing a plan means
 * it has actually been sent to the parent, and email delivery is not built yet.
 * Whatever sends it should flip status to 'published' and stamp sent_at.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const decision = body?.decision;
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 });
  }

  const admin = serviceClient();

  const { data: plan } = await admin
    .from('plans')
    .select('id, status, family_id')
    .eq('id', id)
    .maybeSingle();

  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Only the parent decides — see the finding-set decision route.
  if (plan.family_id !== user.familyId) {
    return NextResponse.json({ error: 'Only the parent can approve their own plan' }, { status: 403 });
  }
  if (plan.status !== 'draft') {
    return NextResponse.json({ error: `Already reviewed (status ${plan.status})` }, { status: 409 });
  }

  const approving = decision === 'approve';
  const now = new Date().toISOString();

  const { error } = await admin
    .from('plans')
    .update({ status: approving ? 'approved' : 'rejected' })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin
    .from('review_queue')
    .update({
      status: approving ? 'approved' : 'rejected',
      reviewer_id: user.id,
      reviewed_at: now,
      violations: Array.isArray(body?.violations) ? body.violations : null,
    })
    .eq('artifact_type', 'plan')
    .eq('artifact_id', id);

  return NextResponse.json({ planId: id, decision, status: approving ? 'approved' : 'rejected' });
}
