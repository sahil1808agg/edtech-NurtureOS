'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Shared by the home list and the child detail page — only what happens after differs. */
export function DeleteChildButton({
  childId,
  name,
  redirectTo,
}: {
  childId: string;
  name: string;
  /** Where to send the browser after a successful delete. Omit to just refresh in place (e.g. a list). */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/children/${childId}`, { method: 'DELETE' });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Could not delete (${res.status})`);
      setBusy(false);
      return;
    }

    if (redirectTo) router.push(redirectTo);
    router.refresh();
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-red-600 underline"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm">
        Delete {name} and everything attached to them — reports, findings, plans, and chat
        history? This cannot be undone.
      </p>
      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={confirmDelete}
          disabled={busy}
          className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Yes, delete'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="text-sm underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
