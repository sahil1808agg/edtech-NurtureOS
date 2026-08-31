import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../lib/db/server';

export const runtime = 'nodejs';

/** Pipeline status for one report. RLS scopes the read to the caller's family. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: report } = await db
    .from('reports')
    .select('id, child_id, status, failure_reason, term_label, academic_year, created_at')
    .eq('id', id)
    .maybeSingle();

  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

  // A finding set exists from the gate onwards, but must not be shown to a
  // parent until it has been reviewed and published (PRD: 100% human review).
  const { data: findingSet } = await db
    .from('finding_sets')
    .select('id, status, honesty_path, published_at')
    .eq('report_id', id)
    .maybeSingle();

  const published = findingSet?.status === 'published';

  return NextResponse.json({
    report,
    findings: published
      ? { ready: true, findingSetId: findingSet.id, honestyPath: findingSet.honesty_path }
      : { ready: false, stage: findingSet ? 'in_review' : report.status },
  });
}
