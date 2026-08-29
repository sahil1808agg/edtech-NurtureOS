-- NurtureOS — MVP schema
-- Postgres / Supabase. Run in the SQL editor.
-- Every family-scoped table carries family_id and an RLS policy keyed to auth.uid().

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

-- Cross-scale comparison is invalid. Trajectories are only computed within a
-- single scale_id; a scale change is recorded and excluded from delta claims.

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

-- The cross-board mapping layer. Retrofitting this is expensive — build it first.
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
  term_label                text,                    -- 'T3'
  term_index                int,                     -- 3
  academic_year             text,                    -- '2025-26'
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

create table extractions (
  id                uuid primary key default gen_random_uuid(),
  report_id         uuid not null references reports(id) on delete cascade,
  page_no           int  not null,
  raw_json          jsonb not null,
  min_confidence    numeric(4,3),
  model_deployment  text not null,
  prompt_version    text not null,
  latency_ms        int,
  created_at        timestamptz not null default now(),
  unique (report_id, page_no)
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
  is_ambiguous boolean not null default false,   -- dash / blank / not assessed
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

create table findings (
  id                   uuid primary key default gen_random_uuid(),
  finding_set_id       uuid not null references finding_sets(id) on delete cascade,
  family_id            uuid not null references families(id) on delete cascade,
  kind                 finding_kind not null,
  statement            text not null,
  corroboration_status corroboration not null,
  corroboration_quote  text,
  position             int not null,
  created_at           timestamptz not null default now()
);
create index on findings(finding_set_id);

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

create table curriculum_topics (
  id         uuid primary key default gen_random_uuid(),
  board      text not null,
  programme  text,
  grade      text not null,
  month      int  not null check (month between 1 and 12),
  topic      text not null,
  unit_title text,
  unique (board, programme, grade, month, topic)
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

create table plan_activities (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             uuid not null references plans(id) on delete cascade,
  position            int  not null check (position between 1 and 3),
  kind                activity_kind not null,
  title               text not null,
  instructions        text not null,
  addresses_finding_id uuid not null references findings(id),
  resource_id         uuid references resources(id),
  declined            boolean not null default false,
  unique (plan_id, position)
);

create table checkins (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  plan_id      uuid not null references plans(id) on delete cascade,
  token_hash   text not null unique,
  sent_at      timestamptz,
  responded_at timestamptz,
  activities_done int,
  response_note   text,
  concern_raised  boolean not null default false,
  decision     checkin_decision,
  expires_at   timestamptz not null
);
create index on checkins(plan_id);

-- ============================================================
-- OPS AND EVALUATION
-- ============================================================

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
  case_label   text,                  -- 'thin_report' | 'conflicting_narrative' | ...
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
  id               uuid primary key default gen_random_uuid(),
  git_sha          text,
  prompt_versions  jsonb not null,
  model_deployments jsonb not null,
  results          jsonb not null,
  passed           boolean not null,
  created_at       timestamptz not null default now()
);

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
    'finding_sets','findings','parent_finding_responses','plans','checkins'
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

-- family_constraints is keyed on family_id directly
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

-- Ops-only tables
alter table review_queue enable row level security;
create policy ops_only on review_queue for all using (is_ops()) with check (is_ops());

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
