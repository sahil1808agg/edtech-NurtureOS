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
      <main className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          Understand your child’s school report
        </h1>
        <p className="mt-3 text-[var(--muted)]">
          Upload a report and we turn it into a small number of findings, each traceable to the
          exact cell it came from. Every finding is checked by a person before you see it, and we
          say so plainly when a report does not contain enough to draw a conclusion.
        </p>
        <div className="mt-6 flex items-center gap-4">
          <Link
            href="/signup"
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Create an account
          </Link>
          <Link href="/signin" className="text-sm underline">Sign in</Link>
        </div>
      </main>
    );
  }

  // Scoped explicitly to the caller's family. RLS is deliberately wider for ops
  // (`... OR is_ops()`) so the review console can cross families — but this is
  // the parent view, and for a reviewer it must mean their own family.
  const [{ data: children }, { data: reports }, { data: plans }] = await Promise.all([
    db.from('children').select('id, first_name, grade').eq('family_id', user.familyId).order('first_name'),
    db
      .from('reports')
      .select('id, child_id, status, term_label, created_at')
      .eq('family_id', user.familyId)
      .order('created_at', { ascending: false }),
    db.from('plans').select('id, child_id, cycle_no, status').eq('family_id', user.familyId),
  ]);

  const reportsByChild = new Map<string, NonNullable<typeof reports>>();
  for (const r of reports ?? []) {
    const list = reportsByChild.get(r.child_id) ?? [];
    list.push(r);
    reportsByChild.set(r.child_id, list);
  }

  const planCountByChild = new Map<string, number>();
  for (const p of plans ?? []) {
    planCountByChild.set(p.child_id, (planCountByChild.get(p.child_id) ?? 0) + 1);
  }

  let pendingReviews = 0;
  if (user.isOps) {
    const { count } = await serviceClient()
      .from('review_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'in_review');
    pendingReviews = count ?? 0;
  }

  return (
    <main className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Your children</h1>

      {user.isOps && (
        <div className="mt-4 rounded-lg border border-[var(--border)] p-4">
          <p className="text-sm">
            <strong>{pendingReviews}</strong> item{pendingReviews === 1 ? '' : 's'} waiting for
            review. <Link href="/review" className="underline">Open the review console</Link>
          </p>
        </div>
      )}

      {(children ?? []).length === 0 ? (
        <div className="mt-6">
          <p className="text-sm text-[var(--muted)]">
            Add your child to get started. We ask for consent at the same time — nothing is
            analysed without it.
          </p>
          <Link
            href="/children/new"
            className="mt-4 inline-block rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Add a child
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {(children ?? []).map((c) => {
              const childReports = reportsByChild.get(c.id) ?? [];
              const planCount = planCountByChild.get(c.id) ?? 0;
              const latest = childReports[0];
              return (
                <li key={c.id} className="rounded-lg border border-[var(--border)] p-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <Link href={`/children/${c.id}`} className="text-sm font-medium underline">
                      {c.first_name}
                    </Link>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {childReports.length} report{childReports.length === 1 ? '' : 's'} ·{' '}
                      {planCount} plan{planCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {c.grade}
                    {latest
                      ? ` · latest: ${latest.term_label ?? 'report'} — ${STAGE_LABEL[latest.status] ?? latest.status}`
                      : ' · no reports yet'}
                  </p>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 flex items-center gap-4">
            <Link
              href="/upload"
              className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
            >
              Upload a report
            </Link>
            <Link href="/children/new" className="text-sm underline">Add another child</Link>
          </div>
        </>
      )}
    </main>
  );
}
