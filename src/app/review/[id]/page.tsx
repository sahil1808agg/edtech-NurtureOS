import { redirect } from 'next/navigation';
import Link from 'next/link';
import { routeClient, currentUser } from '../../../lib/db/server';
import { serviceClient } from '../../../lib/db/clients';
import { ReviewActions } from './ReviewActions';
import { HONESTY_PATH } from '../../../server/gates/sufficiency';

export const dynamic = 'force-dynamic';

const CORROBORATION_LABEL: Record<string, string> = {
  corroborated: 'Corroborated by the teacher’s comments',
  not_mentioned: 'Not mentioned in the teacher’s comments',
  conflicting: 'CONFLICTS with the teacher’s comments',
};

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');
  if (!user.isOps) return <main><p className="text-sm">Not authorised.</p></main>;

  const admin = serviceClient();

  const { data: set } = await admin
    .from('finding_sets')
    .select('id, report_id, status, honesty_path, model_deployment, prompt_version, created_at')
    .eq('id', id)
    .maybeSingle();

  if (!set) return <main><p className="text-sm">Finding set not found.</p></main>;

  const { data: findings } = await admin
    .from('findings')
    .select('id, kind, statement, corroboration_status, corroboration_quote, position')
    .eq('finding_set_id', id)
    .order('position');

  const findingIds = (findings ?? []).map((f) => f.id);
  const { data: citations } = findingIds.length
    ? await admin
        .from('finding_citations')
        .select('finding_id, observation_id, narrative_id')
        .in('finding_id', findingIds)
    : { data: [] };

  const obsIds = (citations ?? []).map((c) => c.observation_id).filter(Boolean) as string[];
  const { data: observations } = obsIds.length
    ? await admin
        .from('observations')
        .select('id, raw_label, term_index, raw_value, source_ref')
        .in('id', obsIds)
    : { data: [] };
  const obsById = new Map((observations ?? []).map((o) => [o.id, o]));

  return (
    <main>
      <Link href="/review" className="text-xs underline text-[var(--muted)]">← Review queue</Link>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Finding set {set.id.slice(0, 8)}</h1>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {set.model_deployment} · {set.prompt_version} · status {set.status}
      </p>

      {set.honesty_path ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] p-5">
          <h2 className="text-sm font-medium">Honesty path</h2>
          <p className="mt-2 text-sm">{HONESTY_PATH.statement}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
            {HONESTY_PATH.questions.map((q) => <li key={q}>{q}</li>)}
          </ul>
          <p className="mt-3 text-xs text-[var(--muted)]">
            The report was too thin to support a finding, so no model ran. This static text is what
            the parent will see.
          </p>
        </section>
      ) : (
        <ol className="mt-6 space-y-5">
          {(findings ?? []).map((f) => {
            const cites = (citations ?? []).filter((c) => c.finding_id === f.id);
            return (
              <li key={f.id} className="rounded-lg border border-[var(--border)] p-5">
                <div className="flex items-baseline gap-2">
                  <span className="rounded bg-[var(--border)] px-2 py-0.5 text-xs font-medium uppercase">
                    {f.kind}
                  </span>
                  {f.corroboration_status === 'conflicting' && (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                      conflicting
                    </span>
                  )}
                </div>

                <p className="mt-3 text-sm">{f.statement}</p>

                <p className="mt-3 text-xs text-[var(--muted)]">
                  {CORROBORATION_LABEL[f.corroboration_status] ?? f.corroboration_status}
                </p>
                {f.corroboration_quote && (
                  <blockquote className="mt-2 border-l-2 border-[var(--border)] pl-3 text-xs italic text-[var(--muted)]">
                    “{f.corroboration_quote}”
                  </blockquote>
                )}

                <details className="mt-4">
                  <summary className="cursor-pointer text-xs text-[var(--muted)]">
                    {cites.length} citation{cites.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {cites.map((c, i) => {
                      const o = c.observation_id ? obsById.get(c.observation_id) : null;
                      if (!o) return <li key={i} className="text-xs text-[var(--muted)]">narrative citation</li>;
                      const ref = o.source_ref as { page?: number } | null;
                      return (
                        <li key={i} className="text-xs text-[var(--muted)]">
                          <span className="font-mono">T{o.term_index} = {o.raw_value ?? '—'}</span>
                          {ref?.page ? <span> · p{ref.page}</span> : null} · {o.raw_label}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </li>
            );
          })}
        </ol>
      )}

      {set.status === 'draft' ? (
        <ReviewActions findingSetId={set.id} />
      ) : (
        <p className="mt-8 text-sm text-[var(--muted)]">
          Already reviewed — status is <strong>{set.status}</strong>.
        </p>
      )}
    </main>
  );
}
