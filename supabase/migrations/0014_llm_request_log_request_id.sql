-- Correlates every model call that belongs to one logical workflow — the
-- whole report pipeline (extract -> normalise -> analyse -> corroborate* ->
-- plan.generate, chained through job payloads by reportId) or one chat
-- message and whatever agent/tool calls it triggers — so the observability
-- dashboard can show them together instead of as unrelated rows. Nullable:
-- older rows, and any call path not yet threaded through, have none.
alter table llm_request_log add column request_id uuid;
create index on llm_request_log(request_id) where request_id is not null;
