-- NurtureOS — schema, current state + chat pivot
-- Postgres / Supabase. Run in the SQL editor on a fresh project.
-- Every family-scoped table carries family_id and an RLS policy keyed to auth.uid().
--
-- This file is the merged result of the original MVP schema plus every migration
-- applied since (0002-0007) plus the new tables for the chat-primary pivot
-- (conversations, messages). It is meant to be pasted whole into a new project,
-- not applied incrementally — for an already-running project, use
-- supabase/migrations/ instead and add a new migration for the chat tables only.

create extension if not exists "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

create type report_paradigm as enum ('criterion_narrative', 'grade_comment', 'marks_remark');
create type report_status   as enum ('uploaded','classified','extracted','normalised','analysed','gated','in_review','published','held','failed');
create type source_type     as enum ('pdf','photo');
create type finding_kind    as enum ('strength','growth');
create type corroboration   as enum ('corroborated','not_mentioned','conflicting');
create type artifact_status as enum ('draft','in_review','approved','rejected','published');
create type parent_response as enum ('matches','doesnt_match','unsure');
create type activity_kind   as enum ('home','resource','local');
create type checkin_decision as enum ('hold','adjust','escalate','advance');
create type review_artifact as enum ('finding_set','plan');
create type resource_kind   as enum ('book','video','worksheet','game');
-- NEW — chat pivot
create type message_role    as enum ('user','assistant','system');
create type message_status  as enum ('pending','complete');

-- ============================================================
-- IDENTITY, CONSENT, CONSTRAINTS
-- ============================================================

create table families (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  family_id   uuid not null references families(id) on delete cascade,
  full_name   text,
  is_ops      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on profiles(family_id);

create table schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  board       text not null,          -- 'IB' | 'CBSE' | 'CAIE' | 'CISCE' | 'STATE'
  programme   text,                   -- 'EYP' | 'PYP' | 'MYP' | null
  city        text,
  created_at  timestamptz not null default now()
);

create table children (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  first_name  text not null,
  dob         date not null,
  grade       text not null,
  school_id   uuid references schools(id),
  city        text,
  pincode     text,
  created_at  timestamptz not null default now()
);
create index on children(family_id);

