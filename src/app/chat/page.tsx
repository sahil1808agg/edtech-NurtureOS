import { redirect } from 'next/navigation';
import Link from 'next/link';
import { routeClient, currentUser } from '../../lib/db/server';

export const dynamic = 'force-dynamic';

/**
 * Entry point for the chat-primary surface. One child → straight to their
 * thread. More than one → a picker. See docs/specs/01-chat-thread.md.
 *
 * Scaffolded at /chat rather than Spec 01's bare `(chat)/[childId]` route
 * group, to avoid a root-level dynamic segment colliding with the existing
 * static top-level pages (/upload, /signin, /children, ...). Whether `/`
 * itself should redirect here is a Stage 4 decision, not made here.
 */
export default async function ChatEntry() {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  const { data: children } = await db
    .from('children')
    .select('id, first_name')
    .eq('family_id', user.familyId)
    .order('first_name');

  if (!children || children.length === 0) redirect('/children/new');
  if (children.length === 1) redirect(`/chat/${children[0].id}`);

  return (
    <main className="max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Who are we talking about?</h1>
      <ul className="mt-6 space-y-2">
        {children.map((c) => (
          <li key={c.id}>
            <Link
              href={`/chat/${c.id}`}
              className="block rounded-lg border border-[var(--border)] p-4 text-sm font-medium hover:border-[var(--accent)]"
            >
              {c.first_name}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
