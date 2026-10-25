import Link from 'next/link';
import { redirect } from 'next/navigation';
import { routeClient, currentUser } from '../../../lib/db/server';
import { getScheduleForDay, todayISODate } from '../../../server/db/schedule';
import { TodayActivityList } from '../../../components/TodayActivityList';
import { JourneySteps, type JourneyStep } from '../../../components/JourneySteps';
import { AutoRefresh } from '../../../components/AutoRefresh';
import { loadChildJourney, REPORT_STAGE } from './journey';

export const dynamic = 'force-dynamic';

/**
 * Today tab — the end of the parent journey and where they work from each
 * day. Until there is a plan to work from it shows the journey itself
 * (child added → upload report → plan → Today) with the next step to take.
 * The child header and tabs come from ./layout.tsx.
 */
export default async function TodayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  const journey = await loadChildJourney(db, id, user.familyId);
  const planTab = `/children/${id}/plan`;

  if (!journey.planReady) {
    const latest = journey.reports[0];
    const uploaded = journey.reports.length > 0;

    let planDetail = '';
    if (journey.planError) planDetail = journey.planError;
    else if (journey.planExpected) planDetail = 'Your report is ready. We’re building the plan now — this can take a few minutes.';
    else if (latest) planDetail = `${REPORT_STAGE[latest.status] ?? 'Working on it'}. Your plan is built as soon as the report is ready.`;

    const steps: JourneyStep[] = [
      { label: 'Add your child', state: 'done' },
      {
        label: 'Upload a school report',
        state: uploaded ? 'done' : 'current',
        detail: 'A PDF or photo of their latest report. We turn it into a few findings you can check.',
        action: { href: planTab, label: 'Upload a report' },
      },
      {
        label: 'Get a plan',
        state: uploaded ? 'current' : 'todo',
        detail: planDetail,
        // Nothing to click while the pipeline is still working — the page
        // refreshes itself (AutoRefresh below) as it moves along.
        action: journey.reportInProgress || journey.planExpected
          ? undefined
          : { href: planTab, label: 'Open report & plan' },
      },
      { label: 'Try a few activities each day', state: 'todo' },
    ];

    return (
      <main className="max-w-2xl">
        <AutoRefresh active={journey.reportInProgress || journey.planExpected} />
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Getting started</h2>
        <div className="mt-4">
          <JourneySteps steps={steps} />
        </div>
      </main>
    );
  }

  // Today is what the plan's schedule puts on today's date (db/schedule.ts) —
  // not the whole plan, which lives on the Report & plan tab. Skipped items
  // drop off; done ones stay, ticked.
  const schedule = await getScheduleForDay(id);
  const todays = (schedule?.activities ?? []).filter((a) => a.dayStatus !== 'skipped');
  const doneCount = todays.filter((a) => a.dayStatus === 'done').length;
  const finished = schedule?.endsOn != null && schedule.endsOn < todayISODate();
  const unscheduled = schedule != null && schedule.endsOn == null;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <main className="max-w-2xl">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Today · {today}</h2>
        <Link href={planTab} className="shrink-0 text-xs underline">See the full plan</Link>
      </div>

      {journey.planError && (
        <p className="mt-3 rounded-lg border border-[var(--border)] p-3 text-sm" role="status">
          {journey.planError}
        </p>
      )}

      {finished ? (
        <div className="mt-3 rounded-lg border border-[var(--border)] p-4">
          <p className="text-sm font-medium">This plan has finished.</p>
          <p className="mt-1 text-sm text-[var(--muted)]">Ready for the next two weeks? Build a new plan from the latest report.</p>
          <Link href={planTab} className="mt-3 inline-block rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
            Get a new plan
          </Link>
        </div>
      ) : unscheduled ? (
        <p className="mt-3 text-sm text-[var(--muted)]">Today’s list isn’t ready yet — your plan doesn’t have a day-by-day schedule.</p>
      ) : (
        <>
          {todays.length > 0 && (
            <p className="mt-1 text-xs text-[var(--muted)]">
              {doneCount === todays.length ? 'All done for today — nice work.' : `${doneCount} of ${todays.length} done`}
            </p>
          )}
          <TodayActivityList
            activities={todays}
            childId={id}
            emptyMessage="Nothing scheduled for today — a rest day."
          />
        </>
      )}

      <p className="mt-6 text-xs text-[var(--muted)]">
        Want something different? <Link href={`/children/${id}/chat`} className="underline">Ask in chat</Link>
        {' '}— e.g. “make today’s activities shorter”.
      </p>
    </main>
  );
}
