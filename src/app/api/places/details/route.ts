import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../lib/db/server';

export const runtime = 'nodejs';

/** Resolves a placeId from the autocomplete proxy to a formatted address + lat/lng. */
export async function GET(request: Request) {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const placeId = new URL(request.url).searchParams.get('placeId')?.trim() ?? '';
  if (!placeId) return NextResponse.json({ error: 'placeId is required' }, { status: 400 });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Location lookup is not configured' }, { status: 503 });

  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'formattedAddress,location' },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return NextResponse.json({ error: `Places API error ${res.status}: ${body.slice(0, 300)}` }, { status: 502 });
  }

  const data = (await res.json()) as { formattedAddress?: string; location?: { latitude?: number; longitude?: number } };
  if (!data.location) return NextResponse.json({ error: 'No coordinates for that place' }, { status: 502 });

  return NextResponse.json({
    address: data.formattedAddress ?? '',
    lat: data.location.latitude ?? null,
    lng: data.location.longitude ?? null,
  });
}
