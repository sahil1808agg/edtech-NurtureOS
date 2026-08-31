import { NextResponse } from 'next/server';
import { routeClient } from '../../../../lib/db/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const db = await routeClient();
  await db.auth.signOut();
  return NextResponse.redirect(new URL('/signin', request.url), { status: 303 });
}
