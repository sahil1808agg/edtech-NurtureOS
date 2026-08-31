-- curriculum_topics originally modelled a month-by-month school calendar
-- (month int not null, grade not null). The authoritative published curriculum
-- source — the IB PYP scope and sequence — is organised by developmental PHASE
-- (1-4) and STRAND, not by calendar month, and deliberately so: PYP is
-- inquiry-led and each school sequences its own units.
--
-- This relaxes the table to hold both shapes:
--   * framework rows  — phase/strand set, month/grade null
--   * school calendar rows — month/grade set, phase/strand null
-- Neither is derivable from the other, so both are first-class.

alter table curriculum_topics alter column month drop not null;
alter table curriculum_topics alter column grade drop not null;

alter table curriculum_topics add column if not exists phase  int check (phase between 1 and 4);
alter table curriculum_topics add column if not exists strand text;
-- Which part of the PYP continuum this outcome sits in: 'conceptual_understandings',
-- 'constructing_meaning', 'transferring_meaning_into_symbols', 'applying_with_understanding'.
alter table curriculum_topics add column if not exists stage  text;
alter table curriculum_topics add column if not exists source text;

-- A row must be one shape or the other, never a half-populated hybrid.
alter table curriculum_topics drop constraint if exists curriculum_topics_shape_check;
alter table curriculum_topics add constraint curriculum_topics_shape_check
  check (
    (phase is not null and strand is not null and month is null)
    or (month is not null and phase is null)
  );

-- The old unique(board, programme, grade, month, topic) cannot work once month
-- and grade are nullable — Postgres treats NULLs as distinct, so it would stop
-- blocking duplicates. Replaced with a coalesced expression index covering both shapes.
do $$
declare v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'curriculum_topics'::regclass and contype = 'u';
  if v_constraint is not null then
    execute format('alter table curriculum_topics drop constraint %I', v_constraint);
  end if;
end $$;

create unique index if not exists curriculum_topics_unique_idx
  on curriculum_topics (
    board,
    coalesce(programme, ''),
    coalesce(grade, ''),
    coalesce(month, 0),
    coalesce(phase, 0),
    coalesce(strand, ''),
    coalesce(stage, ''),
    topic
  );
