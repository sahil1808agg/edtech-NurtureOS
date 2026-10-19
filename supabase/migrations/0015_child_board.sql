-- Lets the profile agent (chat-profile-agent.ts) record a child's curriculum
-- board. Same vocabulary as schools.board, since children.school_id is never
-- actually populated by any flow — this is simpler than wiring up the unused
-- schools relation for one field.

alter table children
  add column board text check (board is null or board in ('IB', 'CBSE', 'CAIE', 'CISCE', 'STATE'));
