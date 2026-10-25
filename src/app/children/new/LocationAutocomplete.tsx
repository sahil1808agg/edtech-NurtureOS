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
 *
 * `onChange` gets a location only once a suggestion is picked AND resolved;
 * typing, or a pick still resolving, reports null — so callers can gate
 * saving on a non-null value. Keyboard: ↑/↓ to move, Enter to pick (it never
 * submits a surrounding form), Esc to close.
 */
export function LocationAutocomplete({
  initialAddress,
  onChange,
  autoFocus = false,
}: {
  initialAddress?: string;
  onChange: (picked: PickedLocation | null) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState(initialAddress ?? '');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Set when the query changes because of a pick, so that change doesn't
  // trigger another search and reopen the list.
  const skipSearch = useRef(false);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    if (query.trim().length < 3) {
      setSuggestions([]);
      setSearched(false);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(query)}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLookupError('Couldn’t look up addresses right now — try again in a moment.');
          setSuggestions([]);
        } else {
          setLookupError(null);
          setSuggestions(body.suggestions ?? []);
        }
      } catch {
        setLookupError('Couldn’t look up addresses right now — try again in a moment.');
        setSuggestions([]);
      }
      setSearched(true);
      setHighlight(0);
      setOpen(true);
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  async function pick(s: Suggestion) {
    skipSearch.current = true;
    setQuery(s.text);
    setOpen(false);
    setResolving(true);
    setLookupError(null);
    onChange(null); // the previous pick no longer applies while this one resolves
    try {
      const res = await fetch(`/api/places/details?placeId=${encodeURIComponent(s.placeId)}`);
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.lat != null && body.lng != null) {
        onChange({ address: body.address || s.text, lat: body.lat, lng: body.lng, placeId: s.placeId });
      } else {
        setLookupError('Couldn’t find the exact spot for that address — try another suggestion.');
      }
    } catch {
      setLookupError('Couldn’t find the exact spot for that address — try another suggestion.');
    } finally {
      setResolving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && suggestions[highlight]) void pick(suggestions[highlight]);
    } else if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor="location" className="block text-sm">Location</label>
      <input
        id="location"
        value={query}
        autoFocus={autoFocus}
        placeholder="Search for an address, area, or landmark…"
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(null); // typing invalidates any previously resolved pin
        }}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls="location-suggestions"
        aria-autocomplete="list"
        className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      />
      {resolving && <p className="mt-1 text-xs text-[var(--muted)]">Finding that address…</p>}
      {lookupError && <p className="mt-1 text-xs text-red-600" role="alert">{lookupError}</p>}
      {open && searched && !lookupError && suggestions.length === 0 && (
        <p className="mt-1 text-xs text-[var(--muted)]">No matches — try a nearby landmark or the area name.</p>
      )}

      {open && suggestions.length > 0 && (
        <ul
          id="location-suggestions"
          role="listbox"
          className="absolute z-10 mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] shadow-sm"
        >
          {suggestions.map((s, i) => (
            <li key={s.placeId} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onClick={() => pick(s)}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-3 py-2 text-left text-sm ${i === highlight ? 'bg-[var(--border)]/40' : ''}`}
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
