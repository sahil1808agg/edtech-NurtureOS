-- The daily plan-task digest ships default-on for every family with a ready
-- plan (no opt-in gate — see src/server/queue/jobs/daily-digest.ts), so this
-- is the compensating control: a one-click unsubscribe link in every email
-- flips this flag directly, no login required.

alter table profiles
  add column email_opt_out boolean not null default false;
