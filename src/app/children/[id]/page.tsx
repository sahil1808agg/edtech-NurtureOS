import Link from 'next/link';
import { redirect } from 'next/navigation';
import { routeClient, currentUser } from '../../../lib/db/server';
import { RequestPlan } from './RequestPlan';

export const dynamic = 'force-dynamic';

const REPORT_STAGE: Record<string, string> = {
  uploaded: 'Reading the report',
  extracted: 'Matching skills',
  normalised: 'Looking for patterns',
  analysed: 'Checking against the teacher’s comments',
  in_review: 'Waiting for a person to review',
  published: 'Ready',
  held: 'Not enough to go on',
  failed: 'Could not be read',
};

export default async function ChildPage({ params }: { params: Promise<{ id: string }> }) {
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

  const [{ data: reports }, { data: plans }] = await Promise.all([
    db
      .from('reports')
      .select('id, status, term_label, academic_year, created_at')
      .eq('child_id', id)
      .eq('family_id', user.familyId)
      .order('created_at', { ascending: false }),
    db
      .from('plans')
      .select('id, cycle_no, status, created_at')
      .eq('child_id', id)
      .eq('family_id', user.familyId)
      .order('cycle_no', { ascending: false }),
  ]);

  // Findings live under a report, so they are listed by the report that
  // produced them rather than as a separate pile.
  const publishedReportIds = (reports ?? []).filter((r) => r.status === 'published').map((r) => r.id);
  const { data: sets } = publishedReportIds.length
    ? await db
        .from('finding_sets')
        .select('id, report_id, honesty_path, created_at')
        .in('report_id', publishedReportIds)
        .eq('status', 'published')
        .order('created_at', { ascending: false })
    : { data: [] };

  const setByReport = new Map((sets ?? []).map((s) => [s.report_id, s]));
  const setIds = (sets ?? []).map((s) => s.id);
  const { data: findings } = setIds.length
    ? await db.from('findings').select('id, kind, statement, finding_set_id').in('finding_set_id', setIds)
    : { data: [] };

  const findingsBySet = new Map<string, typeof findings>();
  for (const f of findings ?? []) {
    const list = findingsBySet.get(f.finding_set_id) ?? [];
    list.push(f);
    findingsBySet.set(f.finding_set_id, list as never);
  }

  // The plan is built from the most recent published set only (see
  // getTargetFindings), so the counts offered to the parent must describe that
  // set — not every finding this child has ever had — or the button would
  // promise activities from findings it will never look at.
  const latestSetId = (sets ?? [])[0]?.id ?? null;
  const allFindingIds = (findings ?? [])
    .filter((f) => f.finding_set_id === latestSetId)
    .map((f) => f.id);

  const { data: responses } = allFindingIds.length
    ? await db
        .from('parent_finding_responses')
        .select('finding_id, response')
        .in('finding_id', allFindingIds)
    : { data: [] };

  const rejectedCount = (responses ?? []).filter((r) => r.response === 'doesnt_match').length;
  const reviewedCount = (responses ?? []).length;
  const usableCount = allFindingIds.length - rejectedCount;
  const unreviewedCount = allFindingIds.length - reviewedCount;

  const planInFlight = (plans ?? []).some((p) => p.status === 'draft' || p.status === 'in_review');

  const ageYears = Math.floor(
    (Date.now() - new Date(child.dob).getTime()) / (365.25 * 24 * 3600 * 1000),
  );

  return (
    <main className="max-w-3xl">
      <Link href="/" className="text-xs underline text-[var(--muted)]">← All children</Link>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{child.first_name}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">{child.grade} · {ageYears} years old</p>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Reports</h2>
          <Link href="/upload" className="text-xs underline">Upload a report</Link>
        </div>

        {(reports ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">No reports yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {(reports ?? []).map((r) => {
              const set = setByReport.get(r.id);
              const list = set ? findingsBySet.get(set.id) ?? [] : [];
              return (
                <li key={r.id} className="rounded-lg border border-[var(--border)] p-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <Link href={`/reports/${r.id}`} className="text-sm font-medium underline">
                      {r.term_label ?? 'Report'}
                      {r.academic_year ? ` (${r.academic_year})` : ''}
                    </Link>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {REPORT_STAGE[r.status] ?? r.status}
                    </span>
                  </div>

                  {set?.honesty_path && (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Not enough in this report to draw a conclusion.
                    </p>
                  )}

                  {list.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
                      {list.map((f) => (
                        <li key={f.id} className="text-xs">
                          <span className="mr-2 text-[var(--muted)]">
                            {f.kind === 'strength' ? 'Strength' : 'Developing'}
                          </span>
                          <Link href={`/findings/${f.id}`} className="underline decoration-dotted">
                            {f.statement}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Plans</h2>

        {allFindingIds.length > 0 && !planInFlight && (
          <RequestPlan
            childId={child.id}
            usableFindings={usableCount}
            rejectedFindings={rejectedCount}
            unreviewedFindings={unreviewedCount}
            hasExistingPlan={(plans ?? []).length > 0}
          />
        )}

        {(plans ?? []).length === 0 ? (
          allFindingIds.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              Once a report’s findings are published, you can read them and then ask for a plan.
            </p>
          ) : null
        ) : (
          <ul className="mt-3 space-y-3">
            {(plans ?? []).map((p) => (
              <li key={p.id} className="rounded-lg border border-[var(--border)] p-4">
                <div className="flex items-baseline justify-between gap-4">
                  <Link href={`/plans/${p.id}`} className="text-sm font-medium underline">
                    Cycle {p.cycle_no}
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
        )}
      </section>
    </main>
  );
}
