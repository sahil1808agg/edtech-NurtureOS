'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Response = 'matches' | 'doesnt_match' | 'unsure';

const OPTIONS: { value: Response; label: string }[] = [
  { value: 'matches', label: 'Yes, that matches' },
  { value: 'doesnt_match', label: 'That does not match' },
  { value: 'unsure', label: 'Not sure' },
];

export function FindingResponse({
  findingId,
  initialResponse,
  initialNote,
}: {
  findingId: string;
  initialResponse: Response | null;
  initialNote: string | null;
}) {
  const router = useRouter();
  const [response, setResponse] = useState<Response | null>(initialResponse);
  const [note, setNote] = useState(initialNote ?? '');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(next: Response, nextNote = note) {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/findings/${findingId}/response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: next, note: nextNote }),
    });

    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Could not save (${res.status})`);
      return;
    }

    setResponse(next);
    setSaved(true);
    router.refresh();
  }

  return (
    <section className="mt-8 rounded-lg border border-[var(--border)] p-4">
      <h2 className="text-sm font-medium">Does this match what you see at home?</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        You know your child. Telling us when we have this wrong is the most useful thing you can do —
        it is recorded against the finding and used to check our work.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={busy}
            onClick={() => send(o.value)}
            className={`rounded border px-3 py-1.5 text-xs disabled:opacity-50 ${
              response === o.value
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--border)] hover:border-[var(--accent)]'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <label htmlFor="note" className="block text-xs text-[var(--muted)]">
          Anything you would add? (optional)
        </label>
        <textarea
          id="note"
          rows={2}
          value={note}
          onChange={(e) => { setNote(e.target.value); setSaved(false); }}
          onBlur={() => { if (response && note !== (initialNote ?? '')) send(response, note); }}
          className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
      {saved && !error && (
        <p className="mt-2 text-xs text-[var(--muted)]" role="status">Saved. Thank you.</p>
      )}
    </section>
  );
}
