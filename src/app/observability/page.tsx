import { redirect } from 'next/navigation';
import { routeClient, currentUser } from '../../lib/db/server';
import { fetchLlmRequestLogRowsForSummary, queryLlmRequestLogPage } from '../../server/db/llm-request-log';
import { summarize, bucketGranularity } from '../../server/observability/summarize';
import { ObservabilityDashboard } from './ObservabilityDashboard';

export const dynamic = 'force-dynamic';

const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;

/** LLM usage/cost dashboard, ops-only. See docs/specs/07-observability-dashboard.md. */
export default async function ObservabilityPage() {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');
  if (!user.isOps) redirect('/');

  const until = new Date();
  const since = new Date(until.getTime() - DEFAULT_RANGE_MS);
  const filters = { since: since.toISOString(), until: until.toISOString() };

  const [entries, callsPage] = await Promise.all([
    fetchLlmRequestLogRowsForSummary(db, filters),
    queryLlmRequestLogPage(db, { ...filters, limit: 50 }),
  ]);
  const summary = summarize(entries, bucketGranularity(since.getTime(), until.getTime()));

  return (
    <ObservabilityDashboard
      initialSummary={summary}
      initialCalls={callsPage}
      initialFilters={{ since: filters.since, until: filters.until, rangePreset: '24h' }}
    />
  );
}
