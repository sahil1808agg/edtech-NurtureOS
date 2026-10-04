import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../lib/db/server';
import { getOrCreateConversation } from '../../../../../server/db/conversations';
import { listMessages } from '../../../../../server/db/messages';

export const runtime = 'nodejs';

/** The chat thread for one child — creates the conversation on first call. See docs/specs/01-chat-thread.md. */
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

  const conversation = await getOrCreateConversation(childId, child.family_id);
  const messages = await listMessages(conversation.id, {});

  return NextResponse.json({ conversation, messages });
}
