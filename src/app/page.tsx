import Link from 'next/link';
import { routeClient, currentUser } from '../lib/db/server';
import { serviceClient } from '../lib/db/clients';

export const dynamic = 'force-dynamic';

/** What the parent is told at each pipeline stage, in plain language. */
const STAGE_LABEL: Record<string, string> = {
  uploaded: 'Reading the report',
  extracted: 'Matching skills',
  normalised: 'Looking for patterns',
  analysed: 'Checking against the teacher’s comments',
  in_review: 'Waiting for a person to review',
  published: 'Ready',
  held: 'Not enough to go on',
  failed: 'Could not be read',
};

export default async function Home() {
  const db = await routeClient();
  const user = await currentUser(db);

  if (!user) {
    return (
      <main>
        <h1 className="text-2xl font-semibold tracking-tight">
          Understand your child’s school report
        </h1>
        <p className="mt-3 text-[var(--muted)]">
          Upload a report and we turn it into a small number of findings, each traceable to the
          exact cell it came from. Every finding is checked by a person before you see it, and we
          say so plainly when a report does not contain enough to draw a conclusion.
        </p>
        <Link
          href="/signin"
          className="mt-6 inline-block rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Sign in
        </Link>
      </main>
    );
  }

  // Scoped explicitly to the caller's family. RLS is deliberately wider for ops
  // (`... OR is_ops()`) so the review console can cross families — but this list
  // is headed "Your reports", and for a reviewer that must mean theirs, not
  // everyone's.
  const { data: reports } = await db
    .from('reports')
    .select('id, status, term_label, academic_year, child_id, created_at')
    .eq('family_id', user.familyId)
    .order('created_at', { ascending: false });

  const { data: children } = await db
    .from('children')
    .select('id, first_name')
    .eq('family_id', user.familyId);

  const { data: plans } = await db
    .from('plans')
    .select('id, child_id, cycle_no, status, created_at')
    .eq('family_id', user.familyId)
    .order('created_at', { ascending: false });
  const nameById = new Map((children ?? []).map((c) => [c.id, c.first_name]));

  let pendingReviews = 0;
  if (user.isOps) {
    const { count } = await serviceClient()
      .from('review_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'in_review');
    pendingReviews = count ?? 0;
  }

  return (
    <main>
      <h1 className="text-2xl font-semibold tracking-tight">Your reports</h1>

      {user.isOps && (
        <div className="mt-4 rounded-lg border border-[var(--border)] p-4">
          <p className="text-sm">
            <strong>{pendingReviews}</strong> item{pendingReviews === 1 ? '' : 's'} waiting for
            review.{' '}
            <Link href="/review" className="underline">Open the review console</Link>
          </p>
        </div>
      )}

      {(reports ?? []).length === 0 ? (
        <div className="mt-6">
          <p className="text-sm text-[var(--muted)]">No reports yet.</p>
          <Link
            href="/upload"
            className="mt-4 inline-block rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Upload a report
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {(reports ?? []).map((r) => (
              <li key={r.id} className="rounded-lg border border-[var(--border)] p-4">
                <div className="flex items-baseline justify-between gap-4">
                  <Link href={`/reports/${r.id}`} className="text-sm font-medium underline">
                    {nameById.get(r.child_id) ?? 'Child'}
                    {r.term_label ? ` — ${r.term_label}` : ''}
                    {r.academic_year ? ` (${r.academic_year})` : ''}
                  </Link>
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {STAGE_LABEL[r.status] ?? r.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Uploaded {new Date(r.created_at).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>

          <Link
            href="/upload"
            className="mt-6 inline-block rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Upload another report
          </Link>
        </>
      )}

      {(plans ?? []).length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
            Plans
          </h2>
          <ul className="mt-3 space-y-3">
            {(plans ?? []).map((p) => (
              <li key={p.id} className="rounded-lg border border-[var(--border)] p-4">
                <div className="flex items-baseline justify-between gap-4">
                  <Link href={`/plans/${p.id}`} className="text-sm font-medium underline">
                    {nameById.get(p.child_id) ?? 'Child'} — cycle {p.cycle_no}
                  </Link>
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {p.status === 'approved' || p.status === 'published'
                      ? 'Ready'
                      : p.status === 'draft'
                        ? 'Waiting for review'
                        : p.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
