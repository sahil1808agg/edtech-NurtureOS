-- Plans are no longer a fixed three activities.
--
-- A plan now covers every domain area its findings touch — academic and
-- non-academic — so the activity count follows the findings rather than a
-- fixed number. `check (position between 1 and 3)` was the third place the
-- old "exactly 3" rule lived, alongside the Zod schema and the plan prompt,
-- and it rejected any activity from position 4 onward.
--
-- The lower bound stays: position is 1-indexed and `unique (plan_id, position)`
-- still keeps the ordering unambiguous.

alter table plan_activities
  drop constraint if exists plan_activities_position_check;

alter table plan_activities
  add constraint plan_activities_position_check check (position >= 1);
