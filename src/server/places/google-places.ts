/**
 * Live lookup only — results are not persisted. This is a per-request
 * answer, not a resource the family can revisit later via a saved id,
 * unlike the curated `resources` catalog (db/plans.ts getResourceCandidates).
 * If a parent wanting to come back to a suggested place turns out to
 * matter, caching becomes a later decision. See
 * docs/specs/08-orchestrator-chat.md.
 */
export interface NearbyPlace {
  name: string;
  address: string;
  rating: number | null;
  googleMapsUrl: string;
}

const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const MAX_RESULTS = 5;

interface PlacesApiPlace {
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  googleMapsUri?: string;
}

/**
 * @throws if GOOGLE_PLACES_API_KEY is unset, or the Places API call fails.
 * Callers (src/server/chat/dispatch.ts findNearbyResources) must catch this
 * — a Places error must not fail the whole chat turn.
 */
export async function searchNearbyPlaces(query: string, city: string | null, pincode: string | null): Promise<NearbyPlace[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is not set');

  const location = [city, pincode].filter(Boolean).join(' ');
  if (!location) throw new Error('no city/pincode on file to search near');

  const res = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.googleMapsUri',
    },
    body: JSON.stringify({
      textQuery: `${query} near ${location}`,
      maxResultCount: MAX_RESULTS,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Places API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as { places?: PlacesApiPlace[] };
  return (data.places ?? []).slice(0, MAX_RESULTS).map(p => ({
    name: p.displayName?.text ?? 'Unknown',
    address: p.formattedAddress ?? '',
    rating: p.rating ?? null,
    googleMapsUrl: p.googleMapsUri ?? '',
  }));
}
