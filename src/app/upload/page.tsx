import { redirect } from 'next/navigation';
import { routeClient, currentUser } from '../../lib/db/server';
import { UploadForm, type ChildOption } from './UploadForm';

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  // Scoped explicitly: the children read policy widens to every family for an
  // ops account, so relying on RLS here would offer a reviewer the whole
  // system's children in the dropdown.
  const { data: children } = await db
    .from('children')
    .select('id, first_name, grade')
    .eq('family_id', user.familyId)
    .order('first_name');

  const options: ChildOption[] = (children ?? []).map((c) => ({
    id: c.id,
    firstName: c.first_name,
    grade: c.grade,
  }));

  return (
    <main className="max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">Upload a report</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        We read the report, pull out what was actually assessed, and turn it into a small number of
        findings — each one traceable to the exact cell it came from, and checked by a person before
        you see it.
      </p>

      <UploadForm children={options} />
    </main>
  );
}
