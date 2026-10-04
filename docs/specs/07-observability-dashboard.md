# Spec 07 — LLM observability dashboard (ops-only)

New feature, not in the original six. Tracks every model call the app makes
— requests, latency, input/output tokens, cost — so usage and spend can be
read at a glance and optimizations (tier downgrades, prompt trims, provider
switches) can be evaluated against real numbers, not guesses.

Decisions made with the user before this spec (see conversation): ops-only
page under a new route (not folded into the audit view), charts via
**Recharts** (new dependency), and cost computed from a **static in-code
pricing table** (`src/server/llm/pricing.ts`), not a DB-editable one.

## Why a new table, not the existing per-row columns

`extractions`, `findings`, `plans`, and `messages` already each carry their
own `model_deployment` / `prompt_version` / `latency_ms` columns (per-row
attribution, kept as-is). None of them capture `input_tokens`/`output_tokens`
today, none of them cover `chatroute` (a model call that produces no row of
its own — see `src/server/prompts/chat-route.ts`), and failed calls
(`PROVIDER_ERROR`/`SCHEMA_INVALID`) are dropped on the floor rather than
recorded anywhere. A dashboard reading five different tables with five
different shapes, missing the failures and the token counts, isn't a
dashboard. This spec adds one append-only log, written at the two choke
points every model call already passes through — `callModel()` in
`src/server/llm/client.ts` and `callChatModel()` in
`src/server/llm/chat-client.ts` — so no per-call-site code needs to change.

## DB schema (NEW)

Already appended to `docs/specs/supabase-schema.sql`:

```sql
create table llm_request_log (
  id             bigint generated always as identity primary key,
  stage          text not null,        -- PromptKey: extract | normalise | analyse | corroborate | plan | checkin | chatroute | chat
  provider       text not null,
  model          text not null,
  prompt_version text,
  family_id      uuid references families(id) on delete set null,
  status         text not null,        -- 'ok' | 'error'
  error_code     text,
  input_tokens   int,
  output_tokens  int,
  cost_usd       numeric(12,6),
  latency_ms     int not null,
  created_at     timestamptz not null default now()
);
create index on llm_request_log(created_at desc);
create index on llm_request_log(stage, created_at desc);
create index on llm_request_log(family_id) where family_id is not null;

alter table llm_request_log enable row level security;
create policy ops_read on llm_request_log for select using (is_ops());
```

Writers are always the service role (same reasoning as `audit_log`) — no
write policy needed. `family_id` is nullable: pipeline-stage calls
(`extract`/`normalise`/`analyse`/`corroborate`/`plan`/`checkin`) run inside a
queue job that has it on hand and should set it; `chatroute`/`chat` have it
from the conversation; nothing currently calling `callModel`/`callChatModel`
lacks a family_id, but the column stays nullable rather than assuming that
never changes.

## DB tasks

