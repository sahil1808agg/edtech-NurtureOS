-- A parent can correct a finding before approving it. They know the child, so
-- their wording is usually better than ours — but the model's original must
-- survive, because "we said X and the parent changed it to Y" is the strongest
-- evaluation signal this product produces, and overwriting it destroys that.
--
-- excluded lets them drop a finding they do not want acted on without
-- rejecting the whole set, and without deleting a row that citations and, later,
-- plan activities may reference.

alter table findings add column if not exists original_statement text;
alter table findings add column if not exists edited_at         timestamptz;
alter table findings add column if not exists edited_by         uuid references profiles(id);
alter table findings add column if not exists excluded          boolean not null default false;

comment on column findings.original_statement is
  'What the model wrote, kept when a parent edits the statement. Null means unedited.';
comment on column findings.excluded is
  'Parent dropped this finding: not shown after publishing, and never used to build a plan.';
