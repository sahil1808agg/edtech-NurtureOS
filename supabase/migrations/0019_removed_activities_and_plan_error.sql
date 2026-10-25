-- Two gaps in plan regeneration:
--
-- 1. What a parent removed was only remembered by the plan it was removed
--    from (plan_activities.declined). Regeneration read declines off the
--    current plan only, so a removal was forgotten after one cycle — and
--    superseded plans are now deleted on approval (deletePlansSupersededBy),
--    which would erase it outright. removed_activities is the per-child
--    record every future plan is told to avoid. No FK to plan_activities on
--    purpose: it must outlive the plan it came from.
--
-- 2. A failed plan.generate job left no trace the parent could see — the
--    Today card said "updating the plan" forever. children.plan_error is set
--    when the job gives up and cleared on the next successful plan.

create table removed_activities (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  child_id     uuid not null references children(id) on delete cascade,
  title        text not null,
  instructions text not null default '',
  created_at   timestamptz not null default now(),
  unique (child_id, title)
);
create index on removed_activities(child_id);

-- Written only by the service role (activity PATCH route, chat tool, email
-- action), so parents get read access and nothing else.
alter table removed_activities enable row level security;
create policy family_read on removed_activities for select
  using (family_id = current_family_id() or is_ops());

-- Carry over every removal still on record.
insert into removed_activities (family_id, child_id, title, instructions)
select p.family_id, p.child_id, pa.title, pa.instructions
from plan_activities pa
join plans p on p.id = pa.plan_id
where pa.declined
on conflict (child_id, title) do nothing;

alter table children
  add column plan_error    text,
  add column plan_error_at timestamptz;
