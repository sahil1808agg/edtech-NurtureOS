import { TodayActivityActions } from './TodayActivityActions';

export interface TodayActivity {
  id: string;
  title: string;
  instructions: string;
  steps: string[];
  materials: string[];
  estimatedMinutes: number | null;
}

/**
 * The Today card's activity list — what's left to try, with Done / Not
 * today / Remove on each. Shared by the child page and the chat page's own
 * Today panel so a parent sees and acts on the same thing from either
 * surface, rather than chat replies (free-text, and often answered without
 * calling any tool — see chat-planning-agent.md's status-question rule)
 * trying to carry their own, unreliable copy of this.
 */
export function TodayActivityList({
  activities,
  childId,
  emptyMessage = 'Nothing left in this plan — nice work.',
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
        <li key={a.id} className="rounded-lg border border-[var(--border)] p-4">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-sm font-medium">{a.title}</h3>
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

          <TodayActivityActions activityId={a.id} childId={childId} />
        </li>
      ))}
    </ul>
  );
}
