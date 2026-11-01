import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../lib/db/server';
import { getOrCreateConversation } from '../../../../../server/db/conversations';
import { listMessages, MESSAGE_PAGE_SIZE } from '../../../../../server/db/messages';

export const runtime = 'nodejs';

/**
 * The chat thread for one child — creates the conversation on first call.
 * See docs/specs/01-chat-thread.md. `?before=<createdAt>` returns the page of
 * messages older than that one (ChatThread's "Load earlier messages").
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: childId } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // Same ownership check as every other child-scoped route (e.g. src/app/api/reports/route.ts).
  const { data: child } = await db
    .from('children')
    .select('id, family_id')
    .eq('id', childId)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!child) return NextResponse.json({ error: 'Child not found' }, { status: 404 });

  const beforeParam = new URL(request.url).searchParams.get('before');
  if (beforeParam && Number.isNaN(Date.parse(beforeParam))) {
    return NextResponse.json({ error: 'before must be a timestamp' }, { status: 400 });
  }

  const conversation = await getOrCreateConversation(childId, child.family_id);
  const messages = await listMessages(conversation.id, { before: beforeParam ?? undefined });

  // A full page means there may be more before it; a short one means this is the start.
  return NextResponse.json({ conversation, messages, hasEarlier: messages.length === MESSAGE_PAGE_SIZE });
}
