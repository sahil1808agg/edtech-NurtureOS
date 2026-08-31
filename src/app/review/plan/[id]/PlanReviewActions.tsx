'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function PlanReviewActions({ planId }: { planId: string }) {
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
    router.push('/review');
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
          {busy === 'approve' ? 'Approving…' : 'Approve plan'}
        </button>
        <button
          onClick={() => decide('reject')}
          disabled={busy !== null}
          className="rounded border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Approving marks the plan ready for the parent. It is not sent until email delivery exists.
      </p>
    </div>
  );
}
