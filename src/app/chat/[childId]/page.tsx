import { redirect } from 'next/navigation';
import Link from 'next/link';
import { routeClient, currentUser } from '../../../lib/db/server';
import { getOrCreateConversation } from '../../../server/db/conversations';
import { listMessages } from '../../../server/db/messages';
import { ChatThread } from './ChatThread';

export const dynamic = 'force-dynamic';

export default async function ChatPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  const { data: child } = await db
    .from('children')
    .select('id, first_name, family_id')
    .eq('id', childId)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!child) return <main className="max-w-3xl"><p className="text-sm">Child not found.</p></main>;

  const conversation = await getOrCreateConversation(child.id, child.family_id);
  const messages = await listMessages(conversation.id, {});

  return (
    <main className="max-w-2xl">
      <Link href="/chat" className="text-xs underline text-[var(--muted)]">← Switch child</Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{child.first_name}</h1>

      <ChatThread childId={child.id} conversationId={conversation.id} initialMessages={messages} />
    </main>
  );
}
