-- Lets a parent mark a plan activity done, carry it to tomorrow (the child
-- was busy), or remove it altogether from the Today card / plan page.
-- snoozed_until is a plain calendar date — no timezone concept exists
-- anywhere in this schema, so "today"/"tomorrow" is a server-date
-- comparison, same granularity as everything else here.

alter table plan_activities
  add column completed     boolean not null default false,
  add column completed_at  timestamptz,
  add column snoozed_until date;
