'use client';

import { useCallback, useState } from 'react';
import { UsageCharts } from './UsageCharts';
import { CallDetailModal } from './CallDetailModal';

// Mirrors src/server/observability/summarize.ts and src/server/db/llm-request-log.ts
// shapes (as JSON over the wire) — kept as local types rather than importing the
// server modules, which pull in the service-role client and must never run in
// the browser. Same convention as ChatThread.tsx.
interface SummaryTotals {
  requests: number;
  errorRate: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}
interface StageBreakdown {
  stage: string;
  requests: number;
  costUsd: number;
  avgLatencyMs: number;
  errorRate: number;
}
export interface TimeseriesBucket {
  bucket: string;
  requests: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}
interface ObservabilitySummary {
  totals: SummaryTotals;
  byStage: StageBreakdown[];
  timeseries: TimeseriesBucket[];
}
interface LlmRequestLogEntry {
  id: number;
  stage: string;
  provider: string;
  model: string;
  status: 'ok' | 'error';
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  createdAt: string;
}
interface CallsPage {
  entries: LlmRequestLogEntry[];
  nextCursor: string | null;
}

type RangePreset = '24h' | '7d' | '30d';

interface Filters {
  since: string;
  until: string;
  rangePreset: RangePreset;
  stage?: string;
  provider?: string;
}

// Mirrors PromptKey (src/server/prompts/version.ts) — hardcoded rather than
// imported so the filter list doesn't depend on what happens to be in the
// current window (a stage with zero calls should still be selectable).
const STAGES = [
  'extract', 'normalise', 'analyse', 'corroborate', 'plan', 'checkin',
  'chat_orchestrator', 'chat_report_agent', 'chat_planning_agent', 'chat_generic_agent',
] as const;

const RANGE_MS: Record<RangePreset, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function rangeFromPreset(preset: RangePreset): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - RANGE_MS[preset]);
  return { since: since.toISOString(), until: until.toISOString() };
}

function buildParams(filters: Filters, extra?: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams({ since: filters.since, until: filters.until, ...extra });
  if (filters.stage) params.set('stage', filters.stage);
  if (filters.provider) params.set('provider', filters.provider);
  return params;
}

