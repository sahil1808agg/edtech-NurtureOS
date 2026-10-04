import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../lib/db/server';
import { ConsentError } from '../../../server/consent/policy';
import { ingestReport, IngestValidationError } from '../../../server/reports/ingest';

export const runtime = 'nodejs';

/**
 * Upload a report and start the pipeline.
 *
 * Order matters: authenticate, prove the child belongs to the caller's family,
 * then check consent — before a single byte is stored. The PRD's hard gate is
 * "no processing without a live consent row", so consent is checked here, at
 * the only place a report can enter the system, rather than inside each job.
 */
export async function POST(request: Request) {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const form = await request.formData();
  const file = form.get('file');
  const childId = form.get('childId');
  const termLabel = form.get('termLabel');
  const termIndex = form.get('termIndex');
  const academicYear = form.get('academicYear');

  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (typeof childId !== 'string') return NextResponse.json({ error: 'childId is required' }, { status: 400 });

  // family_id is matched explicitly rather than left to RLS. The children read
  // policy is `family_id = current_family_id() OR is_ops()`, so for an ops
  // account RLS alone resolves ANY child — which would let a reviewer upload a
  // report on another family's behalf. Ops is a trusted role, but this route
  // means "the caller's own child", so it says so.
  const { data: child } = await db
    .from('children')
    .select('id, family_id')
    .eq('id', childId)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!child) return NextResponse.json({ error: 'Child not found' }, { status: 404 });

  try {
    const result = await ingestReport({
      childId,
      familyId: child.family_id,
      file,
      termLabel: typeof termLabel === 'string' ? termLabel : null,
      termIndex: typeof termIndex === 'string' ? Number(termIndex) : null,
      academicYear: typeof academicYear === 'string' ? academicYear : null,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof IngestValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof ConsentError) {
      return NextResponse.json(
        { error: 'No live consent to analyse this child\'s reports.', reason: err.reason },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 });
  }
}
