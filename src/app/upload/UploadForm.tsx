'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ChildOption {
  id: string;
  firstName: string;
  grade: string;
}

export function UploadForm({ children }: { children: ChildOption[] }) {
  const router = useRouter();
  const [childId, setChildId] = useState(children[0]?.id ?? '');
  const [termLabel, setTermLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setBusy(true);
    setError(null);

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

    router.push(`/reports/${body.reportId}`);
  }

  if (children.length === 0) {
    return (
      <p className="mt-6 text-sm text-[var(--muted)]">
        No children on your account yet. A child and a consent record must exist before a report can
        be analysed.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="child" className="block text-sm">Child</label>
        <select
          id="child" value={childId} onChange={(e) => setChildId(e.target.value)}
          className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        >
          {children.map((c) => (
            <option key={c.id} value={c.id}>{c.firstName} — {c.grade}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="term" className="block text-sm">Term (optional)</label>
        <input
          id="term" value={termLabel} onChange={(e) => setTermLabel(e.target.value)}
          placeholder="T3"
          className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="file" className="block text-sm">Report (PDF or photo)</label>
        <input
          id="file" type="file" required accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 w-full text-sm"
        />
        <p className="mt-1 text-xs text-[var(--muted)]">PDF, JPEG or PNG, up to 20MB.</p>
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <button
        type="submit" disabled={busy || !file}
        className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Uploading…' : 'Upload report'}
      </button>
    </form>
  );
}
