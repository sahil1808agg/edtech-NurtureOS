import { redirect } from 'next/navigation';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { DeleteChildButton } from '../../DeleteChildButton';
import { EditLocation } from '../EditLocation';
import { EditChildDetails } from './EditChildDetails';

export const dynamic = 'force-dynamic';

/**
 * Child details tab: name, date of birth, grade and board (EditChildDetails),
 * location (EditLocation — it needs the address picker), and removing the
 * child. Chat's profile agent can make the same edits; both go through
 * db/children.ts's updateChildProfile.
 */
export default async function ChildDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  const { data: child } = await db
    .from('children')
    .select('id, first_name, dob, grade, board, address, created_at')
    .eq('id', id)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!child) return <main className="max-w-2xl"><p className="text-sm">Child not found.</p></main>;

  return (
    <main className="max-w-2xl space-y-8">
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">About {child.first_name}</h2>
        <EditChildDetails
          child={{ id: child.id, firstName: child.first_name, dob: child.dob, grade: child.grade, board: child.board ?? null }}
        />
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Location</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Used to suggest real places nearby, like libraries and parks.</p>
        <div className="mt-2">
          <EditLocation childId={child.id} address={child.address} />
        </div>
      </section>

      <section className="border-t border-[var(--border)] pt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Remove child</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Deletes their reports, plans and chat. This can’t be undone.</p>
        <div className="mt-3">
          <DeleteChildButton childId={child.id} name={child.first_name} redirectTo="/" />
        </div>
      </section>
    </main>
  );
}
