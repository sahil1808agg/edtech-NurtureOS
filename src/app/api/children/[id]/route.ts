import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { serviceClient } from '../../../../lib/db/clients';

export const runtime = 'nodejs';

/**
 * Location is the only thing about a child that can be added after creation
 * (name/dob/grade are fixed — getting those wrong means deleting and
 * re-adding). It's worth a dedicated route: a child added before the
 * location-aware plan feature shipped, or whose parent skipped it at
 * /children/new, would otherwise never get "local" plan activities — they
 * silently downgrade to home activities (see resolve-local-activities.ts)
 * with no way to fix it short of deleting and recreating the child.
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
  const address = typeof body?.address === 'string' && body.address.trim() ? body.address.trim() : null;
  const lat = typeof body?.lat === 'number' ? body.lat : null;
  const lng = typeof body?.lng === 'number' ? body.lng : null;
  const placeId = typeof body?.placeId === 'string' && body.placeId.trim() ? body.placeId.trim() : null;

  if (address && (lat == null || lng == null)) {
    return NextResponse.json({ error: 'That location could not be resolved — pick it from the dropdown again.' }, { status: 400 });
  }

  const { error } = await serviceClient()
    .from('children')
    .update({ address, lat, lng, place_id: placeId })
    .eq('id', childId);

  if (error) return NextResponse.json({ error: `Could not save location: ${error.message}` }, { status: 500 });

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
