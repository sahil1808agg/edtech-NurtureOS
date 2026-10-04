import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { getFindingForEdit, getFindingSetStatus, updateFinding } from '../../../../server/db/findings';

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

  const finding = await getFindingForEdit(id);

  if (!finding) return NextResponse.json({ error: 'Finding not found' }, { status: 404 });
  if (finding.familyId !== user.familyId) {
    return NextResponse.json({ error: 'Only the parent can edit their own findings' }, { status: 403 });
  }

  // Only while the set is still a draft — the legacy page's approval gate.
  // Chat's edit_finding_statement/exclude_finding tools skip this check by
  // design, since chat-originated findings have no draft period. See
  // docs/engineering/engineering-doc.md §4/§7.
  const setStatus = await getFindingSetStatus(finding.findingSetId);
  if (setStatus !== 'draft') {
    return NextResponse.json(
      { error: 'These findings have already been approved and cannot be changed.' },
      { status: 409 },
    );
  }

  try {
    await updateFinding({
      findingId: id,
      editedBy: user.id,
      statement,
      excluded,
      // Only on the first edit, so repeated edits do not overwrite the model's words.
      preserveOriginalAs: statement !== undefined && !finding.originalStatement ? finding.statement : undefined,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ findingId: id, statement, excluded });
}
