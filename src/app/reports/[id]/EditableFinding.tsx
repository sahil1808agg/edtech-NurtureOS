'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function EditableFinding({
  findingId,
  statement,
  originalStatement,
  excluded,
}: {
  findingId: string;
  statement: string;
  originalStatement: string | null;
  excluded: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(statement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: { statement?: string; excluded?: boolean }) {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/findings/${findingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });

    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Could not save (${res.status})`);
      return;
    }

    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        />
        {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
        <div className="mt-2 flex gap-2">
          <button
            type="button" disabled={busy || draft.trim() === statement}
            onClick={() => save({ statement: draft })}
            className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button" disabled={busy}
            onClick={() => { setDraft(statement); setEditing(false); setError(null); }}
            className="rounded border border-[var(--border)] px-3 py-1 text-xs"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className={`text-sm ${excluded ? 'text-[var(--muted)] line-through' : ''}`}>{statement}</p>

      {originalStatement && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-[var(--muted)]">
            You edited this — see what we originally wrote
          </summary>
          <p className="mt-1 border-l-2 border-[var(--border)] pl-3 text-xs italic text-[var(--muted)]">
            {originalStatement}
          </p>
        </details>
      )}

      {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}

      <div className="mt-2 flex gap-3">
        <button
          type="button" disabled={busy} onClick={() => setEditing(true)}
          className="text-xs text-[var(--muted)] underline hover:text-[var(--foreground)] disabled:opacity-50"
        >
          Reword this
        </button>
        <button
          type="button" disabled={busy}
          onClick={() => save({ excluded: !excluded })}
          className="text-xs text-[var(--muted)] underline hover:text-[var(--foreground)] disabled:opacity-50"
        >
          {excluded ? 'Put it back' : 'Leave this one out'}
        </button>
      </div>
    </div>
  );
}
