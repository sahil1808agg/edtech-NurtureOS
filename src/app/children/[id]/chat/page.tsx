import { redirect } from 'next/navigation';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { getOrCreateConversation } from '../../../../server/db/conversations';
import { listMessages } from '../../../../server/db/messages';
import { ChatThread } from './ChatThread';

export const dynamic = 'force-dynamic';

/**
 * Chat tab. Today's activities used to sit above the thread here; they now
 * have their own Today tab, so this is just the conversation. Runs full
 * width (see AppShell) — ChatThread constrains its own column and only
 * widens when the evidence panel is open.
 */
export default async function ChildChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  const { data: child } = await db
    .from('children')
    .select('id, family_id')
    .eq('id', id)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!child) return <main><p className="text-sm">Child not found.</p></main>;

  const conversation = await getOrCreateConversation(child.id, child.family_id);
  const messages = await listMessages(conversation.id, {});

  return (
    <main>
      <ChatThread childId={child.id} conversationId={conversation.id} initialMessages={messages} />
    </main>
  );
}
