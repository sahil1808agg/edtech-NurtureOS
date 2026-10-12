-- messages.attachment_report_id had no ON DELETE action, so it defaulted to
-- NO ACTION. Deleting a child cascades to delete its reports (reports.child_id
-- is ON DELETE CASCADE), but Postgres checks that FK immediately per row and
-- found messages still pointing at the report being removed — even though
-- those same messages were about to be cascade-deleted themselves via
-- conversations -> messages. Set null instead: a message survives, it just
-- loses the link to an attachment that no longer exists.
alter table messages drop constraint messages_attachment_report_id_fkey;
alter table messages
  add constraint messages_attachment_report_id_fkey
  foreign key (attachment_report_id) references reports(id) on delete set null;
