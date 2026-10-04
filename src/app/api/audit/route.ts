import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../lib/db/server';

export const runtime = 'nodejs';

/** Read-only audit feed, ops-only. See docs/specs/06-audit-view.md. */
export async function GET(request: Request) {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!user.isOps) return NextResponse.json({ error: 'Ops only' }, { status: 403 });

  const url = new URL(request.url);
  const entity = url.searchParams.get('entity');
  const since = url.searchParams.get('since');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
  const cursor = url.searchParams.get('cursor');

  // Uses the caller's own session (RLS applies, ops_read policy on audit_log
  // — see supabase/migrations/0008_chat.sql), not the service client, since
  // this route is read-only and the RLS check is the authorization.
  let query = db.from('audit_log').select('id, actor, action, entity, entity_id, payload, created_at').order('id', { ascending: false }).limit(limit);

  if (entity) query = query.eq('entity', entity);
  if (since) query = query.gte('created_at', since);
  if (cursor) query = query.lt('id', cursor);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const entries = data ?? [];
  const nextCursor = entries.length === limit ? String(entries[entries.length - 1].id) : null;

  return NextResponse.json({ entries, nextCursor });
}
