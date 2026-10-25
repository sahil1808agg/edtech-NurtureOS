import Link from 'next/link';
import { redirect } from 'next/navigation';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { getCurrentPlan } from '../../../../server/db/plans';
import { getPlanScheduleByActivity, todayISODate } from '../../../../server/db/schedule';
import { TodayActivityActions } from '../../../../components/TodayActivityActions';
import { AutoRefresh } from '../../../../components/AutoRefresh';
import { RequestPlan } from '../RequestPlan';
import { UploadForm } from './UploadForm';
import { loadChildJourney, REPORT_STAGE } from '../journey';

export const dynamic = 'force-dynamic';

/**
 * Report & plan tab — the middle of the parent journey: upload a report, see
 * what it found, and get (and adjust) the plan built from it. Shows the plan
 * first once there is one; until then the report is the step in hand, so it
 * leads.
 */
export default async function ReportAndPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  const journey = await loadChildJourney(db, id, user.familyId);
  const { reports, plans, shownPlan, planReady } = journey;

  // Findings live under a report, so they are listed by the report that
  // produced them rather than as a separate pile.
  const publishedReportIds = reports.filter((r) => r.status === 'published').map((r) => r.id);
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
    ? await db
        .from('findings')
        .select('id, kind, statement, finding_set_id')
        .in('finding_set_id', setIds)
        .eq('excluded', false)
    : { data: [] };

  type FindingRow = { id: string; kind: string; statement: string; finding_set_id: string };
  const findingsBySet = new Map<string, FindingRow[]>();
  for (const f of findings ?? []) {
    const list = findingsBySet.get(f.finding_set_id) ?? [];
    list.push(f);
    findingsBySet.set(f.finding_set_id, list);
  }

  // The plan is built from the most recent published set only (see
  // getTargetFindings), so the counts offered to the parent must describe that
  // set — not every finding this child has ever had — or the button would
  // promise activities from findings it will never look at.
  const latestSetId = (sets ?? [])[0]?.id ?? null;
  const allFindingIds = (findings ?? []).filter((f) => f.finding_set_id === latestSetId).map((f) => f.id);

  const { data: responses } = allFindingIds.length
    ? await db.from('parent_finding_responses').select('finding_id, response').in('finding_id', allFindingIds)
    : { data: [] };

  const rejectedCount = (responses ?? []).filter((r) => r.response === 'doesnt_match').length;
  const usableCount = allFindingIds.length - rejectedCount;
  const unreviewedCount = allFindingIds.length - (responses ?? []).length;

  const planInFlight = plans.some((p) => p.status === 'draft' || p.status === 'in_review');
  const currentPlan = planReady ? await getCurrentPlan(id) : null;

  // The plan is the whole two-week set; each activity shows which days the
  // schedule puts it on and how many of those are done. The day-by-day list
  // itself is the Today tab's job.
  const scheduleByActivity = currentPlan ? await getPlanScheduleByActivity(currentPlan.planId) : new Map();
  const allDays = [...scheduleByActivity.values()].flat().map((d) => d.day).sort();
  const todayDate = todayISODate();
  const shortDate = (iso: string, withWeekday = false) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
      ...(withWeekday ? { weekday: 'short' as const } : {}),
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const planRange = allDays.length ? `${shortDate(allDays[0])} – ${shortDate(allDays[allDays.length - 1])}` : null;

  const reportsSection = (
    <section>
      <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
        {reports.length > 1 ? 'Reports' : 'Report'}
      </h2>

      {reports.length === 0 ? (
        <div className="mt-3 rounded-lg border border-[var(--accent)] p-5">
          <p className="text-sm font-medium">Upload a school report</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            We read it, pull out what was actually assessed, and turn it into a few findings — each
            traceable to where it came from. Your plan is built from those.
          </p>
          <div className="mt-4">
            <UploadForm childId={id} />
          </div>
        </div>
      ) : (
        <>
          <ul className="mt-3 space-y-3">
            {reports.map((r) => {
              const set = setByReport.get(r.id);
              const list = set ? findingsBySet.get(set.id) ?? [] : [];
              return (
                <li key={r.id} className="rounded-lg border border-[var(--border)] p-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <Link href={`/reports/${r.id}`} className="text-sm font-medium underline">
                      {r.term_label ?? 'Report'}
                      {r.academic_year ? ` (${r.academic_year})` : ''}
                    </Link>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{REPORT_STAGE[r.status] ?? r.status}</span>
                  </div>

                  {set?.honesty_path && (
                    <p className="mt-2 text-xs text-[var(--muted)]">Not enough in this report to draw a conclusion.</p>
                  )}

                  {list.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
                      {list.map((f) => (
                        <li key={f.id} className="text-xs">
                          <span className="mr-2 text-[var(--muted)]">{f.kind === 'strength' ? 'Strength' : 'Developing'}</span>
                          <Link href={`/findings/${f.id}`} className="underline decoration-dotted">{f.statement}</Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          <details className="mt-3 rounded-lg border border-[var(--border)] p-4">
            <summary className="cursor-pointer text-sm">Upload another report</summary>
            <div className="mt-4">
              <UploadForm childId={id} compact />
            </div>
          </details>
        </>
      )}
    </section>
  );

  const planSection = (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
          {planReady ? `Your 2-week plan${planRange ? ` · ${planRange}` : ''}` : 'Plan'}
        </h2>
        {shownPlan && (
          <Link href={`/plans/${shownPlan.id}`} className="shrink-0 text-xs underline">Open full plan</Link>
        )}
      </div>

      {journey.planError && (
        <p className="mt-3 rounded-lg border border-[var(--border)] p-3 text-sm" role="status">{journey.planError}</p>
      )}

      {journey.planExpected && (
        <p className="mt-3 rounded-lg border border-[var(--border)] p-4 text-sm">
          Building your plan from the report — this can take a few minutes. It will appear here.
        </p>
      )}

      {!shownPlan && !journey.planExpected && !journey.planError && (
        <p className="mt-3 text-sm text-[var(--muted)]">
          {reports.length === 0
            ? 'Your plan is built from the report once it’s uploaded and read.'
            : journey.reportInProgress
              ? 'Your plan is built as soon as the report is ready.'
              : 'There’s nothing in the reports so far to build a plan from.'}
        </p>
      )}

      {currentPlan && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          Every activity for the next two weeks. Each day’s share is on the{' '}
          <Link href={`/children/${id}`} className="underline">Today</Link> tab.
        </p>
      )}

      {currentPlan && (
        <ul className="mt-3 space-y-3">
          {currentPlan.activities.map((a) => (
            <li key={a.id} className="rounded-lg border border-[var(--border)] p-4">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className={a.declined ? 'text-sm text-[var(--muted)] line-through' : 'text-sm font-medium'}>{a.title}</h3>
                {a.estimatedMinutes != null && (
                  <span className="shrink-0 text-xs text-[var(--muted)]">~{a.estimatedMinutes} min</span>
                )}
              </div>
              {!a.declined && <p className="mt-1 text-sm text-[var(--muted)]">{a.instructions}</p>}
              {a.declined ? (
                <p className="mt-2 text-xs text-[var(--muted)]">Removed — won’t come back in future plans</p>
              ) : (
                (() => {
                  const days: Array<{ day: string; status: string }> = scheduleByActivity.get(a.id) ?? [];
                  const done = days.filter((d) => d.status === 'done').length;
                  return (
                    <>
                      {days.length > 0 && (
                        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                          {days.map((d) => (
                            <span
                              key={d.day}
                              className={
                                d.day === todayDate
                                  ? 'font-medium text-[var(--accent)]'
                                  : d.status === 'done'
                                    ? 'text-[var(--muted)] line-through'
                                    : 'text-[var(--muted)]'
                              }
                            >
                              {d.status === 'done' ? '✓ ' : ''}
                              {d.day === todayDate ? 'Today' : shortDate(d.day, true)}
                            </span>
                          ))}
                          <span className="text-[var(--muted)]">· done {done} of {days.length}</span>
                        </div>
                      )}
                      <TodayActivityActions activityId={a.id} childId={id} mode="plan" />
                    </>
                  );
                })()
              )}
            </li>
          ))}
        </ul>
      )}

      {planReady && (
        <p className="mt-4 text-xs text-[var(--muted)]">
          Want to change something — shorter activities, more art, a different day?{' '}
          <Link href={`/children/${id}/chat`} className="underline">Ask in chat</Link> and the plan is updated for you.
        </p>
      )}

      {allFindingIds.length > 0 && !planInFlight && !journey.planExpected && (
        <RequestPlan
          childId={id}
          usableFindings={usableCount}
          rejectedFindings={rejectedCount}
          unreviewedFindings={unreviewedCount}
          hasExistingPlan={plans.length > 0}
        />
      )}
    </section>
  );

  return (
    <main className="max-w-3xl space-y-10">
      <AutoRefresh active={journey.reportInProgress || journey.planExpected} />
      {planReady ? (
        <>
          {planSection}
          {reportsSection}
        </>
      ) : (
        <>
          {reportsSection}
          {planSection}
        </>
      )}
    </main>
  );
}
