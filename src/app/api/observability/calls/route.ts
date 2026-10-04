import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { queryLlmRequestLogPage } from '../../../../server/db/llm-request-log';

export const runtime = 'nodejs';

/** Paginated raw llm_request_log rows for drill-down, ops-only. See docs/specs/07-observability-dashboard.md. */
export async function GET(request: Request) {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!user.isOps) return NextResponse.json({ error: 'Ops only' }, { status: 403 });

  const url = new URL(request.url);
  const since = url.searchParams.get('since') ?? undefined;
  const until = url.searchParams.get('until') ?? undefined;
  const stage = url.searchParams.get('stage') ?? undefined;
  const provider = url.searchParams.get('provider') ?? undefined;
  const model = url.searchParams.get('model') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
  const cursor = url.searchParams.get('cursor') ?? undefined;

  try {
    const { entries, nextCursor } = await queryLlmRequestLogPage(db, {
      since, until, stage, provider, model, status, limit, cursor,
    });
    return NextResponse.json({ entries, nextCursor });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
