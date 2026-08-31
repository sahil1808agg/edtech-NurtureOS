'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewChildPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [dob, setDob] = useState('');
  const [grade, setGrade] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch('/api/children', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, dob, grade, consent }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? `Could not add your child (${res.status})`);
      return;
    }

    router.push(`/children/${body.childId}`);
    router.refresh();
  }

  return (
    <main className="max-w-lg">
      <h1 className="text-xl font-semibold tracking-tight">Add your child</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        We need their age and class to judge whether a finding is age-appropriate, and to pitch
        activities correctly.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="firstName" className="block text-sm">First name</label>
          <input
            id="firstName" required value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="dob" className="block text-sm">Date of birth</label>
          <input
            id="dob" type="date" required value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="grade" className="block text-sm">Class or grade</label>
          <input
            id="grade" required value={grade} placeholder="EYP3, Grade 1, Year 2…"
            onChange={(e) => setGrade(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="rounded-lg border border-[var(--border)] p-4">
          <label htmlFor="consent" className="flex gap-3 text-sm">
            <input
              id="consent" type="checkbox" checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I am {firstName || 'this child'}’s parent or guardian, and I consent to their school
              reports being analysed to produce findings and a home learning plan.
            </span>
          </label>
          <p className="mt-3 text-xs text-[var(--muted)]">
            Nothing is processed without this. You can withdraw it at any time, and we will stop.
            We never screen for or name a medical or developmental condition.
          </p>
        </div>

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

        <button
          type="submit" disabled={busy || !consent}
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add child'}
        </button>
      </form>
    </main>
  );
}
