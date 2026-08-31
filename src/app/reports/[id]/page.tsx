import { redirect } from 'next/navigation';
import Link from 'next/link';
import { routeClient, currentUser } from '../../../lib/db/server';
import { HONESTY_PATH } from '../../../server/gates/sufficiency';

export const dynamic = 'force-dynamic';

/** What the parent is told at each pipeline stage, in plain language. */
const STAGE_MESSAGE: Record<string, string> = {
  uploaded: 'Received. Reading the report now.',
  extracted: 'Read the report. Matching what it covers to skills.',
  normalised: 'Matched the skills. Looking for patterns.',
  analysed: 'Found some patterns. Checking them against the teacher’s comments.',
  gated: 'Checks complete. Waiting for a person to review.',
  in_review: 'A person is reviewing this before you see it.',
};

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  // Scoped explicitly, not left to RLS: the reports policy widens to every
  // family for an ops account, and this is the parent-facing view.
  const { data: report } = await db
    .from('reports')
    .select('id, status, failure_reason, term_label, academic_year, child_id, created_at')
    .eq('id', id)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!report) return <main><p className="text-sm">Report not found.</p></main>;

  const { data: child } = await db
    .from('children')
    .select('first_name')
    .eq('id', report.child_id)
    .maybeSingle();

  const name = child?.first_name ?? 'your child';

  // A reviewer looking at a report they also parent should not have to go
  // hunting through the queue for it. Parents never see this.
  let reviewLink: string | null = null;
  if (user.isOps) {
    const { data: set } = await db
      .from('finding_sets')
      .select('id, status')
      .eq('report_id', id)
      .neq('status', 'rejected')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (set) reviewLink = `/review/${set.id}`;
  }

  const OpsBanner = () =>
    reviewLink ? (
      <div className="mb-6 rounded-lg border border-[var(--border)] p-4">
        <p className="text-sm">
          <span className="mr-2 rounded bg-[var(--border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            reviewer
          </span>
          You can review this report.{' '}
          <Link href={reviewLink} className="underline">Open it in the review console</Link>
        </p>
      </div>
    ) : null;

  if (report.status === 'failed') {
    return (
      <main>
        <h1 className="text-xl font-semibold tracking-tight">We could not read this report</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Something went wrong processing the file, so we have not produced anything. We would
          rather tell you than show you a guess.
        </p>
        {report.failure_reason && (
          <p className="mt-3 font-mono text-xs text-[var(--muted)]">{report.failure_reason}</p>
        )}
      </main>
    );
  }

  if (report.status === 'held') {
    return (
      <main>
        <h1 className="text-xl font-semibold tracking-tight">Nothing we would stand behind</h1>
        <p className="mt-3 text-sm">{HONESTY_PATH.statement}</p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[var(--muted)]">
          {HONESTY_PATH.questions.map((q) => <li key={q}>{q}</li>)}
        </ul>
      </main>
    );
  }

  // Only a published set is ever readable here — the gate, enforced in the query.
  const { data: findingSet } = await db
    .from('finding_sets')
    .select('id, honesty_path, published_at')
    .eq('report_id', id)
    .eq('status', 'published')
    .maybeSingle();

  if (!findingSet) {
    return (
      <main>
        <OpsBanner />
        <h1 className="text-xl font-semibold tracking-tight">{name}’s report</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          {STAGE_MESSAGE[report.status] ?? 'Working on it.'}
        </p>
        <p className="mt-6 text-xs text-[var(--muted)]">
          We will email you when it is ready. Nothing is shown until a person has checked it.
        </p>
      </main>
    );
  }

  if (findingSet.honesty_path) {
    return (
      <main>
        <h1 className="text-xl font-semibold tracking-tight">{name}’s report</h1>
        <p className="mt-3 text-sm">{HONESTY_PATH.statement}</p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[var(--muted)]">
          {HONESTY_PATH.questions.map((q) => <li key={q}>{q}</li>)}
        </ul>
      </main>
    );
  }

  const { data: findings } = await db
    .from('findings')
    .select('id, kind, statement, corroboration_status, corroboration_quote, position')
    .eq('finding_set_id', findingSet.id)
    .order('position');

  const findingIds = (findings ?? []).map((f) => f.id);
  const { data: citations } = findingIds.length
    ? await db
        .from('finding_citations')
        .select('finding_id, observation_id')
        .in('finding_id', findingIds)
    : { data: [] };

  const obsIds = (citations ?? []).map((c) => c.observation_id).filter(Boolean) as string[];
  const { data: observations } = obsIds.length
    ? await db
        .from('observations')
        .select('id, raw_label, term_index, raw_value, source_ref')
        .in('id', obsIds)
    : { data: [] };
  const obsById = new Map((observations ?? []).map((o) => [o.id, o]));

  const strengths = (findings ?? []).filter((f) => f.kind === 'strength');
  const growth = (findings ?? []).filter((f) => f.kind === 'growth');

  return (
    <main>
      <OpsBanner />
      <h1 className="text-xl font-semibold tracking-tight">
        {name}’s report{report.term_label ? ` — ${report.term_label}` : ''}
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {findings?.length ?? 0} findings, each traceable to what the report actually says.
        Reviewed by a person before publishing.
      </p>

      {[
        { title: 'Strengths', items: strengths },
        { title: 'Still developing', items: growth },
      ].map(({ title, items }) =>
        items.length === 0 ? null : (
          <section key={title} className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">{title}</h2>
            <ul className="mt-3 space-y-4">
              {items.map((f) => {
                const cites = (citations ?? [])
                  .filter((c) => c.finding_id === f.id)
                  .map((c) => (c.observation_id ? obsById.get(c.observation_id) : null))
                  .filter(Boolean);

                return (
                  <li
                    key={f.id}
                    id={`finding-${f.id}`}
                    className="scroll-mt-6 rounded-lg border border-[var(--border)] p-5 target:border-[var(--accent)]"
                  >
                    <p className="text-sm">{f.statement}</p>

                    {f.corroboration_status === 'corroborated' && f.corroboration_quote && (
                      <div className="mt-3">
                        <p className="text-xs font-medium text-[var(--accent)]">
                          The teacher said something similar
                        </p>
                        <blockquote className="mt-1 border-l-2 border-[var(--border)] pl-3 text-xs italic text-[var(--muted)]">
                          “{f.corroboration_quote.slice(0, 320)}
                          {f.corroboration_quote.length > 320 ? '…' : ''}”
                        </blockquote>
                      </div>
                    )}

                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-[var(--muted)]">
                        Where this comes from ({cites.length})
                      </summary>
                      <ul className="mt-2 space-y-1.5">
                        {cites.map((o, i) => {
                          const ref = o!.source_ref as { page?: number } | null;
                          const href =
                            `/reports/${id}/source` +
                            `?page=${ref?.page ?? ''}` +
                            `&label=${encodeURIComponent(o!.raw_label)}`;
                          return (
                            <li key={i} className="text-xs text-[var(--muted)]">
                              <Link href={href} className="underline decoration-dotted">
                                <span className="font-mono">
                                  Term {o!.term_index}: {o!.raw_value ?? '—'}
                                </span>
                                {ref?.page ? <span> · page {ref.page}</span> : null}
                                <br />
                                {o!.raw_label}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
    </main>
  );
}
