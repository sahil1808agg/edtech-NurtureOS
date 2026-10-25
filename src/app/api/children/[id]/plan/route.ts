import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../lib/db/server';
import { requestPlanRegeneration } from '../../../../../server/pipeline/request-plan-regeneration';

export const runtime = 'nodejs';

/**
 * The parent asks for a plan, once they have read the findings.
 *
 * Deliberately parent-triggered rather than fired on publish: a plan is a set
 * of things we are asking a family to actually do, so it should be built from
 * findings they have seen and not from ones they have told us are wrong.
 *
 * The actual consent/published-set/pending-plan/enqueue logic lives in
 * requestPlanRegeneration() — shared with the email action route, whose
 * authorization is a signed token rather than a session, so it can't do the
 * family-ownership check this route does below.
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

  const result = await requestPlanRegeneration(childId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.reason, planId: result.planId }, { status: result.status });
  }

  return NextResponse.json({ status: 'queued' }, { status: 202 });
}
