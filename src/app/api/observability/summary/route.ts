import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { fetchLlmRequestLogRowsForSummary } from '../../../../server/db/llm-request-log';
import { summarize, bucketGranularity } from '../../../../server/observability/summarize';

export const runtime = 'nodejs';

/** Aggregated LLM usage/cost for the observability dashboard, ops-only. See docs/specs/07-observability-dashboard.md. */
export async function GET(request: Request) {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!user.isOps) return NextResponse.json({ error: 'Ops only' }, { status: 403 });

  const url = new URL(request.url);
  const since = url.searchParams.get('since') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const until = url.searchParams.get('until') ?? new Date().toISOString();
  const stage = url.searchParams.get('stage') ?? undefined;
  const provider = url.searchParams.get('provider') ?? undefined;
  const model = url.searchParams.get('model') ?? undefined;

  try {
    const entries = await fetchLlmRequestLogRowsForSummary(db, { since, until, stage, provider, model });
    const granularity = bucketGranularity(new Date(since).getTime(), new Date(until).getTime());
    return NextResponse.json(summarize(entries, granularity));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
