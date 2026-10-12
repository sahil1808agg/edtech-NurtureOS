import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { serviceClient } from '../../../../lib/db/clients';

export const runtime = 'nodejs';

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
