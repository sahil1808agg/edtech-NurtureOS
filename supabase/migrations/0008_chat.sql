-- Chat-primary pivot: one conversation per child, with messages that can be
-- pending (a placeholder while a queued job runs) or complete. See
-- docs/engineering/engineering-doc.md and docs/specs/01-chat-thread.md.

create type message_role   as enum ('user','assistant','system');
create type message_status as enum ('pending','complete');

create table conversations (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  child_id    uuid not null references children(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (child_id)
);

create table messages (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null references conversations(id) on delete cascade,
  family_id             uuid not null references families(id) on delete cascade,
  role                  message_role not null,
  content               text not null default '',
  tool_calls            jsonb,
  tool_results          jsonb,
  attachment_report_id  uuid references reports(id),
  status                message_status not null default 'complete',
  route_classification  text,
  prompt_version        text,
  model_deployment      text,
  created_at            timestamptz not null default now()
);
create index on messages(conversation_id, created_at);
create index on messages(status) where status = 'pending';

alter table conversations enable row level security;
alter table messages enable row level security;

create policy family_read on conversations for select
  using (family_id = current_family_id() or is_ops());
create policy family_write on conversations for all
  using (family_id = current_family_id()) with check (family_id = current_family_id());

create policy family_read on messages for select
  using (family_id = current_family_id() or is_ops());
create policy family_write on messages for all
  using (family_id = current_family_id()) with check (family_id = current_family_id());

-- audit_log existed with no RLS (writers were always the service role). Now
-- that the audit view (Spec 06) reads it as the signed-in ops user, it needs
-- an explicit ops-only read policy.
alter table audit_log enable row level security;
create policy ops_read on audit_log for select using (is_ops());
