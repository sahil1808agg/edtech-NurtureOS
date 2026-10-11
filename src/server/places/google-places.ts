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
  /** Straight-line distance from `geo`, in km. Null when the search had no geo point (cityPincode only) to measure from. */
  distanceKm: number | null;
}

const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const MAX_RESULTS = 5;

interface PlacesApiPlace {
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  googleMapsUri?: string;
  location?: { latitude?: number; longitude?: number };
}

const NEARBY_RADIUS_METERS = 7500;
const EARTH_RADIUS_KM = 6371;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinDLng * sinDLng;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * @throws if GOOGLE_PLACES_API_KEY is unset, or the Places API call fails.
 * Callers (src/server/chat/dispatch.ts findNearbyResources) must catch this
 * — a Places error must not fail the whole chat turn.
 *
 * `geo`, when set, biases the search to a circle around that point — the
 * precise pin the parent dropped via autocomplete. `cityPincode` is the
 * legacy text fallback for children added before that existed, folded into
 * the query string instead since there's no point to bias around.
 */
export async function searchNearbyPlaces(
  query: string,
  geo: { lat: number; lng: number } | null,
  cityPincode: string | null,
): Promise<NearbyPlace[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is not set');

  if (!geo && !cityPincode) throw new Error('no location on file to search near');

  const res = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.googleMapsUri,places.location',
    },
    body: JSON.stringify({
      textQuery: geo ? query : `${query} near ${cityPincode}`,
      maxResultCount: MAX_RESULTS,
      ...(geo && {
        locationBias: {
          circle: { center: { latitude: geo.lat, longitude: geo.lng }, radius: NEARBY_RADIUS_METERS },
        },
      }),
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
    distanceKm:
      geo && p.location?.latitude != null && p.location?.longitude != null
        ? haversineKm(geo, { lat: p.location.latitude, lng: p.location.longitude })
        : null,
  }));
}
