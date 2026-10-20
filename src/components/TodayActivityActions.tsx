'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Tomorrow as YYYY-MM-DD in UTC — matches snoozed_until (a plain date column, no timezone concept anywhere in this schema). */
function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type Action = 'done' | 'snooze' | 'remove';

/**
 * Done / Not today / Remove for a single plan activity — used on the child
 * page's Today card, the plan detail page, and the chat page's Today panel.
 * Removing is the only one with a side effect beyond the activity itself: it
 * also asks for a new plan cycle (the same POST RequestPlan.tsx makes),
 * since a removed activity leaves its finding uncovered. A 409 there just
 * means a regeneration is already in flight, not a failure.
 */
export function TodayActivityActions({ activityId, childId }: { activityId: string; childId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removedNote, setRemovedNote] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/plan-activities/${activityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Could not save (${res.status})`);
    }
  }

  async function markDone() {
    setBusy('done');
    setError(null);
    try {
      await patch({ completed: true });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  }

  async function notToday() {
    setBusy('snooze');
    setError(null);
    try {
      await patch({ snoozedUntil: tomorrow() });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('remove');
    setError(null);
    try {
      await patch({ declined: true });

      const res = await fetch(`/api/children/${childId}/plan`, { method: 'POST' });
      if (res.ok) {
        setRemovedNote('Removed — updating the plan.');
      } else if (res.status === 409) {
        setRemovedNote('Removed — already updating your plan.');
      } else {
        const data = await res.json().catch(() => ({}));
        setRemovedNote(`Removed. ${data.error ?? ''}`.trim());
      }
      // No router.refresh() here, deliberately: this card already shows the
      // terminal "removed" state locally — refreshing would re-fetch the
      // server list, which now excludes this activity, and swap the note
      // out before the parent ever gets to read it. The next natural
      // navigation picks up the real state regardless.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  }

  if (removedNote) {
    return <p className="mt-3 text-xs text-[var(--muted)]">{removedNote}</p>;
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={markDone} disabled={busy !== null} className="text-xs font-medium underline disabled:opacity-50">
          {busy === 'done' ? 'Saving…' : 'Done'}
        </button>
        <button type="button" onClick={notToday} disabled={busy !== null} className="text-xs underline disabled:opacity-50">
          {busy === 'snooze' ? 'Saving…' : 'Not today'}
        </button>
        <button type="button" onClick={remove} disabled={busy !== null} className="text-xs text-red-600 underline disabled:opacity-50">
          {busy === 'remove' ? 'Removing…' : 'Remove'}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}