-- No pipeline job may run without a live consent row for the child.
create table consents (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references families(id) on delete cascade,
  child_id      uuid not null references children(id) on delete cascade,
  granted_by    uuid not null references profiles(id),
  method        text not null,        -- how the guardian was verified
  purposes      text[] not null,
  verified_at   timestamptz not null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index on consents(child_id) where revoked_at is null;

create table family_constraints (
  family_id      uuid primary key references families(id) on delete cascade,
  weekly_minutes int  not null default 60,
  budget_band    text not null default 'none',   -- 'none' | 'low' | 'medium' | 'high'
  radius_km      int  not null default 5,
  materials      jsonb not null default '[]'::jsonb,
  interests      jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now()
);

-- ============================================================
-- ACCOUNT / CONSENT RPCs (atomic, SECURITY DEFINER) — migration 0003
-- ============================================================

create or replace function create_family_account(
  p_user_id   uuid,
  p_full_name text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_family uuid;
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'no such auth user: %', p_user_id using errcode = 'foreign_key_violation';
  end if;
  if exists (select 1 from profiles where id = p_user_id) then
    raise exception 'profile already exists for user %', p_user_id using errcode = 'unique_violation';
  end if;

  insert into families default values returning id into v_family;
  insert into profiles (id, family_id, full_name) values (p_user_id, v_family, p_full_name);
  insert into family_constraints (family_id) values (v_family);
  return v_family;
end;
$$;

create or replace function grant_child_consent(
  p_child_id   uuid,
  p_granted_by uuid,
  p_method     text,
  p_purposes   text[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_family  uuid;
  v_consent uuid;
begin
  select family_id into v_family from children where id = p_child_id;
  if v_family is null then
    raise exception 'no such child: %', p_child_id using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from profiles where id = p_granted_by and family_id = v_family) then
    raise exception 'granting user % is not in the child''s family', p_granted_by
      using errcode = 'insufficient_privilege';
  end if;
  if array_length(p_purposes, 1) is null then
    raise exception 'at least one purpose is required' using errcode = 'check_violation';
  end if;

  insert into consents (family_id, child_id, granted_by, method, purposes, verified_at)
  values (v_family, p_child_id, p_granted_by, p_method, p_purposes, now())
  returning id into v_consent;
  return v_consent;
end;
$$;

create or replace function revoke_child_consent(p_consent_id uuid)
returns void language sql security definer set search_path = public as $$
  update consents set revoked_at = now() where id = p_consent_id and revoked_at is null;
$$;

revoke all on function create_family_account(uuid, text) from public;
revoke all on function grant_child_consent(uuid, uuid, text, text[]) from public;
revoke all on function revoke_child_consent(uuid) from public;
grant execute on function create_family_account(uuid, text) to service_role;
grant execute on function grant_child_consent(uuid, uuid, text, text[]) to service_role;
grant execute on function revoke_child_consent(uuid) to service_role;

-- ============================================================
-- SCALES — the normalisation layer
-- ============================================================

create table scales (
  id          text primary key,       -- 'IB_OPCE' | 'IB_MYP_1_8' | 'CAIE_AG' | 'PCT' | 'HPC_BAND'
  board       text not null,
  description text not null,
  ordered     boolean not null default true
);

create table scale_values (
  scale_id    text not null references scales(id) on delete cascade,
  raw_value   text not null,          -- 'O' | 'P' | 'C' | 'E' | 'A*' | '78'
  normalised  numeric(4,3) not null check (normalised between 0 and 1),
  label       text,
  primary key (scale_id, raw_value)
);

-- ============================================================
-- ONTOLOGY
-- ============================================================

create table skills (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,   -- 'MATH.NUM.PLACE_VALUE'
  name        text not null,
  domain      text not null,          -- 'MATH' | 'LANG' | 'ARTS' | 'PSPE'
  sub_domain  text,
  age_min     int,
  age_max     int
);

create table skill_aliases (
  id          uuid primary key default gen_random_uuid(),
  skill_id    uuid not null references skills(id) on delete cascade,
  board       text not null,
  programme   text,
  raw_label   text not null,
  confidence  numeric(4,3) not null default 1.0,
  created_at  timestamptz not null default now(),
  unique (board, programme, raw_label)
);
create index on skill_aliases(skill_id);

-- ============================================================
-- REPORTS AND EXTRACTION
-- ============================================================

create table report_templates (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid references schools(id),
  board        text not null,
  programme    text,
  paradigm     report_paradigm not null,
  scale_id     text references scales(id),
  version      int not null default 1,
  status       text not null default 'known',  -- 'known' | 'new' | 'unparseable'
  created_at   timestamptz not null default now()
);

create table reports (
  id                        uuid primary key default gen_random_uuid(),
  family_id                 uuid not null references families(id) on delete cascade,
  child_id                  uuid not null references children(id) on delete cascade,
  template_id               uuid references report_templates(id),
  term_label                text,
  term_index                int,
  academic_year             text,
  source_type               source_type not null,
  storage_path              text not null,
  page_count                int,
  classification_confidence numeric(4,3),
  sen_flagged               boolean not null default false,
  status                    report_status not null default 'uploaded',
  failure_reason            text,
  created_at                timestamptz not null default now()
);
create index on reports(child_id, created_at desc);
create index on reports(status);

create table report_pages (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references reports(id) on delete cascade,
  page_no       int  not null,
  storage_path  text not null,
  unique (report_id, page_no)
);

-- migration 0004: extract now runs once per whole report, not once per page.
create table extractions (
  id                uuid primary key default gen_random_uuid(),
  report_id         uuid not null references reports(id) on delete cascade,
  page_no           int,                        -- nullable: one row per report now
  raw_json          jsonb not null,
  min_confidence    numeric(4,3),
  model_deployment  text not null,
  prompt_version    text not null,
  latency_ms        int,
  created_at        timestamptz not null default now(),
  constraint extractions_report_id_key unique (report_id)
);

-- ============================================================
-- THE NORMALISED RECORD
-- ============================================================

create table observations (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  child_id     uuid not null references children(id) on delete cascade,
  report_id    uuid not null references reports(id) on delete cascade,
  skill_id     uuid references skills(id),
  raw_label    text not null,
  scale_id     text references scales(id),
  term_index   int  not null,
  raw_value    text,
  normalised   numeric(4,3),
  is_ambiguous boolean not null default false,
  confidence   numeric(4,3) not null default 1.0,
  source_ref   jsonb not null,                   -- {page, table, row, cell}
  created_at   timestamptz not null default now()
);
create index on observations(child_id, skill_id, term_index);
create index on observations(report_id);

create table narratives (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  report_id   uuid not null references reports(id) on delete cascade,
  subject     text,
  text        text not null,
  source_ref  jsonb not null,
  created_at  timestamptz not null default now()
);
create index on narratives(report_id);

-- ============================================================
-- FINDINGS
-- ============================================================

create table finding_sets (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references families(id) on delete cascade,
  child_id         uuid not null references children(id) on delete cascade,
  report_id        uuid not null references reports(id) on delete cascade,
  status           artifact_status not null default 'draft',
  honesty_path     boolean not null default false,
  model_deployment text not null,
  prompt_version   text not null,
  created_at       timestamptz not null default now(),
  published_at     timestamptz
);
create index on finding_sets(child_id, created_at desc);

-- migration 0006: a parent can reword or drop a finding before it's acted on.
-- original_statement preserves the model's wording when edited — the
-- strongest evaluation signal this product produces, so it is never overwritten.
create table findings (
  id                   uuid primary key default gen_random_uuid(),
  finding_set_id       uuid not null references finding_sets(id) on delete cascade,
  family_id            uuid not null references families(id) on delete cascade,
  kind                 finding_kind not null,
  statement            text not null,
  original_statement   text,
  corroboration_status corroboration not null,
  corroboration_quote  text,
  position             int not null,
  excluded             boolean not null default false,
  edited_at            timestamptz,
  edited_by            uuid references profiles(id),
  created_at           timestamptz not null default now()
);
create index on findings(finding_set_id);

comment on column findings.original_statement is
  'What the model wrote, kept when a parent or chat edits the statement. Null means unedited.';
comment on column findings.excluded is
  'Dropped from the active set: not shown after publishing, and never used to build a plan.';

-- The groundedness join. A finding with no resolvable citation never renders.
create table finding_citations (
  id             uuid primary key default gen_random_uuid(),
  finding_id     uuid not null references findings(id) on delete cascade,
  observation_id uuid references observations(id) on delete cascade,
  narrative_id   uuid references narratives(id) on delete cascade,
  quote          text,
  check (num_nonnulls(observation_id, narrative_id) = 1)
);
create index on finding_citations(finding_id);

create table parent_finding_responses (
  finding_id   uuid primary key references findings(id) on delete cascade,
  family_id    uuid not null references families(id) on delete cascade,
  response     parent_response not null,
  note         text,
  responded_at timestamptz not null default now()
);

-- ============================================================
-- REFERENCE DATA — no model involved
-- ============================================================

-- migration 0005: curriculum_topics holds two shapes — framework rows
-- (phase/strand, no month/grade) and school-calendar rows (month/grade, no
-- phase/strand) — because the IB PYP scope-and-sequence source is organised
-- by developmental phase and strand, not by calendar month.
create table curriculum_topics (
  id         uuid primary key default gen_random_uuid(),
  board      text not null,
  programme  text,
  grade      text,
  month      int check (month between 1 and 12),
  topic      text not null,
  unit_title text,
  phase      int check (phase between 1 and 4),
  strand     text,
  stage      text,  -- 'conceptual_understandings' | 'constructing_meaning' | 'transferring_meaning_into_symbols' | 'applying_with_understanding'
  source     text,
  constraint curriculum_topics_shape_check check (
    (phase is not null and strand is not null and month is null)
    or (month is not null and phase is null)
  )
);

create unique index curriculum_topics_unique_idx
  on curriculum_topics (
    board, coalesce(programme, ''), coalesce(grade, ''), coalesce(month, 0),
    coalesce(phase, 0), coalesce(strand, ''), coalesce(stage, ''), topic
  );

create table resources (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  kind              resource_kind not null,
  url               text,
  age_min           int not null,
  age_max           int not null,
  language          text not null default 'en',
  skill_codes       text[] not null default '{}',
  last_validated_at timestamptz,
  is_active         boolean not null default true
);
create index on resources using gin (skill_codes);

-- ============================================================
-- PLANS AND CHECK-INS
-- ============================================================

create table plans (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references families(id) on delete cascade,
  child_id         uuid not null references children(id) on delete cascade,
  cycle_no         int  not null,
  status           artifact_status not null default 'draft',
  topic_context    text,
  model_deployment text not null,
  prompt_version   text not null,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  unique (child_id, cycle_no)
);

-- migration 0007: activity count follows the findings, not a fixed "exactly 3".
create table plan_activities (
  id                   uuid primary key default gen_random_uuid(),
  plan_id              uuid not null references plans(id) on delete cascade,
  position             int  not null,
  kind                 activity_kind not null,
  title                text not null,
  instructions         text not null,
  addresses_finding_id uuid not null references findings(id),
  resource_id          uuid references resources(id),
  declined             boolean not null default false,
  unique (plan_id, position),
  constraint plan_activities_position_check check (position >= 1)
);

create table checkins (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references families(id) on delete cascade,
  plan_id         uuid not null references plans(id) on delete cascade,
  token_hash      text not null unique,
  sent_at         timestamptz,
  responded_at    timestamptz,
  activities_done int,
  response_note   text,
  concern_raised  boolean not null default false,
  decision        checkin_decision,
  expires_at      timestamptz not null
);
create index on checkins(plan_id);

-- ============================================================
-- CHAT — NEW for the chat-primary pivot
-- ============================================================

-- One conversation per child. The parent's primary surface; legacy pages
-- (upload/reports/plans/findings) remain functional but are not chat-driven.
create table conversations (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  child_id    uuid not null references children(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (child_id)
);

-- status='pending' is a placeholder row (e.g. "processing your report...")
-- updated in place by the worker when the underlying job completes.
-- attachment_report_id links a chat-attached file to the reports row it
-- created via the same ingestReport() path the legacy upload route uses.
create table messages (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null references conversations(id) on delete cascade,
  family_id             uuid not null references families(id) on delete cascade,
  role                  message_role not null,
  content               text not null default '',
  tool_calls            jsonb,
  tool_results           jsonb,
  attachment_report_id  uuid references reports(id),
  status                message_status not null default 'complete',
  route_classification  text,            -- 'grounded' | 'general' | 'mixed' — debugging/audit only
  prompt_version        text,
  model_deployment       text,
  created_at            timestamptz not null default now()
);
create index on messages(conversation_id, created_at);
create index on messages(status) where status = 'pending';

-- ============================================================
-- OPS AND EVALUATION
-- ============================================================

-- Legacy approval workflow — still functional for the legacy page surface.
-- Chat-originated writes do NOT insert here; they write audit_log instead (below).
create table review_queue (
  id            uuid primary key default gen_random_uuid(),
  artifact_type review_artifact not null,
  artifact_id   uuid not null,
  status        artifact_status not null default 'in_review',
  reviewer_id   uuid references profiles(id),
  checklist     jsonb,
  violations    text[],
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (artifact_type, artifact_id)
);
create index on review_queue(status, created_at);

create table golden_reports (
  id           uuid primary key default gen_random_uuid(),
  origin       text not null,         -- 'real' | 'adversarial'
  case_label   text,
  storage_path text not null,
  notes        text
);

create table golden_labels (
  id                uuid primary key default gen_random_uuid(),
  golden_report_id  uuid not null references golden_reports(id) on delete cascade,
  annotator         text not null,
  expected_findings jsonb not null,
  frozen_at         timestamptz,
  unique (golden_report_id, annotator)
);

create table eval_runs (
  id                uuid primary key default gen_random_uuid(),
  git_sha           text,
  prompt_versions   jsonb not null,
  model_deployments jsonb not null,
  results           jsonb not null,
  passed            boolean not null,
  created_at        timestamptz not null default now()
);

-- The audit trail. For the chat pivot this is load-bearing, not supplementary:
-- it is what replaces the pre-publication approval gate for chat-originated
-- writes (see docs/engineering/engineering-doc.md §7).
create table audit_log (
  id         bigserial primary key,
  actor      uuid,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  payload    jsonb,
  created_at timestamptz not null default now()
);
create index on audit_log(entity, entity_id);
create index on audit_log(created_at desc);

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
  -- What was actually sent/returned, for the per-call detail view. Ops-only,
  -- same as every other column here. logLlmRequest() clamps length before
  -- insert — see src/server/db/llm-request-log.ts.
  request_text   text,
  response_text  text,
  created_at     timestamptz not null default now()
);
create index on llm_request_log(created_at desc);
create index on llm_request_log(stage, created_at desc);
create index on llm_request_log(family_id) where family_id is not null;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

create or replace function current_family_id() returns uuid
language sql stable security definer as $$
  select family_id from profiles where id = auth.uid()
$$;

create or replace function is_ops() returns boolean
language sql stable security definer as $$
  select coalesce((select is_ops from profiles where id = auth.uid()), false)
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'children','consents','family_constraints','reports','observations','narratives',
    'finding_sets','findings','parent_finding_responses','plans','checkins',
    'conversations','messages'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format($f$
      create policy family_read on %I for select
      using (family_id = current_family_id() or is_ops())
    $f$, t);
    execute format($f$
      create policy family_write on %I for all
      using (family_id = current_family_id())
      with check (family_id = current_family_id())
    $f$, t);
  end loop;
end $$;

alter table family_constraints enable row level security;

-- Child tables inherit isolation through their parent's family_id.
alter table report_pages       enable row level security;
alter table extractions        enable row level security;
alter table plan_activities    enable row level security;
alter table finding_citations  enable row level security;

create policy via_report on report_pages for select
  using (exists (select 1 from reports r where r.id = report_id
                 and (r.family_id = current_family_id() or is_ops())));

create policy via_report_x on extractions for select
  using (exists (select 1 from reports r where r.id = report_id
                 and (r.family_id = current_family_id() or is_ops())));

create policy via_plan on plan_activities for select
  using (exists (select 1 from plans p where p.id = plan_id
                 and (p.family_id = current_family_id() or is_ops())));

create policy via_finding on finding_citations for select
  using (exists (select 1 from findings f where f.id = finding_id
                 and (f.family_id = current_family_id() or is_ops())));

-- Reference data is world-readable to authenticated users.
alter table skills            enable row level security;
alter table skill_aliases     enable row level security;
alter table scales            enable row level security;
alter table scale_values      enable row level security;
alter table curriculum_topics enable row level security;
alter table resources         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['skills','skill_aliases','scales','scale_values','curriculum_topics','resources'] loop
    execute format('create policy read_all on %I for select using (auth.role() = ''authenticated'')', t);
  end loop;
end $$;

-- profiles and families. current_family_id() and is_ops() are SECURITY
-- DEFINER, so they bypass RLS when reading profiles and cannot recurse.
alter table profiles enable row level security;
alter table families enable row level security;

create policy profiles_read on profiles for select
  using (family_id = current_family_id() or is_ops());

create policy profiles_update_self on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy families_read on families for select
  using (id = current_family_id() or is_ops());

-- Ops-only tables
alter table review_queue enable row level security;
create policy ops_only on review_queue for all using (is_ops()) with check (is_ops());

-- NEW — audit_log is ops-readable only. Writers are always the service role
-- (worker, chat tool dispatch), which bypasses RLS, so no write policy is
-- needed for authenticated users.
alter table audit_log enable row level security;
create policy ops_read on audit_log for select using (is_ops());

-- NEW — llm_request_log is ops-readable only, same reasoning as audit_log:
-- callModel()/callChatModel() run server-side with the service client, which
-- bypasses RLS, so no write policy is needed for authenticated users.
alter table llm_request_log enable row level security;
create policy ops_read on llm_request_log for select using (is_ops());

-- ============================================================
-- SEED — IB EYP four-point scale
-- ============================================================

insert into scales (id, board, description) values
  ('IB_OPCE', 'IB', 'Outstanding / Proficient / Consolidating / Emerging');

insert into scale_values (scale_id, raw_value, normalised, label) values
  ('IB_OPCE','O',1.000,'Outstanding'),
  ('IB_OPCE','P',0.750,'Proficient'),
  ('IB_OPCE','C',0.500,'Consolidating'),
  ('IB_OPCE','E',0.250,'Emerging');
