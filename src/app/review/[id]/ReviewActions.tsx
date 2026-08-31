'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ReviewActions({ findingSetId }: { findingSetId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'publish' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'publish' | 'reject') {
    setBusy(decision);
    setError(null);

    const res = await fetch(`/api/review/${findingSetId}/decision`, {
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

    // Stay put. Reviewing happens on the report page now, and publishing turns
    // that same page into what the parent will see — which is the most useful
    // thing to look at immediately after deciding.
    router.refresh();
  }

  return (
    <div className="mt-8 border-t border-[var(--border)] pt-6">
      {error && <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex gap-3">
        <button
          onClick={() => decide('publish')}
          disabled={busy !== null}
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === 'publish' ? 'Publishing…' : 'Approve and publish'}
        </button>
        <button
          onClick={() => decide('reject')}
          disabled={busy !== null}
          className="rounded border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === 'reject' ? 'Rejecting…' : 'Reject (hold)'}
        </button>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Publishing makes this visible to the parent. Rejecting holds the report and shows them an
        honest message instead.
      </p>
    </div>
  );
}
