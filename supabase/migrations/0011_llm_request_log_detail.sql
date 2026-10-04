-- Adds the per-call request/response detail view. See
-- docs/specs/07-observability-dashboard.md.

alter table llm_request_log add column request_text text;
alter table llm_request_log add column response_text text;
