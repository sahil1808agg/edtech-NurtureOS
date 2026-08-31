import { redirect } from 'next/navigation';
import Link from 'next/link';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { serviceClient } from '../../../../lib/db/clients';
import { PlanReviewActions } from './PlanReviewActions';

export const dynamic = 'force-dynamic';

export default async function PlanReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');
  if (!user.isOps) return <main><p className="text-sm">Not authorised.</p></main>;

  const admin = serviceClient();

  const { data: plan } = await admin
    .from('plans')
    .select('id, child_id, cycle_no, status, topic_context, model_deployment, prompt_version, created_at')
    .eq('id', id)
    .maybeSingle();

  if (!plan) return <main><p className="text-sm">Plan not found.</p></main>;

  const { data: activities } = await admin
    .from('plan_activities')
    .select('id, position, kind, title, instructions, addresses_finding_id, resource_id')
    .eq('plan_id', id)
    .order('position');

  const findingIds = [...new Set((activities ?? []).map((a) => a.addresses_finding_id))];
  const { data: findings } = findingIds.length
    ? await admin.from('findings').select('id, kind, statement').in('id', findingIds)
    : { data: [] };
  const findingById = new Map((findings ?? []).map((f) => [f.id, f]));

  const resourceIds = (activities ?? []).map((a) => a.resource_id).filter(Boolean) as string[];
  const { data: resources } = resourceIds.length
    ? await admin.from('resources').select('id, title, url, kind').in('id', resourceIds)
    : { data: [] };
  const resourceById = new Map((resources ?? []).map((r) => [r.id, r]));

  return (
    <main>
      <Link href="/review" className="text-xs underline text-[var(--muted)]">← Review queue</Link>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Plan {plan.id.slice(0, 8)}</h1>
      <p className="mt-1 text-xs text-[var(--muted)]">
        cycle {plan.cycle_no} · {plan.model_deployment} · {plan.prompt_version} · status {plan.status}
      </p>
      {plan.topic_context && (
        <p className="mt-3 rounded border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
          Class context given to the model: {plan.topic_context}
        </p>
      )}

      <ol className="mt-6 space-y-5">
        {(activities ?? []).map((a) => {
          const finding = findingById.get(a.addresses_finding_id);
          const resource = a.resource_id ? resourceById.get(a.resource_id) : null;
          return (
            <li key={a.id} className="rounded-lg border border-[var(--border)] p-5">
              <div className="flex items-baseline gap-2">
                <span className="rounded bg-[var(--border)] px-2 py-0.5 text-xs font-medium uppercase">
                  {a.kind}
                </span>
                <h2 className="text-sm font-medium">{a.title}</h2>
              </div>

              <p className="mt-3 text-sm">{a.instructions}</p>

              <div className="mt-4 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
                <p>
                  <strong>Addresses:</strong>{' '}
                  {finding
                    ? `[${finding.kind}] ${finding.statement}`
                    : <span className="text-red-600">finding {a.addresses_finding_id.slice(0, 8)} not found</span>}
                </p>
                {resource ? (
                  <p className="mt-1">
                    <strong>Resource:</strong> {resource.title}{' '}
                    <a href={resource.url ?? '#'} target="_blank" rel="noreferrer" className="underline">
                      (open)
                    </a>
                  </p>
                ) : (
                  <p className="mt-1">No resource — home activity using what the family already has.</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {plan.status === 'draft' ? (
        <PlanReviewActions planId={plan.id} />
      ) : (
        <p className="mt-8 text-sm text-[var(--muted)]">
          Already reviewed — status is <strong>{plan.status}</strong>.
        </p>
      )}
    </main>
  );
}