export function ObservabilityDashboard({
  initialSummary,
  initialCalls,
  initialFilters,
}: {
  initialSummary: ObservabilitySummary;
  initialCalls: CallsPage;
  initialFilters: Filters;
}) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [summary, setSummary] = useState<ObservabilitySummary>(initialSummary);
  const [calls, setCalls] = useState<LlmRequestLogEntry[]>(initialCalls.entries);
  const [cursor, setCursor] = useState<string | null>(initialCalls.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);

  const refresh = useCallback(async (next: Filters) => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, callsRes] = await Promise.all([
        fetch(`/api/observability/summary?${buildParams(next)}`),
        fetch(`/api/observability/calls?${buildParams(next, { limit: '50' })}`),
      ]);
      if (!summaryRes.ok || !callsRes.ok) throw new Error('Failed to load observability data');

      setSummary(await summaryRes.json());
      const callsJson: CallsPage = await callsRes.json();
      setCalls(callsJson.entries);
      setCursor(callsJson.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setLoading(false);
    }
  }, []);

  function updateFilters(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    refresh(next);
  }

  async function loadMoreCalls() {
    if (!cursor) return;
    const res = await fetch(`/api/observability/calls?${buildParams(filters, { limit: '50', cursor })}`);
    if (!res.ok) return;
    const json: CallsPage = await res.json();
    setCalls(prev => [...prev, ...json.entries]);
    setCursor(json.nextCursor);
  }

  const providers = [...new Set(calls.map(c => c.provider))];

  return (
    <main>
      <h1 className="text-xl font-semibold tracking-tight">Observability</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Every model call — requests, latency, tokens, cost — across every stage.
        For spotting what&apos;s worth optimizing, not parent-facing.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(['24h', '7d', '30d'] as RangePreset[]).map(preset => (
          <button
            key={preset}
            onClick={() => updateFilters({ ...rangeFromPreset(preset), rangePreset: preset })}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              filters.rangePreset === preset
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]'
            }`}
          >
            {preset}
          </button>
        ))}

        <select
          value={filters.stage ?? ''}
          onChange={e => updateFilters({ stage: e.target.value || undefined })}
          className="rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs"
        >
          <option value="">All stages</option>
          {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={filters.provider ?? ''}
          onChange={e => updateFilters({ provider: e.target.value || undefined })}
          className="rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs"
        >
          <option value="">All providers</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <button
          onClick={() => refresh(filters)}
          disabled={loading}
          className="ml-auto rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] hover:border-[var(--accent)] disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Requests" value={summary.totals.requests.toLocaleString()} />
        <StatTile label="Error rate" value={`${(summary.totals.errorRate * 100).toFixed(1)}%`} />
        <StatTile label="Cost" value={`$${summary.totals.costUsd.toFixed(2)}`} />
        <StatTile label="p50 latency" value={`${summary.totals.p50LatencyMs.toLocaleString()} ms`} />
        <StatTile label="p95 latency" value={`${summary.totals.p95LatencyMs.toLocaleString()} ms`} />
        <StatTile
          label="Tokens (in/out)"
          value={`${summary.totals.inputTokens.toLocaleString()} / ${summary.totals.outputTokens.toLocaleString()}`}
        />
      </div>

      <UsageCharts timeseries={summary.timeseries} />

      <h2 className="mt-10 text-sm font-semibold">By stage</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--muted)]">
            <tr>
              <th className="pb-2 pr-4 font-medium">Stage</th>
              <th className="pb-2 pr-4 font-medium">Requests</th>
              <th className="pb-2 pr-4 font-medium">Cost</th>
              <th className="pb-2 pr-4 font-medium">Avg latency</th>
              <th className="pb-2 pr-4 font-medium">Error rate</th>
            </tr>
          </thead>
          <tbody>
            {summary.byStage.map(row => (
              <tr key={row.stage} className="border-t border-[var(--border)]">
                <td className="py-2 pr-4 font-medium">{row.stage}</td>
                <td className="py-2 pr-4">{row.requests.toLocaleString()}</td>
                <td className="py-2 pr-4">${row.costUsd.toFixed(4)}</td>
                <td className="py-2 pr-4">{row.avgLatencyMs.toLocaleString()} ms</td>
                <td className="py-2 pr-4">{(row.errorRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
            {summary.byStage.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-[var(--muted)]">No calls in this range.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-sm font-semibold">Recent calls</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">Click a row to see the full request/response.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--muted)]">
            <tr>
              <th className="pb-2 pr-4 font-medium">Time</th>
              <th className="pb-2 pr-4 font-medium">Stage</th>
              <th className="pb-2 pr-4 font-medium">Model</th>
              <th className="pb-2 pr-4 font-medium">Tokens</th>
              <th className="pb-2 pr-4 font-medium">Cost</th>
              <th className="pb-2 pr-4 font-medium">Latency</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {calls.map(c => (
              <tr
                key={c.id}
                onClick={() => setSelectedCallId(c.id)}
                className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--border)]/40"
              >
                <td className="py-2 pr-4 text-[var(--muted)]">{new Date(c.createdAt).toLocaleString()}</td>
                <td className="py-2 pr-4">{c.stage}</td>
                <td className="py-2 pr-4">{c.provider}/{c.model}</td>
                <td className="py-2 pr-4">{c.inputTokens ?? '—'} / {c.outputTokens ?? '—'}</td>
                <td className="py-2 pr-4">{c.costUsd === null ? '—' : `$${c.costUsd.toFixed(5)}`}</td>
                <td className="py-2 pr-4">{c.latencyMs.toLocaleString()} ms</td>
                <td className="py-2 pr-4">
                  {c.status === 'ok'
                    ? <span className="text-[var(--accent)]">ok</span>
                    : <span className="text-red-600">{c.errorCode ?? 'error'}</span>}
                </td>
              </tr>
            ))}
            {calls.length === 0 && (
              <tr><td colSpan={7} className="py-4 text-[var(--muted)]">No calls in this range.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {cursor && (
        <button
          onClick={loadMoreCalls}
          className="mt-4 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] hover:border-[var(--accent)]"
        >
          Load more
        </button>
      )}

      {selectedCallId !== null && (
        <CallDetailModal callId={selectedCallId} onClose={() => setSelectedCallId(null)} />
      )}
    </main>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
    </div>
  );
}
