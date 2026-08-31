import Link from 'next/link';
import { redirect } from 'next/navigation';
import { routeClient, currentUser } from '../../lib/db/server';
import { serviceClient } from '../../lib/db/clients';

export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage() {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  if (!user.isOps) {
    return (
      <main className="max-w-3xl">
        <h1 className="text-xl font-semibold">Awaiting approval</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          This view is for operators. Your account is not marked as ops.
        </p>
      </main>
    );
  }

  const admin = serviceClient();

  const { data: queue } = await admin
    .from('review_queue')
    .select('id, artifact_id, artifact_type, created_at')
    .eq('status', 'in_review')
    .order('created_at', { ascending: true });

  const setIds = (queue ?? []).filter((q) => q.artifact_type === 'finding_set').map((q) => q.artifact_id);
  const planIds = (queue ?? []).filter((q) => q.artifact_type === 'plan').map((q) => q.artifact_id);

  // Finding sets are reviewed on the report page itself, so the queue links
  // straight there rather than to a console that showed the same thing again.
  const { data: sets } = setIds.length
    ? await admin
        .from('finding_sets')
        .select('id, report_id, honesty_path, model_deployment')
        .in('id', setIds)
    : { data: [] };
  const { data: plans } = planIds.length
    ? await admin.from('plans').select('id, cycle_no, model_deployment').in('id', planIds)
    : { data: [] };

  const setById = new Map((sets ?? []).map((s) => [s.id, s]));
  const planById = new Map((plans ?? []).map((p) => [p.id, p]));

  return (
    <main>
      <h1 className="text-xl font-semibold tracking-tight">Awaiting approval</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Findings and plans waiting on the parent who owns them. Read any of them to sample quality
        — approving is theirs to do, not yours.
      </p>

      {(queue ?? []).length === 0 ? (
        <p className="mt-8 text-sm text-[var(--muted)]">Queue is empty.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {(queue ?? []).map((q) => {
            const isPlan = q.artifact_type === 'plan';
            const set = setById.get(q.artifact_id);
            const plan = planById.get(q.artifact_id);
            const href = isPlan
              ? `/plans/${q.artifact_id}`
              : set?.report_id
                ? `/reports/${set.report_id}`
                : `/review/${q.artifact_id}`;

            return (
              <li key={q.id} className="rounded-lg border border-[var(--border)] p-4">
                <div className="flex items-baseline gap-2">
                  <span className="rounded bg-[var(--border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                    {isPlan ? 'plan' : 'findings'}
                  </span>
                  <Link href={href} className="text-sm font-medium underline">
                    {isPlan ? `Plan ${q.artifact_id.slice(0, 8)}` : `Finding set ${q.artifact_id.slice(0, 8)}`}
                  </Link>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {isPlan
                    ? `cycle ${plan?.cycle_no ?? '?'} · ${plan?.model_deployment ?? 'unknown model'}`
                    : `${set?.honesty_path ? 'Honesty path · ' : ''}${set?.model_deployment ?? 'unknown model'}`}
                  {' · '}
                  {new Date(q.created_at).toLocaleString()}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
