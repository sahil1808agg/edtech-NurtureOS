import Link from 'next/link';
import { redirect } from 'next/navigation';
import { routeClient, currentUser } from '../../../lib/db/server';
import { ChildTabs } from './ChildTabs';

export const dynamic = 'force-dynamic';

/**
 * The child workspace: one header and tab bar shared by Today, Child details,
 * Report & plan and Chat, matching the parent journey — add a child, upload
 * a report, get a plan, then work from Today each day.
 */
export default async function ChildLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  const { data: child } = await db
    .from('children')
    .select('id, first_name, dob, grade')
    .eq('id', id)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!child) return <main className="max-w-3xl"><p className="text-sm">Child not found.</p></main>;

  const { count: siblingCount } = await db
    .from('children')
    .select('id', { count: 'exact', head: true })
    .eq('family_id', user.familyId);

  const ageYears = Math.floor(
    (Date.now() - new Date(child.dob).getTime()) / (365.25 * 24 * 3600 * 1000),
  );

  return (
    <div>
      {(siblingCount ?? 0) > 1 && (
        <Link href="/" className="text-xs underline text-[var(--muted)]">← All children</Link>
      )}
      <div className="mt-3">
        <h1 className="text-2xl font-semibold tracking-tight">{child.first_name}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{child.grade} · {ageYears} years old</p>
      </div>

      <ChildTabs childId={child.id} />

      <div className="mt-8">{children}</div>
    </div>
  );
}
