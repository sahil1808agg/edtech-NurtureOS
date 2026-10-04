-- Observability: one row per model call (every PromptKey stage, including
-- chat/chatroute), written by callModel()/callChatModel() themselves. See
-- docs/specs/07-observability-dashboard.md.

create table llm_request_log (
  id             bigint generated always as identity primary key,
  stage          text not null,
  provider       text not null,
  model          text not null,
  prompt_version text,
  family_id      uuid references families(id) on delete set null,
  status         text not null,
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

-- llm_request_log is ops-readable only. Writers are always the service role
-- (callModel()/callChatModel() run server-side), which bypasses RLS, so no
-- write policy is needed for authenticated users.
alter table llm_request_log enable row level security;
create policy ops_read on llm_request_log for select using (is_ops());
