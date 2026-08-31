import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../lib/db/server';

export const runtime = 'nodejs';

const ALLOWED = new Set(['matches', 'doesnt_match', 'unsure']);

/**
 * Records what the parent thinks of a finding.
 *
 * This is the loop the PRD measures ("findings a parent marks 'yes, this
 * matches what I see'"), and the corrective signal that matters most: the
 * parent knows the child, and a finding they reject is a labelled negative
 * example for evaluation later.
 *
 * It does not retract the finding. A disagreement is recorded beside it rather
 * than deleting it, because "the model said X and the parent said no" is the
 * thing worth knowing; silently removing it would destroy the evidence.
 *
 * Written through the caller's own client, so RLS enforces that a parent can
 * only respond to findings in their own family.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const response = body?.response;
  const note = typeof body?.note === 'string' ? body.note.trim() : null;

  if (!ALLOWED.has(response)) {
    return NextResponse.json(
      { error: 'response must be "matches", "doesnt_match" or "unsure"' },
      { status: 400 },
    );
  }

  // Confirm the finding is this family's, and that it is one they can actually
  // see — responding to an unpublished finding should not be possible.
  const { data: finding } = await db
    .from('findings')
    .select('id, finding_set_id')
    .eq('id', id)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!finding) return NextResponse.json({ error: 'Finding not found' }, { status: 404 });

  const { data: set } = await db
    .from('finding_sets')
    .select('status')
    .eq('id', finding.finding_set_id)
    .maybeSingle();

  if (set?.status !== 'published') {
    return NextResponse.json({ error: 'That finding is not published' }, { status: 409 });
  }

  const { error } = await db.from('parent_finding_responses').upsert(
    {
      finding_id: id,
      family_id: user.familyId,
      response,
      note: note || null,
      responded_at: new Date().toISOString(),
    },
    { onConflict: 'finding_id' },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ findingId: id, response });
}
