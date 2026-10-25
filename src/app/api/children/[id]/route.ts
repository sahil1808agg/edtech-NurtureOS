import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { serviceClient } from '../../../../lib/db/clients';
import { getChildProfile, updateChildProfile, type ChildProfilePatch } from '../../../../server/db/children';

export const runtime = 'nodejs';

const BOARDS = ['IB', 'CBSE', 'CAIE', 'CISCE', 'STATE'] as const;

/**
 * Edit a child's details from the Child details tab: any of name, date of
 * birth, grade, board and location. Only fields present in the body change
 * — in particular, location is only touched when `address` is sent, so
 * saving a name no longer wipes a saved location. Validation matches chat's
 * update_child_profile tool (tools.ts) so both edit paths accept the same
 * values, and both write the same db/children.ts update and an audit row.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

  const patch: ChildProfilePatch = {};

  if ('firstName' in body) {
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    if (!firstName || firstName.length > 100) return NextResponse.json({ error: 'Enter a name (up to 100 characters).' }, { status: 400 });
    patch.firstName = firstName;
  }

  if ('dob' in body) {
    const dob = typeof body.dob === 'string' ? body.dob : '';
    const parsed = new Date(`${dob}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dob) {
      return NextResponse.json({ error: 'Enter a valid date of birth.' }, { status: 400 });
    }
    if (parsed > new Date()) return NextResponse.json({ error: 'Date of birth can’t be in the future.' }, { status: 400 });
    patch.dob = dob;
  }

  if ('grade' in body) {
    const grade = typeof body.grade === 'string' ? body.grade.trim() : '';
    if (!grade || grade.length > 50) return NextResponse.json({ error: 'Enter a class or grade (up to 50 characters).' }, { status: 400 });
    patch.grade = grade;
  }

  if ('board' in body) {
    if (body.board !== null && !BOARDS.includes(body.board)) {
      return NextResponse.json({ error: 'Pick a school board from the list.' }, { status: 400 });
    }
    patch.board = body.board;
  }

  if ('address' in body) {
    const address = typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null;
    const lat = typeof body.lat === 'number' ? body.lat : null;
    const lng = typeof body.lng === 'number' ? body.lng : null;
    const placeId = typeof body.placeId === 'string' && body.placeId.trim() ? body.placeId.trim() : null;
    if (address && (lat == null || lng == null)) {
      return NextResponse.json({ error: 'That location could not be resolved — pick it from the dropdown again.' }, { status: 400 });
    }
    Object.assign(patch, { address, lat, lng, placeId });
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

  const before = await getChildProfile(childId);
  try {
    await updateChildProfile(childId, patch);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save' }, { status: 500 });
  }

  await serviceClient().from('audit_log').insert({
    actor: user.id,
    action: 'web.update_child_profile',
    entity: 'child',
    entity_id: childId,
    payload: {
      before: { firstName: before.firstName, dob: before.dob, grade: before.grade, board: before.board, address: before.address },
      after: patch,
    },
  });

  return NextResponse.json({ ok: true });
}

/**
 * Removing a child removes everything derived from them: consents, reports,
 * findings, plans, checkins, and chat history all cascade from children(id)
 * (see docs/specs/supabase-schema.sql). The one thing that does not cascade
 * is the report files themselves, which live in the `reports` storage
 * bucket keyed by report id — those are removed explicitly below so a
 * deleted child doesn't leave orphaned files behind.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const admin = serviceClient();

  const { data: reports } = await admin
    .from('reports')
    .select('storage_path')
    .eq('child_id', childId)
    .not('storage_path', 'eq', 'pending');

  const paths = (reports ?? []).map((r) => r.storage_path).filter(Boolean);
  if (paths.length > 0) {
    await admin.storage.from('reports').remove(paths);
  }

  const { error } = await admin.from('children').delete().eq('id', childId);
  if (error) {
    return NextResponse.json({ error: `Could not delete: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
