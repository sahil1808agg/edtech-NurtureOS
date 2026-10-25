-- A plan is the full set of activities for the next two weeks; Today is the
-- handful scheduled for one day. Until now Today was simply "every activity
-- not yet done", so the two read as the same list.
--
-- plan_activity_days is the day-by-day schedule (written by the plan.schedule
-- model call, or an even-spread fallback — see pipeline/plan-schedule.ts):
-- one row per activity per day it's scheduled. Done / Not today act on a
-- single day's row, so ticking off Monday's reading doesn't hide Thursday's.
-- Remove still acts on the whole activity (plan_activities.declined).

create table plan_activity_days (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references plans(id) on delete cascade,
  activity_id uuid not null references plan_activities(id) on delete cascade,
  family_id   uuid not null references families(id) on delete cascade,
  child_id    uuid not null references children(id) on delete cascade,
  day         date not null,
  status      text not null default 'todo' check (status in ('todo', 'done', 'skipped')),
  updated_at  timestamptz not null default now(),
  unique (activity_id, day)
);
create index on plan_activity_days(child_id, day);
create index on plan_activity_days(plan_id);

-- Written only by the service role (activity routes, email action, plan jobs).
alter table plan_activity_days enable row level security;
create policy family_read on plan_activity_days for select
  using (family_id = current_family_id() or is_ops());
