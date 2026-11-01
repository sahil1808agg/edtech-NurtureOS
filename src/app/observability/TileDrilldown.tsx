'use client';

import { formatDateTime, formatNumber } from './format';

// Mirrors CallRow / Drilldowns in src/server/observability/summarize.ts (as
// JSON over the wire) — local types, same convention as the dashboard.
export interface CallRow {
  id: number;
  stage: string;
  model: string;
  status: 'ok' | 'error';
  errorCode: string | null;
  latencyMs: number;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
}

export interface Drilldowns {
  recent: { calls: CallRow[]; total: number };
  errors: { calls: CallRow[]; total: number };
  costliest: { calls: CallRow[]; total: number };
  typical: { calls: CallRow[]; total: number };
  slowest: { calls: CallRow[]; total: number };
  tokenHeavy: { calls: CallRow[]; total: number };
}

export type TileKey = 'requests' | 'errors' | 'cost' | 'p50' | 'p95' | 'tokens';

const TILE_INFO: Record<TileKey, { list: keyof Drilldowns; title: string; explain: (ctx: Ctx) => string; empty: string }> = {
  requests: {
    list: 'recent',
    title: 'Most recent calls',
    explain: () => 'Every call in this range, newest first.',
    empty: 'No calls in this range.',
  },
  errors: {
    list: 'errors',
    title: 'Failed calls',
    explain: () => 'Calls that returned an error, newest first. Open one to see the error message.',
    empty: 'No failed calls in this range.',
  },
  cost: {
    list: 'costliest',
    title: 'Most expensive calls',
    explain: ({ unpriced }) =>
      `Priced calls, most expensive first.${unpriced > 0 ? ` ${unpriced} successful call${unpriced === 1 ? '' : 's'} used a model with no rate in pricing.ts, so they aren’t in the cost or this list.` : ''}`,
    empty: 'No priced calls in this range.',
  },
  p50: {
    list: 'typical',
    title: 'Typical calls (around p50)',
    explain: ({ p50 }) => `The calls closest to the median latency of ${formatNumber(p50)} ms — half of all calls were faster than this, half slower.`,
    empty: 'No calls in this range.',
  },
  p95: {
    list: 'slowest',
    title: 'Slowest calls (at or above p95)',
    explain: ({ p95 }) => `Calls that took ${formatNumber(p95)} ms or longer — the slowest 5%. Slowest first.`,
    empty: 'No calls in this range.',
  },
  tokens: {
    list: 'tokenHeavy',
    title: 'Calls using the most tokens',
    explain: () => 'Input + output tokens, largest first. Big inputs are usually long prompts, chat history, or report data.',
    empty: 'No calls with token counts in this range.',
  },
};

interface Ctx {
  p50: number;
  p95: number;
  unpriced: number;
}

/** Which column a tile's list is about — shown first and emphasised. */
const FOCUS: Record<TileKey, 'latency' | 'cost' | 'tokens' | 'status' | 'time'> = {
  requests: 'time',
  errors: 'status',
  cost: 'cost',
  p50: 'latency',
  p95: 'latency',
  tokens: 'tokens',
};

export function TileDrilldown({
  tile,
  drilldowns,
  ctx,
  onSelectCall,
  onClose,
}: {
  tile: TileKey;
  drilldowns: Drilldowns;
  ctx: Ctx;
  onSelectCall: (id: number) => void;
  onClose: () => void;
}) {
  const info = TILE_INFO[tile];
  const { calls, total } = drilldowns[info.list];
  const focus = FOCUS[tile];

  return (
    <section id="tile-drilldown" className="mt-4 rounded-lg border border-[var(--accent)]/50 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">
          {info.title}
          {total > 0 && <span className="ml-2 font-normal text-[var(--muted)]">{formatNumber(total)} call{total === 1 ? '' : 's'}</span>}
        </h2>
        <button type="button" onClick={onClose} className="text-xs text-[var(--muted)] hover:underline">Close</button>
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">{info.explain(ctx)}</p>

      {calls.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--muted)]">{info.empty}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="pb-2 pr-4 font-medium">Stage</th>
                <th className="pb-2 pr-4 font-medium">Model</th>
                <th className={`pb-2 pr-4 font-medium ${focus === 'latency' ? 'text-[var(--foreground)]' : ''}`}>Latency</th>
                <th className={`pb-2 pr-4 font-medium ${focus === 'cost' ? 'text-[var(--foreground)]' : ''}`}>Cost</th>
                <th className={`pb-2 pr-4 font-medium ${focus === 'tokens' ? 'text-[var(--foreground)]' : ''}`}>Tokens (in/out)</th>
                <th className={`pb-2 pr-4 font-medium ${focus === 'status' ? 'text-[var(--foreground)]' : ''}`}>Status</th>
                <th className={`pb-2 pr-4 font-medium ${focus === 'time' ? 'text-[var(--foreground)]' : ''}`}>Time</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => onSelectCall(c.id)}
                  className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--border)]/30"
                >
                  <td className="py-2 pr-4 font-medium">
                    <button type="button" onClick={(e) => { e.stopPropagation(); onSelectCall(c.id); }} className="hover:underline">
                      {c.stage}
                    </button>
                  </td>
                  <td className="py-2 pr-4 text-[var(--muted)]">{c.model}</td>
                  <td className={`py-2 pr-4 ${focus === 'latency' ? 'font-semibold' : ''}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatNumber(c.latencyMs)} ms
                    {tile !== 'p95' && c.latencyMs >= ctx.p95 && <span className="ml-1.5 rounded bg-[var(--border)] px-1 text-[10px]">≥ p95</span>}
                  </td>
                  <td className={`py-2 pr-4 ${focus === 'cost' ? 'font-semibold' : ''}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {c.costUsd == null ? <span className="text-[var(--muted)]">—</span> : `$${c.costUsd.toFixed(5)}`}
                  </td>
                  <td className={`py-2 pr-4 ${focus === 'tokens' ? 'font-semibold' : ''}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {c.inputTokens == null && c.outputTokens == null
                      ? <span className="text-[var(--muted)]">—</span>
                      : `${formatNumber(c.inputTokens ?? 0)} / ${formatNumber(c.outputTokens ?? 0)}`}
                  </td>
                  <td className={`py-2 pr-4 ${focus === 'status' ? 'font-semibold' : ''}`}>
                    {c.status === 'ok' ? 'ok' : <span className="text-red-600">{c.errorCode ?? 'error'}</span>}
                  </td>
                  <td className="py-2 pr-4 text-[var(--muted)]">{formatDateTime(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > calls.length && (
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Showing the top {calls.length} of {formatNumber(total)}. Narrow the range or stage filter to see others.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
