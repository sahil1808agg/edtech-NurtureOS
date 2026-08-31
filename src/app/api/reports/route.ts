import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../lib/db/server';
import { serviceClient } from '../../../lib/db/clients';
import { assertConsent } from '../../../server/consent/assert';
import { ConsentError } from '../../../server/consent/policy';
import { enqueue } from '../../../server/queue/enqueue';

export const runtime = 'nodejs';

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = new Set(['application/pdf', 'image/jpeg', 'image/png']);

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
  if (!ACCEPTED.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type ${file.type}. Upload a PDF, JPEG or PNG.` }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File is ${(file.size / 1e6).toFixed(1)}MB; the limit is 20MB.` }, { status: 413 });
  }

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
    await assertConsent(db, childId, 'report_analysis');
  } catch (err) {
    if (err instanceof ConsentError) {
      return NextResponse.json(
        { error: 'No live consent to analyse this child\'s reports.', reason: err.reason },
        { status: 403 },
      );
    }
    throw err;
  }

  // Past the gates — switch to the service client for the writes the parent's
  // own RLS role should not be able to perform directly (storage, status).
  const admin = serviceClient();

  const { data: report, error: reportError } = await admin
    .from('reports')
    .insert({
      family_id: child.family_id,
      child_id: childId,
      term_label: typeof termLabel === 'string' ? termLabel : null,
      term_index: typeof termIndex === 'string' ? Number(termIndex) : null,
      academic_year: typeof academicYear === 'string' ? academicYear : null,
      source_type: file.type === 'application/pdf' ? 'pdf' : 'photo',
      storage_path: 'pending',
    })
    .select('id')
    .single();

  if (reportError || !report) {
    return NextResponse.json({ error: `Could not create report: ${reportError?.message}` }, { status: 500 });
  }

  const extension = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
  const storagePath = `${report.id}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from('reports')
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });

  if (uploadError) {
    // Leave no report row pointing at a file that was never stored.
    await admin.from('reports').delete().eq('id', report.id);
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
  }

  await admin.from('reports').update({ storage_path: storagePath }).eq('id', report.id);
  await enqueue('report.extract', { reportId: report.id });

  return NextResponse.json({ reportId: report.id, status: 'uploaded' }, { status: 202 });
}
