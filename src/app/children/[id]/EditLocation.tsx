'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocationAutocomplete, type PickedLocation } from '../new/LocationAutocomplete';

/**
 * Location can only be set at /children/new today — there's no way to add it
 * to an existing child, so anyone who skipped it (or was added before this
 * feature existed) is stuck without "local" plan activities forever, with no
 * indication why (resolve-local-activities.ts silently falls back to home
 * activities when there's no address on file). This is that missing edit path.
 */
export function EditLocation({ childId, address }: { childId: string; address: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/children/${childId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: location?.address ?? null,
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        placeId: location?.placeId ?? null,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Could not save (${res.status})`);
      setBusy(false);
      return;
    }

    setBusy(false);
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <p className="mt-1 text-xs text-[var(--muted)]">
        {address ?? 'No location on file — nearby activity suggestions are off until one is added.'}{' '}
        <button type="button" onClick={() => setEditing(true)} className="underline">
          {address ? 'Change' : 'Add location'}
        </button>
      </p>
    );
  }

  return (
    <div className="mt-2 max-w-sm">
      <LocationAutocomplete initialAddress={address ?? undefined} onChange={setLocation} />
      {error && <p className="mt-1.5 text-xs text-red-600" role="alert">{error}</p>}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy} className="text-xs underline">
          Cancel
        </button>
      </div>
    </div>
  );
}
