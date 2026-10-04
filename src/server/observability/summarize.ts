import type { LlmRequestLogEntry } from '../db/llm-request-log.js';

export interface SummaryTotals {
  requests: number;
  errorRate: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export interface StageBreakdown {
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

export interface ObservabilitySummary {
  totals: SummaryTotals;
  byStage: StageBreakdown[];
  timeseries: TimeseriesBucket[];
}

export type BucketGranularity = 'hour' | 'day';

/** Hourly under 48h, daily otherwise — keeps the timeseries a sane length regardless of range. */
export function bucketGranularity(sinceMs: number, untilMs: number): BucketGranularity {
  return untilMs - sinceMs <= 48 * 60 * 60 * 1000 ? 'hour' : 'day';
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

  return { totals, byStage, timeseries };
}