- Migration file under `supabase/migrations/` (next number after `0009`) creating the table above, verbatim.
- `src/server/db/llm-request-log.ts` — `logLlmRequest(entry)` (fire-and-forget insert via the service client — a logging failure must never fail the model call it's describing, so this catches and swallows its own errors, logging a console warning instead) and `queryLlmRequestLog(filters)` / `summarizeLlmRequestLog(filters)` for the API routes below.

## Pricing

`src/server/llm/pricing.ts` — a hand-maintained map:

```ts
export const PRICING_PER_MILLION_TOKENS: Record<string, Record<string, { input: number; output: number }>> = {
  anthropic: { 'claude-opus-5': { input: ..., output: ... }, 'claude-haiku-4-5-20251001': { input: ..., output: ... } },
  gemini:    { 'gemini-3.5-flash': { ... }, 'gemini-3.5-flash-lite': { ... } },
  openai:    { 'gpt-4o': { ... }, 'gpt-4o-mini': { ... } },
  grok:      { ... },
  kimi:      { ... },
};

export function costUsd(provider: string, model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  // returns null if provider/model isn't in the table, or tokens are null (failed call) — never throws, never guesses a price.
}
```

Filled in with each provider's published per-million-token rates for the
models actually in `DEFAULT_MODELS` (`client.ts`) and `DEFAULT_MODELS`
(`chat-client.ts`) at implementation time — rates go stale, so this file
gets a comment pointing at where to re-check them, not a frozen assumption.

## Instrumentation (where logging actually happens)

- **`callModel()` in `src/server/llm/client.ts`**: already measures
  `latencyMs`, `inputTokens`, `outputTokens` in `meta`. Add one
  `logLlmRequest(...)` call before each `return` (both the success path and
  the two existing error paths — the dispatch-failure path currently returns
  before `meta` exists, so it needs its own `Date.now() - started` computed
  inline). `family_id` is threaded through by adding an optional
  `familyId?: string` parameter to `callModel()`, passed by its callers (the
  queue jobs already have it; `chatroute`'s caller in the chat route handler
  has it too).
- **`callChatModel()` in `src/server/llm/chat-client.ts`**: currently does
  not measure latency at all. Add a `started = Date.now()` and a
  `logLlmRequest(...)` call before returning, with the same `familyId?`
  parameter added and threaded from the chat API route.
- Both call `costUsd(provider, model, inputTokens, outputTokens)` to fill `cost_usd`.

## API routes (NEW)

```
GET /api/observability/summary?since=<ISO8601>&until=<ISO8601>&stage=&provider=&model=
  -> 200 {
       totals: { requests: number; errorRate: number; inputTokens: number; outputTokens: number; costUsd: number; p50LatencyMs: number; p95LatencyMs: number },
       byStage: { stage: string; requests: number; costUsd: number; avgLatencyMs: number; errorRate: number }[],
       timeseries: { bucket: string; requests: number; costUsd: number; inputTokens: number; outputTokens: number }[],
     }
  Buckets hourly if (until - since) <= 48h, daily otherwise — computed
  server-side so the client never receives raw per-call rows for a chart.
  Ops-only, gated the same way as /api/audit (user.isOps, 403 otherwise).

GET /api/observability/calls?since=&until=&stage=&provider=&model=&status=&limit=50&cursor=<id>
  -> 200 { entries: LlmRequestLogEntry[], nextCursor: string | null }
  Raw, paginated log for drill-down — same cursor pattern as /api/audit.
```

```ts
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
```

## Page

`src/app/observability/page.tsx` — new route, gated like `src/app/review/page.tsx` (`if (!user.isOps) redirect('/')`).

- **Filter bar**: date range (24h / 7d / 30d / custom), stage, provider, model — all optional, all passed through as query params to both API routes.
- **Stat tiles**: total requests, total cost, avg + p95 latency, error rate, total input/output tokens.
- **Charts** (Recharts; load the `dataviz` skill before writing these, per its own trigger rule, for palette/axis/legend conventions): requests-over-time, cost-over-time, latency trend (p50 vs p95), token usage (stacked input/output).
- **Breakdown table**: by stage/provider/model — requests, cost, avg latency, error rate.
- **Raw log table**: paginated (`/api/observability/calls`), same cursor-based "load more" as the audit view.

No realtime subscription — this is a manual-refresh/filter-driven dashboard like the audit view, not a live feed; a "Refresh" button re-fetches both endpoints.

## State management

Server component loads the default view (last 24h, no filters) on first render. A client `FilterBar` component updates URL query params and triggers a client-side re-fetch of both `/api/observability/summary` and `/api/observability/calls` — no global store needed, this page has no write actions.

## Design

Apply `/design-system` for layout/type/spacing/component chrome (per `CLAUDE.md`'s rule for all frontend code), and the `dataviz` skill specifically for the chart components — the two are complementary, not redundant: design-system covers the page shell, dataviz covers chart-internal color/axis/legend choices.

## Per-call detail (added after initial ship)

Follow-up to the original spec: the recent-calls table only showed metrics,
not what was actually sent/returned, which turned out to matter immediately
— it's what let us diagnose the `chatroute` `SCHEMA_INVALID` issue by actually
reading the model's raw reply instead of guessing from the error code alone.

- `llm_request_log` gains two nullable columns: `request_text` (JSON of
  `{system, user}` for a pipeline/chatroute call, `{system, history, tools}`
  for a chat call) and `response_text` (the raw response content, or the
  error message on a failed call). Clamped to 100k chars at insert time
  (`logLlmRequest`) — defensive, not routine; a normal row is a few KB.
- Kept **out of** `SELECT_COLUMNS` (the list/summary queries) deliberately —
  those stay cheap. A new `GET /api/observability/calls/:id` (ops-gated,
  same as the others) fetches one row's full detail, including the text
  columns, only when an ops user actually clicks into a call.
- `Recent calls` rows are now clickable; `CallDetailModal.tsx` fetches and
  renders the full row (every metadata field plus both text blocks) on click.
- **Why not redact:** ops can already read full chat message content via the
  existing `messages` table RLS (`family_id = current_family_id() or
  is_ops()`), and every other family-crossing table in this schema
  (`reports`, `findings`, `plans`, `audit_log`, ...) grants the same `is_ops()`
  escape hatch. Storing request/response text here doesn't open a new
  category of access — it's the same ops role's existing reach, just
  attached to the specific model call instead of the conversation row.

## Edge cases

- **Unknown model/provider pricing** → `costUsd` returns `null`; the row's `cost_usd` is stored `null`, the UI renders `—` for that row, and it's excluded from cost totals/averages but still counted in request totals — a misconfigured or newly-added model shows up as missing cost data, not a wrong number.
- **Failed calls** (`PROVIDER_ERROR`, `SCHEMA_INVALID`) → still logged, `status='error'`, `input_tokens`/`output_tokens`/`cost_usd` null if the provider never returned usage data, `latency_ms` is time-to-failure. These count toward `totals.requests` and `totals.errorRate` but not toward token/cost aggregates.
- **Logging failure itself** → `logLlmRequest` catches and swallows; a broken insert must never surface as a broken chat reply or pipeline stage.
- **Large date ranges** → `timeseries` is bucketed server-side (see API section); the raw-calls table is always cursor-paginated, never "load everything since `since`."
- **Model string drift** (e.g. a typo'd env override) → grouped by the raw `(provider, model)` pair as logged, not normalized — a misconfiguration is visible as an unexpected row in the breakdown table rather than silently merged into "unknown."
