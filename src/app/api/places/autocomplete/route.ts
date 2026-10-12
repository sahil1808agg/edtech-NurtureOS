import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../lib/db/server';

export const runtime = 'nodejs';

/**
 * Proxies Places Autocomplete (New) so the API key stays server-side.
 * Requires a signed-in user — this is billed per request, and an open
 * proxy would let anyone run up the project's Places quota.
 */
export async function GET(request: Request) {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const input = new URL(request.url).searchParams.get('input')?.trim() ?? '';
  if (input.length < 3) return NextResponse.json({ suggestions: [] });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Location lookup is not configured' }, { status: 503 });

  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
    body: JSON.stringify({ input }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return NextResponse.json({ error: `Places API error ${res.status}: ${body.slice(0, 300)}` }, { status: 502 });
  }

  const data = (await res.json()) as {
    suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string } } }[];
  };

  const suggestions = (data.suggestions ?? [])
    .map((s) => ({ placeId: s.placePrediction?.placeId, text: s.placePrediction?.text?.text }))
    .filter((s): s is { placeId: string; text: string } => !!s.placeId && !!s.text);

  return NextResponse.json({ suggestions });
}
