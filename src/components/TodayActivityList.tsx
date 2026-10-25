import { TodayActivityActions } from './TodayActivityActions';

export interface TodayActivity {
  id: string;
  title: string;
  instructions: string;
  steps: string[];
  materials: string[];
  estimatedMinutes: number | null;
  /** Today's entry in the schedule — done items stay listed with a tick; skipped ones are filtered out by the caller. */
  dayStatus?: 'todo' | 'done' | 'skipped';
}

/**
 * The Today tab's activity list — what the schedule puts on today, with
 * Done / Not today / Remove on each (acting on today's entry only; see
 * db/schedule.ts). Anything already done today stays listed, ticked, so the
 * day reads as progress rather than a list that silently shrinks.
 */
export function TodayActivityList({
  activities,
  childId,
  emptyMessage = 'Nothing scheduled for today.',
}: {
  activities: TodayActivity[];
  childId: string;
  emptyMessage?: string;
}) {
  if (activities.length === 0) {
    return <p className="mt-3 text-sm text-[var(--muted)]">{emptyMessage}</p>;
  }

  return (
    <ul className="mt-3 space-y-3">
      {activities.map((a) => (
        <li key={a.id} className={a.dayStatus === 'done' ? 'rounded-lg border border-[var(--border)] p-4 opacity-70' : 'rounded-lg border border-[var(--border)] p-4'}>
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-sm font-medium">
              {a.dayStatus === 'done' && <span className="mr-1.5 text-[var(--accent)]" aria-hidden>✓</span>}
              {a.title}
              {a.dayStatus === 'done' && <span className="sr-only"> (done today)</span>}
            </h3>
            {a.estimatedMinutes != null && (
              <span className="shrink-0 text-xs text-[var(--muted)]">~{a.estimatedMinutes} min</span>
            )}
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">{a.instructions}</p>

          <p className="mt-3 text-xs text-[var(--muted)]">
            {a.materials.length ? `You'll need: ${a.materials.join(', ')}` : 'No materials needed'}
          </p>

          {a.steps.length > 0 && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {a.steps.map((s, i) => (
                <li key={i} className="whitespace-pre-line">{s}</li>
              ))}
            </ol>
          )}

          {a.dayStatus === 'done' ? (
            <p className="mt-3 text-xs text-[var(--muted)]">Done for today</p>
          ) : (
            <TodayActivityActions activityId={a.id} childId={childId} />
          )}
        </li>
      ))}
    </ul>
  );
}
