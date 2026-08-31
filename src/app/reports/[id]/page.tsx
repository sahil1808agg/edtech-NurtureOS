import { redirect } from 'next/navigation';
import Link from 'next/link';
import { routeClient, currentUser } from '../../../lib/db/server';
import { HONESTY_PATH } from '../../../server/gates/sufficiency';
import { SourceViewer } from './SourceViewer';
import { ReviewActions } from '../../review/[id]/ReviewActions';
import { EditableFinding } from './EditableFinding';

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

  // Parents are scoped to their own family explicitly rather than relying on
  // RLS. Reviewers are not: reviewing happens on this page now, and a reviewer
  // necessarily works across families. That is the same widening the RLS policy
  // already grants (`... OR is_ops()`), applied deliberately rather than by
  // accident.
  let reportQuery = db
    .from('reports')
    .select('id, status, failure_reason, term_label, academic_year, child_id, source_type, family_id, created_at')
    .eq('id', id);
  if (!user.isOps) reportQuery = reportQuery.eq('family_id', user.familyId);

  const { data: report } = await reportQuery.maybeSingle();

  if (!report) return <main><p className="text-sm">Report not found.</p></main>;

  const { data: child } = await db
    .from('children')
    .select('first_name')
    .eq('id', report.child_id)
    .maybeSingle();

  const name = child?.first_name ?? 'your child';

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

  // A draft is fetched too, but only a reviewer may see one. Reviewing happens
  // on this page rather than in a separate console: the console showed the same
  // findings, the same citations and the same report, so the only thing it
  // added was two navigations between reading a claim and acting on it.
  const { data: findingSet } = await db
    .from('finding_sets')
    .select('id, status, honesty_path, published_at')
    .eq('report_id', id)
    .in('status', ['draft', 'published'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Approving is the parent's alone. Ops may still read a draft — sampling and
  // audit need that — but they get no controls, because deciding whether a
  // claim about someone's child is right is not an operator's call.
  const ownsReport = report.family_id === user.familyId;
  const isDraft = findingSet?.status === 'draft';
  const canReview = Boolean(isDraft && ownsReport);
  const canAudit = Boolean(isDraft && !ownsReport && user.isOps);
  const visible = Boolean(findingSet && (findingSet.status === 'published' || canReview || canAudit));

  if (!findingSet || !visible) {
    return (
      <main>
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
    .select('id, kind, statement, original_statement, excluded, corroboration_status, corroboration_quote, position')
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

  const { data: responses } = findingIds.length
    ? await db
        .from('parent_finding_responses')
        .select('finding_id, response')
        .in('finding_id', findingIds)
    : { data: [] };
  const responseByFinding = new Map((responses ?? []).map((r) => [r.finding_id, r.response]));

  const RESPONSE_LABEL: Record<string, string> = {
    matches: 'You said this matches',
    doesnt_match: 'You said this does not match',
    unsure: 'You were not sure',
  };

  // While it is still a draft the parent sees everything, including what they
  // have struck out, so they can put it back. Once approved, a finding they
  // left out is simply gone.
  const shown = (findings ?? []).filter((f) => canReview || !f.excluded);
  const strengths = shown.filter((f) => f.kind === 'strength');
  const growth = shown.filter((f) => f.kind === 'growth');

  const firstPage = (() => {
    const pages = (observations ?? [])
      .map((o) => (o.source_ref as { page?: number } | null)?.page)
      .filter((p): p is number => typeof p === 'number');
    return pages.length ? Math.min(...pages) : 1;
  })();

  return (
    <main>
      <h1 className="text-xl font-semibold tracking-tight">
        {name}’s report{report.term_label ? ` — ${report.term_label}` : ''}
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {findings?.length ?? 0} findings, each traceable to what the report actually says.
        Click any citation to jump the report to that page.
      </p>

      {canReview && (
        <div className="mt-4 rounded-lg border border-[var(--accent)] p-4">
          <p className="text-sm">
            <span className="mr-2 rounded bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
              needs your approval
            </span>
            Read these against the report — click any citation to jump to the page it came from.
            Approve them and we will build a plan.
          </p>
        </div>
      )}

      {canAudit && (
        <div className="mt-4 rounded-lg border border-[var(--border)] p-4">
          <p className="text-sm text-[var(--muted)]">
            <span className="mr-2 rounded bg-[var(--border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
              audit
            </span>
            Awaiting the parent’s approval. You can read it, but the decision is theirs.
          </p>
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div>
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
                    {canReview ? (
                      <EditableFinding
                        findingId={f.id}
                        statement={f.statement}
                        originalStatement={f.original_statement}
                        excluded={f.excluded}
                      />
                    ) : (
                      <p className="text-sm">
                        <Link href={`/findings/${f.id}`} className="hover:underline">
                          {f.statement}
                        </Link>
                      </p>
                    )}

                    {responseByFinding.has(f.id) && (
                      <p className="mt-2 text-xs text-[var(--accent)]">
                        {RESPONSE_LABEL[responseByFinding.get(f.id)!]}
                      </p>
                    )}

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
                          return (
                            <li key={i}>
                              <button
                                type="button"
                                data-source-page={ref?.page ?? undefined}
                                data-source-label={o!.raw_label}
                                className="text-left text-xs text-[var(--muted)] underline decoration-dotted hover:text-[var(--foreground)]"
                              >
                                <span className="font-mono">
                                  Term {o!.term_index}: {o!.raw_value ?? '—'}
                                </span>
                                {ref?.page ? <span> · page {ref.page}</span> : null}
                                <br />
                                {o!.raw_label}
                              </button>
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

          {canReview && <ReviewActions findingSetId={findingSet.id} asParent={ownsReport} />}
        </div>

        <SourceViewer
          reportId={report.id}
          isPdf={report.source_type === 'pdf'}
          initialPage={firstPage}
        />
      </div>
    </main>
  );
}
