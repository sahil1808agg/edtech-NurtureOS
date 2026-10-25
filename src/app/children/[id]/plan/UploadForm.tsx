'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Upload a report for one child, from inside that child's Report & plan tab.
 * Stays on the page afterwards (router.refresh) rather than navigating away:
 * the tab itself shows the report moving through the pipeline and the plan
 * that follows, which is the next step of the journey.
 */
export function UploadForm({ childId, compact = false }: { childId: string; compact?: boolean }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [termLabel, setTermLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setBusy(true);
    setError(null);
    setDone(false);

    const form = new FormData();
    form.set('file', file);
    form.set('childId', childId);
    if (termLabel) form.set('termLabel', termLabel);

    const res = await fetch('/api/reports', { method: 'POST', body: form });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      // The consent refusal is a real, expected outcome, not a crash — say so plainly.
      setError(body.reason ? `${body.error} (${body.reason})` : body.error ?? `Upload failed (${res.status})`);
      return;
    }

    setFile(null);
    setTermLabel('');
    if (fileInput.current) fileInput.current.value = '';
    setDone(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className={compact ? 'space-y-3' : 'space-y-4'}>
      <div>
        <label htmlFor="file" className="block text-sm">Report (PDF or photo)</label>
        <input
          id="file" ref={fileInput} type="file" required accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 w-full text-sm"
        />
        <p className="mt-1 text-xs text-[var(--muted)]">PDF, JPEG or PNG, up to 20MB.</p>
      </div>

      <div>
        <label htmlFor="term" className="block text-sm">Term (optional)</label>
        <input
          id="term" value={termLabel} onChange={(e) => setTermLabel(e.target.value)}
          placeholder="T3"
          className="mt-1 w-full max-w-xs rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {done && <p className="text-sm text-[var(--muted)]" role="status">Uploaded — we’re reading it now.</p>}

      <button
        type="submit" disabled={busy || !file}
        className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Uploading…' : 'Upload report'}
      </button>
    </form>
  );
}
