import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { serviceClient } from '../../../../lib/db/clients';

export const runtime = 'nodejs';

/**
 * The parent corrects a finding, or drops it, before approving the set.
 *
 * Only while the set is still a draft. Once approved, the wording is what the
 * plan was built from and what they responded to, so quietly rewriting it
 * afterwards would leave those pointing at something that was never said.
 *
 * The model's original is preserved on first edit. "We claimed X, the parent
 * corrected it to Y" is the most useful signal this product generates, and it
 * only exists if the original survives.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const statement = typeof body?.statement === 'string' ? body.statement.trim() : undefined;
  const excluded = typeof body?.excluded === 'boolean' ? body.excluded : undefined;

  if (statement === undefined && excluded === undefined) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  }
  if (statement !== undefined && statement.length < 10) {
    return NextResponse.json({ error: 'A finding needs at least a sentence.' }, { status: 400 });
  }
  if (statement !== undefined && statement.length > 600) {
    return NextResponse.json({ error: 'Keep it under 600 characters.' }, { status: 400 });
  }

  const admin = serviceClient();

  const { data: finding } = await admin
    .from('findings')
    .select('id, family_id, statement, original_statement, finding_set_id')
    .eq('id', id)
    .maybeSingle();

  if (!finding) return NextResponse.json({ error: 'Finding not found' }, { status: 404 });
  if (finding.family_id !== user.familyId) {
    return NextResponse.json({ error: 'Only the parent can edit their own findings' }, { status: 403 });
  }

  const { data: set } = await admin
    .from('finding_sets')
    .select('status')
    .eq('id', finding.finding_set_id)
    .maybeSingle();

  if (set?.status !== 'draft') {
    return NextResponse.json(
      { error: 'These findings have already been approved and cannot be changed.' },
      { status: 409 },
    );
  }

  const update: Record<string, unknown> = { edited_at: new Date().toISOString(), edited_by: user.id };

  if (statement !== undefined) {
    update.statement = statement;
    // Only on the first edit, so repeated edits do not overwrite the model's words.
    if (!finding.original_statement) update.original_statement = finding.statement;
  }
  if (excluded !== undefined) update.excluded = excluded;

  const { error } = await admin.from('findings').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ findingId: id, statement, excluded });
}
