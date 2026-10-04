import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../../lib/db/clients.js';
import { costUsd } from '../llm/pricing.js';

export interface LogLlmRequestInput {
  stage: string;
  provider: string;
  model: string;
  promptVersion: string | null;
  familyId?: string | null;
  status: 'ok' | 'error';
  errorCode?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs: number;
  /** Exactly what was sent/returned for this call — see docs/specs/07-observability-dashboard.md. */
  requestText?: string | null;
  responseText?: string | null;
}

// Defensive only, not routine — the dynamic part of a prompt (the one thing
// logged; see callModel()/callChatModel()) is normally a few KB at most.
// This just bounds the pathological case (a huge chat history, a runaway
// response) so one row can't blow out the table.
const MAX_LOGGED_TEXT = 100_000;

function clampText(text: string | null | undefined): string | null {
  if (text == null) return null;
  if (text.length <= MAX_LOGGED_TEXT) return text;
  return text.slice(0, MAX_LOGGED_TEXT) + `\n…[truncated, ${text.length} chars total]`;
}

/**
 * Called from callModel() and callChatModel() on every path — success,
 * schema-invalid, and provider error alike. Never throws: a broken insert
 * here must not break the model call it's describing, so failures are
 * caught and only logged to the console. See
 * docs/specs/07-observability-dashboard.md.
 */
export async function logLlmRequest(input: LogLlmRequestInput): Promise<void> {
  try {
    const { error } = await serviceClient().from('llm_request_log').insert({
      stage: input.stage,
      provider: input.provider,
      model: input.model,
      prompt_version: input.promptVersion,
      family_id: input.familyId ?? null,
      status: input.status,
      error_code: input.errorCode ?? null,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      cost_usd: costUsd(input.provider, input.model, input.inputTokens ?? null, input.outputTokens ?? null),
      latency_ms: input.latencyMs,
      request_text: clampText(input.requestText),
      response_text: clampText(input.responseText),
    });
    if (error) console.warn('logLlmRequest insert failed:', error.message);
  } catch (err) {
    console.warn('logLlmRequest failed:', err);
  }
}

export interface LlmRequestLogEntry {
  id: number;
  stage: string;
  provider: string;
  model: string;
  promptVersion: string | null;
  familyId: string | null;
  status: 'ok' | 'error';
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  createdAt: string;
}

export interface LlmRequestLogDetail extends LlmRequestLogEntry {
  requestText: string | null;
  responseText: string | null;
}

export interface LlmRequestLogFilters {
  since?: string;
  until?: string;
  stage?: string;
  provider?: string;
  model?: string;
  status?: string;
}

const SELECT_COLUMNS =
  'id, stage, provider, model, prompt_version, family_id, status, error_code, input_tokens, output_tokens, cost_usd, latency_ms, created_at';

function toEntry(row: Record<string, unknown>): LlmRequestLogEntry {
  return {
    id: row.id as number,
    stage: row.stage as string,
    provider: row.provider as string,
    model: row.model as string,
    promptVersion: (row.prompt_version as string | null) ?? null,
    familyId: (row.family_id as string | null) ?? null,
    status: row.status as 'ok' | 'error',
    errorCode: (row.error_code as string | null) ?? null,
    inputTokens: (row.input_tokens as number | null) ?? null,
    outputTokens: (row.output_tokens as number | null) ?? null,
    costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
    latencyMs: row.latency_ms as number,
    createdAt: row.created_at as string,
  };
}

/**
 * One full row, including request/response text — kept out of
 * SELECT_COLUMNS (used by the list and summary queries below) so those two
 * stay cheap; the text fields are only ever fetched for a single call the
 * ops user actually clicked into. Same RLS reasoning as the list query.
 */
export async function getLlmRequestLogDetail(db: SupabaseClient, id: string): Promise<LlmRequestLogDetail | null> {
  const { data, error } = await db
    .from('llm_request_log')
    .select(`${SELECT_COLUMNS}, request_text, response_text`)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`querying llm_request_log detail: ${error.message}`);
  if (!data) return null;

  return {
    ...toEntry(data),
    requestText: (data.request_text as string | null) ?? null,
    responseText: (data.response_text as string | null) ?? null,
  };
}

/**
 * Paginated raw log for the drill-down table. Uses the caller's own session
 * (RLS applies, ops_read policy on llm_request_log), same reasoning as the
 * audit route — read-only, and the RLS check is the authorization.
 */
export async function queryLlmRequestLogPage(
  db: SupabaseClient,
  filters: LlmRequestLogFilters & { limit: number; cursor?: string },
): Promise<{ entries: LlmRequestLogEntry[]; nextCursor: string | null }> {
  let query = db.from('llm_request_log').select(SELECT_COLUMNS).order('id', { ascending: false }).limit(filters.limit);

  if (filters.since) query = query.gte('created_at', filters.since);
  if (filters.until) query = query.lte('created_at', filters.until);
  if (filters.stage) query = query.eq('stage', filters.stage);
  if (filters.provider) query = query.eq('provider', filters.provider);
  if (filters.model) query = query.eq('model', filters.model);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.cursor) query = query.lt('id', filters.cursor);

  const { data, error } = await query;
  if (error) throw new Error(`querying llm_request_log: ${error.message}`);

  const entries = (data ?? []).map(toEntry);
  const nextCursor = entries.length === filters.limit ? String(entries[entries.length - 1].id) : null;
  return { entries, nextCursor };
}

// Fetched once and aggregated in JS rather than with SQL aggregates — the
// cap below keeps this bounded for a filtered date range without needing a
// dedicated RPC function. See "Large date ranges" in
// docs/specs/07-observability-dashboard.md.
const SUMMARY_ROW_CAP = 10_000;

export async function fetchLlmRequestLogRowsForSummary(
  db: SupabaseClient,
  filters: LlmRequestLogFilters,
): Promise<LlmRequestLogEntry[]> {
  let query = db.from('llm_request_log').select(SELECT_COLUMNS).order('created_at', { ascending: false }).limit(SUMMARY_ROW_CAP);

  if (filters.since) query = query.gte('created_at', filters.since);
  if (filters.until) query = query.lte('created_at', filters.until);
  if (filters.stage) query = query.eq('stage', filters.stage);
  if (filters.provider) query = query.eq('provider', filters.provider);
  if (filters.model) query = query.eq('model', filters.model);
  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw new Error(`querying llm_request_log for summary: ${error.message}`);
  return (data ?? []).map(toEntry);
}
