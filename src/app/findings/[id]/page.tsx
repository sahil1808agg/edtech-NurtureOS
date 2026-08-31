import { redirect } from 'next/navigation';
import Link from 'next/link';
import { routeClient, currentUser } from '../../../lib/db/server';
import { SourceViewer } from '../../reports/[id]/SourceViewer';

export const dynamic = 'force-dynamic';

/**
 * One finding, with the report open beside it.
 *
 * The middle link in plan -> finding -> report. A plan activity says why it was
 * suggested; this is where that reason can be checked against the report.
 *
 * Published sets only. A finding in a draft or superseded set has not been
 * through review, and the whole point of the gate is that a parent never sees
 * unreviewed model output.
 */
export default async function FindingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  const { data: finding } = await db
    .from('findings')
    .select('id, kind, statement, corroboration_status, corroboration_quote, finding_set_id, family_id')
    .eq('id', id)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!finding) return <main className="max-w-3xl"><p className="text-sm">Finding not found.</p></main>;

  const { data: set } = await db
    .from('finding_sets')
    .select('id, report_id, status')
    .eq('id', finding.finding_set_id)
    .maybeSingle();

  if (!set || set.status !== 'published') {
    return (
      <main className="max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight">This finding is not current</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          It came from an earlier analysis that has since been replaced or was not approved, so we
          are not showing it or the report behind it. Anything we publish has been through review.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm underline">Back to your reports</Link>
      </main>
    );
  }

  const { data: report } = await db
    .from('reports')
    .select('id, term_label, source_type')
    .eq('id', set.report_id)
    .maybeSingle();

  const { data: citations } = await db
    .from('finding_citations')
    .select('observation_id')
    .eq('finding_id', id);

  const obsIds = (citations ?? []).map((c) => c.observation_id).filter(Boolean) as string[];
  const { data: observations } = obsIds.length
    ? await db
        .from('observations')
        .select('id, raw_label, term_index, raw_value, source_ref')
        .in('id', obsIds)
    : { data: [] };

  const pages = (observations ?? [])
    .map((o) => (o.source_ref as { page?: number } | null)?.page)
    .filter((p): p is number => typeof p === 'number');
  const firstPage = pages.length ? Math.min(...pages) : 1;

  return (
    <main>
      <Link href={`/reports/${set.report_id}`} className="text-xs underline text-[var(--muted)]">
        ← All findings for this report
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div>
          <span className="rounded bg-[var(--border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            {finding.kind === 'strength' ? 'strength' : 'still developing'}
          </span>

          <h1 className="mt-3 text-lg font-semibold tracking-tight">{finding.statement}</h1>

          {finding.corroboration_status === 'corroborated' && finding.corroboration_quote && (
            <div className="mt-4">
              <p className="text-xs font-medium text-[var(--accent)]">
                The teacher said something similar
              </p>
              <blockquote className="mt-1 border-l-2 border-[var(--border)] pl-3 text-xs italic text-[var(--muted)]">
                “{finding.corroboration_quote}”
              </blockquote>
            </div>
          )}

          <h2 className="mt-6 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            What this is based on
          </h2>
          <ul className="mt-2 space-y-1.5">
            {(observations ?? []).map((o) => {
              const ref = o.source_ref as { page?: number } | null;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    data-source-page={ref?.page ?? undefined}
                    data-source-label={o.raw_label}
                    className="text-left text-xs text-[var(--muted)] underline decoration-dotted hover:text-[var(--foreground)]"
                  >
                    <span className="font-mono">Term {o.term_index}: {o.raw_value ?? '—'}</span>
                    {ref?.page ? <span> · page {ref.page}</span> : null}
                    <br />
                    {o.raw_label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {report && (
          <SourceViewer
            reportId={report.id}
            isPdf={report.source_type === 'pdf'}
            initialPage={firstPage}
          />
        )}
      </div>
    </main>
  );
}
