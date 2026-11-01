import type { LlmRequestLogEntry } from '../db/llm-request-log.js';

export interface SummaryTotals {
  requests: number;
  errorRate: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /**
   * Successful calls with no cost_usd — the model isn't in llm/pricing.ts,
   * so costUsd above leaves them out. Shown alongside the cost so a total
   * that only covers some calls never reads as the whole spend.
   */
  unpricedRequests: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export interface StageBreakdown {
  stage: string;
  requests: number;
  costUsd: number;
  unpricedRequests: number;
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

/** One call, trimmed to what a drill-down list row shows. */
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

/**
 * The calls behind each stat tile, so clicking a number shows which calls
 * produced it. Each list is capped (DRILLDOWN_LIMIT) to keep the payload
 * small; `total` says how many calls the full list would have.
 */
export interface Drilldowns {
  recent: { calls: CallRow[]; total: number };
  errors: { calls: CallRow[]; total: number };
  costliest: { calls: CallRow[]; total: number };
  /** The calls nearest the median latency — what a typical call looks like. */
  typical: { calls: CallRow[]; total: number };
  /** Every call at or above p95, slowest first. */
  slowest: { calls: CallRow[]; total: number };
  tokenHeavy: { calls: CallRow[]; total: number };
}

export interface ObservabilitySummary {
  totals: SummaryTotals;
  byStage: StageBreakdown[];
  timeseries: TimeseriesBucket[];
  drilldowns: Drilldowns;
}

export const DRILLDOWN_LIMIT = 25;

function toCallRow(e: LlmRequestLogEntry): CallRow {
  return {
    id: e.id,
    stage: e.stage,
    model: e.model,
    status: e.status,
    errorCode: e.errorCode,
    latencyMs: e.latencyMs,
    costUsd: e.costUsd,
    inputTokens: e.inputTokens,
    outputTokens: e.outputTokens,
    createdAt: e.createdAt,
  };
}

function capped(list: LlmRequestLogEntry[]): { calls: CallRow[]; total: number } {
  return { calls: list.slice(0, DRILLDOWN_LIMIT).map(toCallRow), total: list.length };
}

function buildDrilldowns(entries: LlmRequestLogEntry[], p50: number, p95: number): Drilldowns {
  const newestFirst = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const tokens = (e: LlmRequestLogEntry) => (e.inputTokens ?? 0) + (e.outputTokens ?? 0);

  return {
    recent: capped(newestFirst),
    errors: capped(newestFirst.filter(e => e.status === 'error')),
    costliest: capped(entries.filter(e => (e.costUsd ?? 0) > 0).sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0))),
    typical: capped([...entries].sort((a, b) => Math.abs(a.latencyMs - p50) - Math.abs(b.latencyMs - p50)).slice(0, 10)),
    slowest: capped(entries.filter(e => e.latencyMs >= p95).sort((a, b) => b.latencyMs - a.latencyMs)),
    tokenHeavy: capped(entries.filter(e => tokens(e) > 0).sort((a, b) => tokens(b) - tokens(a))),
  };
}

export type BucketGranularity = 'hour' | 'day';

/** Hourly under 48h, daily otherwise — keeps the timeseries a sane length regardless of range. */
export function bucketGranularity(sinceMs: number, untilMs: number): BucketGranularity {
  return untilMs - sinceMs <= 48 * 60 * 60 * 1000 ? 'hour' : 'day';
}

/** A successful call with no cost — unpriced model. Failed calls have no tokens, so no cost is expected. */
function isUnpriced(e: LlmRequestLogEntry): boolean {
  return e.status !== 'error' && e.costUsd == null;
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

function bucketKey(createdAt: string, granularity: BucketGranularity): string {
  const d = new Date(createdAt);
  if (granularity === 'hour') d.setUTCMinutes(0, 0, 0);
  else d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function summarize(entries: LlmRequestLogEntry[], granularity: BucketGranularity): ObservabilitySummary {
  const requests = entries.length;
  const errors = entries.filter(e => e.status === 'error').length;
  const latenciesAsc = entries.map(e => e.latencyMs).sort((a, b) => a - b);

  const totals: SummaryTotals = {
    requests,
    errorRate: requests ? errors / requests : 0,
    inputTokens: sum(entries.map(e => e.inputTokens ?? 0)),
    outputTokens: sum(entries.map(e => e.outputTokens ?? 0)),
    costUsd: sum(entries.map(e => e.costUsd ?? 0)),
    unpricedRequests: entries.filter(isUnpriced).length,
    p50LatencyMs: percentile(latenciesAsc, 50),
    p95LatencyMs: percentile(latenciesAsc, 95),
  };

  const byStageMap = new Map<string, LlmRequestLogEntry[]>();
  for (const e of entries) {
    const list = byStageMap.get(e.stage);
    if (list) list.push(e);
    else byStageMap.set(e.stage, [e]);
  }
  const byStage: StageBreakdown[] = [...byStageMap.entries()]
    .map(([stage, rows]) => ({
      stage,
      requests: rows.length,
      costUsd: sum(rows.map(r => r.costUsd ?? 0)),
      unpricedRequests: rows.filter(isUnpriced).length,
      avgLatencyMs: Math.round(sum(rows.map(r => r.latencyMs)) / rows.length),
      errorRate: rows.filter(r => r.status === 'error').length / rows.length,
    }))
    .sort((a, b) => b.requests - a.requests);

  const bucketMap = new Map<string, TimeseriesBucket>();
  const bucketLatencies = new Map<string, number[]>();
  for (const e of entries) {
    const key = bucketKey(e.createdAt, granularity);
    const agg = bucketMap.get(key) ?? { bucket: key, requests: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, p50LatencyMs: 0, p95LatencyMs: 0 };
    agg.requests += 1;
    agg.costUsd += e.costUsd ?? 0;
    agg.inputTokens += e.inputTokens ?? 0;
    agg.outputTokens += e.outputTokens ?? 0;
    bucketMap.set(key, agg);

    const latencies = bucketLatencies.get(key) ?? [];
    latencies.push(e.latencyMs);
    bucketLatencies.set(key, latencies);
  }
  for (const [key, agg] of bucketMap) {
    const sortedAsc = (bucketLatencies.get(key) ?? []).sort((a, b) => a - b);
    agg.p50LatencyMs = percentile(sortedAsc, 50);
    agg.p95LatencyMs = percentile(sortedAsc, 95);
  }
  const timeseries = [...bucketMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));

  return { totals, byStage, timeseries, drilldowns: buildDrilldowns(entries, totals.p50LatencyMs, totals.p95LatencyMs) };
}
