'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ReviewActions({
  findingSetId,
  asParent = false,
}: {
  findingSetId: string;
  asParent?: boolean;
}) {
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

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(body.error ?? `Request failed (${res.status})`);
      return;
    }

    // Approved, but the plan did not start. Say so rather than looking like it
    // worked — the child page has a control to start one.
    if (decision === 'publish' && body.planError) {
      setError('Approved, but we could not start the plan. Try "Create a plan" on your child’s page.');
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
          {busy === 'publish'
            ? 'Approving…'
            : asParent
              ? 'These look right — build my plan'
              : 'Approve and publish'}
        </button>
        <button
          onClick={() => decide('reject')}
          disabled={busy !== null}
          className="rounded border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === 'reject'
            ? 'Holding…'
            : asParent
              ? 'These do not look right'
              : 'Reject (hold)'}
        </button>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        {asParent
          ? 'Approving builds a plan from these findings. If they do not look right we will hold them rather than act on them, and you can tell us what we got wrong.'
          : 'Publishing makes this visible to the parent. Rejecting holds the report and shows them an honest message instead.'}
      </p>
    </div>
  );
}
