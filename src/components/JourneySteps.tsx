import Link from 'next/link';

export interface JourneyStep {
  label: string;
  state: 'done' | 'current' | 'todo';
  /** Shown under the current step only. */
  detail?: string;
  action?: { href: string; label: string };
}

/**
 * The parent journey as a short vertical tracker — shown on the Today tab
 * until there is a plan to work from, so a new parent always knows the next
 * thing to do.
 */
export function JourneySteps({ steps }: { steps: JourneyStep[] }) {
  return (
    <ol className="space-y-4">
      {steps.map((s, i) => (
        <li key={s.label} className="flex gap-3">
          <span
            aria-hidden
            className={
              s.state === 'done'
                ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-medium text-white'
                : s.state === 'current'
                  ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[var(--accent)] text-xs font-medium'
                  : 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-xs text-[var(--muted)]'
            }
          >
            {s.state === 'done' ? '✓' : i + 1}
          </span>
          <div className="pt-0.5">
            <p className={s.state === 'todo' ? 'text-sm text-[var(--muted)]' : 'text-sm font-medium'}>
              {s.label}
              <span className="sr-only">{s.state === 'done' ? ' (done)' : s.state === 'current' ? ' (current step)' : ''}</span>
            </p>
            {s.state === 'current' && s.detail && (
              <p className="mt-1 text-sm text-[var(--muted)]">{s.detail}</p>
            )}
            {s.state === 'current' && s.action && (
              <Link
                href={s.action.href}
                className="mt-3 inline-block rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
              >
                {s.action.label}
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
