import { redirect } from 'next/navigation';
import Link from 'next/link';
import { routeClient, currentUser } from '../../../lib/db/server';
import { getOrCreateConversation } from '../../../server/db/conversations';
import { listMessages } from '../../../server/db/messages';
import { getCurrentPlan, remainingTodayActivities } from '../../../server/db/plans';
import { TodayActivityList } from '../../../components/TodayActivityList';
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

  // Chat replies are free text — a status question like "what's for today"
  // is answered straight from context without calling any tool (see
  // chat-planning-agent.md), so there's no reliable per-reply link back to
  // real activity rows to attach buttons to. This renders the same
  // Done/Not today/Remove buttons as the child page, backed by the same
  // live DB read, so they're actually here rather than hoped for in prose.
  const currentPlan = await getCurrentPlan(child.id);
  const planReady = currentPlan?.status === 'approved' || currentPlan?.status === 'published';
  const remainingActivities = planReady && currentPlan ? remainingTodayActivities(currentPlan) : [];

  return (
    // No max-width here (unlike most other pages) — ChatThread itself
    // constrains the chat column to a reading width and only grows wider,
    // via its own grid, when the evidence side panel is open.
    <main>
      <Link href="/chat" className="text-xs underline text-[var(--muted)]">← Switch child</Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{child.first_name}</h1>

      {planReady && remainingActivities.length > 0 && (
        <section className="mt-4 max-w-2xl">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Today</h2>
          <TodayActivityList activities={remainingActivities} childId={child.id} />
        </section>
      )}

      <ChatThread childId={child.id} conversationId={conversation.id} initialMessages={messages} />
    </main>
  );
}
