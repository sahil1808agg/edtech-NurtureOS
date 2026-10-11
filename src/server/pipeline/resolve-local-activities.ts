import { searchNearbyPlaces } from '../places/google-places.js';
import type { PlanActivity } from './plan.js';

export interface LocationInput {
  lat: number | null;
  lng: number | null;
  city: string | null;
  pincode: string | null;
}

/**
 * The model only picks a search phrase for a "local" activity (see
 * prompts/plan.ts) — it never invents a real place, address, or URL. This
 * resolves each one against the same Google Places lookup the chat tool
 * uses (find_nearby_resources) and folds the real result into the
 * instructions. Mirrors the fallback rule already documented for that tool
 * in chat-planning-agent.md: no location, no match, or a Places error all
 * fall back to a plain home activity rather than leaving a dangling search
 * phrase or a broken promise in front of the parent.
 */
export async function resolveLocalActivities(
  activities: PlanActivity[],
  location: LocationInput,
): Promise<PlanActivity[]> {
  const geo = location.lat != null && location.lng != null ? { lat: location.lat, lng: location.lng } : null;
  const cityPincode = [location.city, location.pincode].filter(Boolean).join(' ') || null;

  return Promise.all(
    activities.map(async (activity) => {
      if (activity.kind !== 'local' || !activity.localQuery) return activity;

      if (!geo && !cityPincode) {
        return { ...activity, kind: 'home' as const, localQuery: null };
      }

      try {
        const places = (await searchNearbyPlaces(activity.localQuery, geo, cityPincode)).slice(0, 3);
        if (places.length === 0) return { ...activity, kind: 'home' as const, localQuery: null };

        const lines = places.map(place => {
          const details = [
            place.rating ? `${place.rating}★` : null,
            place.distanceKm != null ? `${place.distanceKm.toFixed(1)} km` : null,
            place.address,
            place.googleMapsUrl,
          ]
            .filter(Boolean)
            .join(' — ');
          return `- ${place.name} — ${details}`;
        });
        return { ...activity, instructions: `${activity.instructions}\n\nTry one of these nearby:\n${lines.join('\n')}`, localQuery: null };
      } catch {
        return { ...activity, kind: 'home' as const, localQuery: null };
      }
    }),
  );
}
