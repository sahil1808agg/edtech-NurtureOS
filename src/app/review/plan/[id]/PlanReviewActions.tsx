'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function PlanReviewActions({
  planId,
  asParent = false,
}: {
  planId: string;
  asParent?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(decision);
    setError(null);

    const res = await fetch(`/api/review/plan/${planId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });

    setBusy(null);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Request failed (${res.status})`);
      return;
    }
    // Stay on the plan; approving turns this page into the parent's view of it.
    router.refresh();
  }

  return (
    <div className="mt-8 border-t border-[var(--border)] pt-6">
      {error && <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex gap-3">
        <button
          onClick={() => decide('approve')}
          disabled={busy !== null}
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === 'approve' ? 'Starting…' : asParent ? 'Start this plan' : 'Approve plan'}
        </button>
        <button
          onClick={() => decide('reject')}
          disabled={busy !== null}
          className="rounded border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === 'reject' ? 'Holding…' : asParent ? 'Not right for us' : 'Reject'}
        </button>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        {asParent
          ? 'Starting a plan means these are the things to try over the next couple of weeks.'
          : 'Approving marks the plan ready for the parent. It is not sent until email delivery exists.'}
      </p>
    </div>
  );
}
