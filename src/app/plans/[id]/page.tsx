import { redirect } from 'next/navigation';
import Link from 'next/link';
import { routeClient, currentUser } from '../../../lib/db/server';

export const dynamic = 'force-dynamic';

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  // Scoped explicitly: the plans read policy widens to every family for ops,
  // and this is the parent-facing view.
  const { data: plan } = await db
    .from('plans')
    .select('id, child_id, cycle_no, status, topic_context, created_at')
    .eq('id', id)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!plan) return <main><p className="text-sm">Plan not found.</p></main>;

  const { data: child } = await db
    .from('children')
    .select('first_name')
    .eq('id', plan.child_id)
    .maybeSingle();
  const name = child?.first_name ?? 'your child';

  // A plan is only a plan once a person has approved it. 'published' is what
  // the sender will set once email exists; 'approved' means ready but unsent.
  const ready = plan.status === 'approved' || plan.status === 'published';

  let reviewLink: string | null = null;
  if (user.isOps && plan.status === 'draft') reviewLink = `/review/plan/${plan.id}`;

  if (!ready) {
    return (
      <main>
        {reviewLink && (
          <div className="mb-6 rounded-lg border border-[var(--border)] p-4">
            <p className="text-sm">
              <span className="mr-2 rounded bg-[var(--border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                reviewer
              </span>
              This plan is waiting for review.{' '}
              <Link href={reviewLink} className="underline">Open it in the review console</Link>
            </p>
          </div>
        )}
        <h1 className="text-xl font-semibold tracking-tight">{name}’s plan</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          {plan.status === 'rejected'
            ? 'This plan was not approved, so we are not showing it. A new one will follow.'
            : 'A person is checking this plan before you see it.'}
        </p>
      </main>
    );
  }

  const { data: activities } = await db
    .from('plan_activities')
    .select('id, position, kind, title, instructions, addresses_finding_id, resource_id')
    .eq('plan_id', id)
    .order('position');

  const findingIds = [...new Set((activities ?? []).map((a) => a.addresses_finding_id))];
  const { data: findings } = findingIds.length
    ? await db.from('findings').select('id, kind, statement').in('id', findingIds)
    : { data: [] };
  const findingById = new Map((findings ?? []).map((f) => [f.id, f]));

  const resourceIds = (activities ?? []).map((a) => a.resource_id).filter(Boolean) as string[];
  const { data: resources } = resourceIds.length
    ? await db.from('resources').select('id, title, url').in('id', resourceIds)
    : { data: [] };
  const resourceById = new Map((resources ?? []).map((r) => [r.id, r]));

  return (
    <main>
      <h1 className="text-xl font-semibold tracking-tight">
        {name}’s plan{plan.cycle_no > 1 ? ` — cycle ${plan.cycle_no}` : ''}
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Three things to try over the next two weeks. Each one targets something the report actually
        showed — you can see which.
      </p>
      {plan.topic_context && (
        <p className="mt-2 text-xs text-[var(--muted)]">Linked to class topic: {plan.topic_context}</p>
      )}

      <ol className="mt-6 space-y-4">
        {(activities ?? []).map((a) => {
          const finding = findingById.get(a.addresses_finding_id);
          const resource = a.resource_id ? resourceById.get(a.resource_id) : null;
          return (
            <li key={a.id} className="rounded-lg border border-[var(--border)] p-5">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-[var(--muted)]">{a.position}</span>
                <h2 className="text-sm font-medium">{a.title}</h2>
              </div>

              <p className="mt-2 text-sm">{a.instructions}</p>

              {resource && (
                <p className="mt-3 text-xs">
                  <a href={resource.url ?? '#'} target="_blank" rel="noreferrer" className="underline">
                    {resource.title}
                  </a>
                </p>
              )}

              {finding && (
                <p className="mt-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
                  Why this: {finding.statement}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {plan.status === 'approved' && (
        <p className="mt-6 text-xs text-[var(--muted)]">
          Not yet emailed — delivery is not built, so this page is the only place it appears.
        </p>
      )}
    </main>
  );
}
