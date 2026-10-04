import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../lib/db/server';
import { getLlmRequestLogDetail } from '../../../../../server/db/llm-request-log';

export const runtime = 'nodejs';

/** One call's full detail, including request/response text. Ops-only. See docs/specs/07-observability-dashboard.md. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!user.isOps) return NextResponse.json({ error: 'Ops only' }, { status: 403 });

  try {
    const detail = await getLlmRequestLogDetail(db, id);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
