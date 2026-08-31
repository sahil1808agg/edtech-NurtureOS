'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RequestPlan({
  childId,
  usableFindings,
  rejectedFindings,
  unreviewedFindings,
  hasExistingPlan,
}: {
  childId: string;
  usableFindings: number;
  rejectedFindings: number;
  unreviewedFindings: number;
  hasExistingPlan: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  async function request() {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/children/${childId}/plan`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? `Could not start a plan (${res.status})`);
      return;
    }

    setQueued(true);
    router.refresh();
  }

  if (queued) {
    return (
      <div className="mt-3 rounded-lg border border-[var(--border)] p-4">
        <p className="text-sm">Building your plan. It will appear here once a person has checked it.</p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] p-4">
      <p className="text-sm">
        {hasExistingPlan ? 'Build a new plan from your feedback?' : 'Ready for a plan?'}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {hasExistingPlan
          ? 'Your first plan was made when the findings were published, before you had marked any of them. '
          : ''}
        We will build activities covering every area the {usableFindings} finding
        {usableFindings === 1 ? '' : 's'} you have not ruled out point to.
        {rejectedFindings > 0 && (
          <> The {rejectedFindings} you said {rejectedFindings === 1 ? 'does' : 'do'} not match will be left out.</>
        )}
        {unreviewedFindings > 0 && (
          <> {unreviewedFindings} {unreviewedFindings === 1 ? 'is' : 'are'} still unreviewed — worth
          reading first, but not required.</>
        )}
      </p>

      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}

      <button
        type="button"
        onClick={request}
        disabled={busy || usableFindings === 0}
        className="mt-3 rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Starting…' : hasExistingPlan ? 'Create an updated plan' : 'Create a plan'}
      </button>

      {usableFindings === 0 && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Nothing left to plan against — you have ruled out every finding.
        </p>
      )}
    </div>
  );
}
