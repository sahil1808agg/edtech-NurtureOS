'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocationAutocomplete, type PickedLocation } from '../new/LocationAutocomplete';

/**
 * Add, change or remove a child's location (it gates "local" plan
 * activities — resolve-local-activities.ts falls back to home activities
 * when there's no address on file).
 *
 * Saving needs an address picked from the suggestions, because the plan
 * needs its coordinates, not just text. Save stays disabled until one is
 * picked and resolved: it used to be clickable with only typed text, and
 * then sent "no location" — wiping the saved address while appearing to
 * save. Clearing the location is its own explicit button instead.
 */
export function EditLocation({ childId, address }: { childId: string; address: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function send(body: Record<string, unknown>, doneMessage: string) {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/children/${childId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Could not save (${res.status})`);
      return;
    }

    setEditing(false);
    setLocation(null);
    setSaved(doneMessage);
    router.refresh();
  }

  function save() {
    if (!location) return;
    void send(
      { address: location.address, lat: location.lat, lng: location.lng, placeId: location.placeId },
      'Location saved.',
    );
  }

  function remove() {
    void send({ address: null, lat: null, lng: null, placeId: null }, 'Location removed.');
  }

  if (!editing) {
    return (
      <div className="mt-1 text-sm">
        <p>{address ?? <span className="text-[var(--muted)]">No location yet — nearby suggestions are off until one is added.</span>}</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => { setSaved(null); setError(null); setEditing(true); }}
            className="text-sm underline"
          >
            {address ? 'Change location' : 'Add location'}
          </button>
          {saved && <span className="text-xs text-[var(--muted)]" role="status">{saved}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 max-w-md rounded-lg border border-[var(--border)] p-4">
      {address && <p className="mb-3 text-xs text-[var(--muted)]">Currently: {address}</p>}
      <LocationAutocomplete onChange={setLocation} autoFocus />

      {location ? (
        <p className="mt-2 text-xs text-[var(--muted)]">Will save: {location.address}</p>
      ) : (
        <p className="mt-2 text-xs text-[var(--muted)]">Type an address, area or landmark, then pick it from the list.</p>
      )}

      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !location}
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save location'}
        </button>
        <button type="button" onClick={() => { setEditing(false); setLocation(null); }} disabled={busy} className="text-sm underline">
          Cancel
        </button>
        {address && (
          <button type="button" onClick={remove} disabled={busy} className="ml-auto text-sm text-red-600 underline disabled:opacity-50">
            Remove location
          </button>
        )}
      </div>
    </div>
  );
}
