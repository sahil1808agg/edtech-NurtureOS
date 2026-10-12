'use client';

import { useEffect, useRef, useState } from 'react';

export interface PickedLocation {
  address: string;
  lat: number;
  lng: number;
  placeId: string;
}

interface Suggestion {
  placeId: string;
  text: string;
}

/**
 * Address autocomplete backed by our own /api/places proxy (the Google
 * Places key stays server-side). Free text alone isn't enough here — we
 * need the resolved lat/lng from Place Details so nearby-resource search
 * can bias around a precise point instead of a city-level guess.
 */
export function LocationAutocomplete({
  initialAddress,
  onChange,
}: {
  initialAddress?: string;
  onChange: (picked: PickedLocation | null) => void;
}) {
  const [query, setQuery] = useState(initialAddress ?? '');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(query)}`);
      const body = await res.json().catch(() => ({}));
      setSuggestions(res.ok ? body.suggestions ?? [] : []);
      setOpen(true);
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  async function pick(s: Suggestion) {
    setQuery(s.text);
    setOpen(false);
    setResolving(true);
    try {
      const res = await fetch(`/api/places/details?placeId=${encodeURIComponent(s.placeId)}`);
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.lat != null && body.lng != null) {
        onChange({ address: body.address || s.text, lat: body.lat, lng: body.lng, placeId: s.placeId });
      } else {
        onChange(null);
      }
    } finally {
      setResolving(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor="location" className="block text-sm">Location</label>
      <input
        id="location"
        value={query}
        placeholder="Search for an address, area, or landmark…"
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(null); // typing invalidates any previously resolved pin
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        autoComplete="off"
        className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      />
      {resolving && <p className="mt-1 text-xs text-[var(--muted)]">Resolving…</p>}

      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] shadow-sm">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                onClick={() => pick(s)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--border)]/30"
              >
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
