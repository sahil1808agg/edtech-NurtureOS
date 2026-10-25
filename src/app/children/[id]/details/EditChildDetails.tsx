'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export const BOARD_LABEL: Record<string, string> = {
  IB: 'IB',
  CBSE: 'CBSE',
  CAIE: 'Cambridge (CAIE)',
  CISCE: 'ICSE / ISC (CISCE)',
  STATE: 'State board',
};

export interface ChildDetails {
  id: string;
  firstName: string;
  /** YYYY-MM-DD */
  dob: string;
  grade: string;
  board: string | null;
}

const inputClass = 'mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm';

/**
 * The Child details tab's "About" card: read view with an Edit button that
 * swaps in a form for name, date of birth, grade and board. Saves through
 * PATCH /api/children/[id], sending only the fields that changed. Location
 * has its own control (EditLocation) because it needs the address picker.
 */
export function EditChildDetails({ child }: { child: ChildDetails }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(child.firstName);
  const [dob, setDob] = useState(child.dob);
  const [grade, setGrade] = useState(child.grade);
  const [board, setBoard] = useState(child.board ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function startEditing() {
    setFirstName(child.firstName);
    setDob(child.dob);
    setGrade(child.grade);
    setBoard(child.board ?? '');
    setError(null);
    setSaved(false);
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const changes: Record<string, unknown> = {};
    if (firstName.trim() !== child.firstName) changes.firstName = firstName.trim();
    if (dob !== child.dob) changes.dob = dob;
    if (grade.trim() !== child.grade) changes.grade = grade.trim();
    if ((board || null) !== child.board) changes.board = board || null;

    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }

    setBusy(true);
    setError(null);
    const res = await fetch(`/api/children/${child.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? `Could not save (${res.status})`);
      return;
    }

    setEditing(false);
    setSaved(true);
    router.refresh();
  }

  const dobLabel = new Date(`${child.dob}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });

  if (!editing) {
    const rows: Array<[string, string]> = [
      ['Name', child.firstName],
      ['Date of birth', dobLabel],
      ['Class or grade', child.grade],
      ['School board', child.board ? BOARD_LABEL[child.board] ?? child.board : 'Not set'],
    ];
    return (
      <div className="mt-3">
        <dl className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-sm text-[var(--muted)]">{label}</dt>
              <dd className="text-right text-sm">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={startEditing} className="text-sm underline">Edit details</button>
          {saved && <span className="text-xs text-[var(--muted)]" role="status">Saved.</span>}
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form onSubmit={save} className="mt-3 space-y-4 rounded-lg border border-[var(--border)] p-4">
      <div>
        <label htmlFor="edit-name" className="block text-sm">First name</label>
        <input id="edit-name" required maxLength={100} value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
      </div>

      <div>
        <label htmlFor="edit-dob" className="block text-sm">Date of birth</label>
        <input id="edit-dob" type="date" required max={today} value={dob} onChange={(e) => setDob(e.target.value)} className={inputClass} />
      </div>

      <div>
        <label htmlFor="edit-grade" className="block text-sm">Class or grade</label>
        <input
          id="edit-grade" required maxLength={50} value={grade} placeholder="EYP3, Grade 1, Year 2…"
          onChange={(e) => setGrade(e.target.value)} className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="edit-board" className="block text-sm">School board</label>
        <select id="edit-board" value={board} onChange={(e) => setBoard(e.target.value)} className={inputClass}>
          <option value="">Not set</option>
          {Object.entries(BOARD_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit" disabled={busy}
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy} className="text-sm underline disabled:opacity-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
