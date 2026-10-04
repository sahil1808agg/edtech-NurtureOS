


# NurtureOS — Implementation Specs: Chat-Primary Pivot

Source: `docs/engineering/engineering-doc.md` (Revision 2). Six features, each a complete vertical slice. Backend pipeline/model/gate/schema pieces referenced here are **existing and reused as-is** unless marked NEW — see the engineering doc §3–§5 for what's new vs. kept.

---

## Feature 1 — Chat conversation thread (core UI)

### User flow
Parent signs in → lands on a child picker (if >1 child) → opens that child's single, persistent conversation → sees prior messages (findings summaries, plan updates, their own questions) → types a message or attaches a file → sees the assistant's reply stream in, with citations rendered inline where present.

### DB schema (NEW)
```sql
create table conversations (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  child_id    uuid not null references children(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (child_id)  -- one conversation per child
);

create type message_role as enum ('user','assistant','system');
create type message_status as enum ('pending','complete');

create table messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references conversations(id) on delete cascade,
  family_id           uuid not null references families(id) on delete cascade,
  role                message_role not null,
  content             text not null default '',
  tool_calls          jsonb,
  tool_results        jsonb,
  attachment_report_id uuid references reports(id),
  status              message_status not null default 'complete',
  prompt_version       text,
  model_deployment     text,
  created_at          timestamptz not null default now()
);
create index on messages(conversation_id, created_at);

alter table conversations enable row level security;
alter table messages enable row level security;
create policy family_read on conversations for select using (family_id = current_family_id() or is_ops());
create policy family_write on conversations for all using (family_id = current_family_id()) with check (family_id = current_family_id());
create policy family_read on messages for select using (family_id = current_family_id() or is_ops());
create policy family_write on messages for all using (family_id = current_family_id()) with check (family_id = current_family_id());
```

### DB tasks
- Migration file under `supabase/migrations/` creating the above, following the existing migration style (check `supabase/migrations/` for the current head before writing).
- `src/server/db/conversations.ts` — `getOrCreateConversation(childId)`, reusing the `children`-ownership check pattern from `src/app/api/reports/route.ts`.
- `src/server/db/messages.ts` — `appendMessage(conversationId, role, content, extra)`, `listMessages(conversationId, cursor)`, `updateMessage(id, patch)` (for placeholder → complete transitions).

### API routes (NEW)
```
GET    /api/children/:id/chat                  -> conversation + recent messages (creates conversation if absent)
POST   /api/children/:id/chat/messages         -> { content } ; runs route→respond, may trigger tool calls, returns assistant message
POST   /api/children/:id/chat/attachments      -> multipart { file } ; see Feature 2
```
Auth/ownership check is the same `children` row lookup already used in `src/app/api/reports/route.ts` (`.eq('family_id', user.familyId)`) — reused, not reimplemented.

### State management
Client: a per-child chat store (messages array, pending-send flag). On send, optimistically append the user message, POST, then append/replace with the response. Subscribe to Supabase Realtime on `messages` filtered by `conversation_id` so worker-driven updates (Feature 5) land without polling.

### Component spec
- `src/app/(chat)/[childId]/page.tsx` — server component, loads initial messages.
- `src/app/(chat)/[childId]/ChatThread.tsx` — client component: message list, citation rendering (click a citation → same source-viewer behavior as `SourceViewer.tsx`, reused), composer with attach button.
- `src/app/(chat)/ChildPicker.tsx` — only rendered when the family has >1 child.

### Design
Follow `docs/design.md` per the `/design-system` rule in `CLAUDE.md` for all colors/spacing/type — no new design tokens introduced here.

### Edge cases
- First-ever message for a child with no reports yet → assistant should prompt for a report attachment rather than inventing findings.
- Message sent while a `pending` placeholder from a prior attachment is still unresolved → allowed; the thread can have multiple concurrent pending items.
- Realtime disconnect → client falls back to polling `GET /api/children/:id/chat` on reconnect, de-duping by message id.

---

## Feature 2 — Report upload as a chat attachment

### User flow
Parent attaches a PDF/photo to a chat message (with or without accompanying text) → sees an immediate "Looking at this report now…" message → continues chatting if they want → the placeholder updates in place with a findings summary once processing finishes (Feature 5).

### DB schema
No new tables — uses existing `reports` + new `messages.attachment_report_id`.

### DB tasks
- Extract the body of `src/app/api/reports/route.ts` (consent check, validation, storage write, `reports` insert, `enqueue('report.extract', ...)`) into a shared `src/server/reports/ingest.ts` function, `ingestReport(childId, file, meta)`, called by both the legacy route and the new attachment route. No behavior change to the legacy route.

### API routes
```
POST /api/children/:id/chat/attachments   multipart { file } -> calls ingestReport, inserts pending message, returns it
```
Same `ACCEPTED` types / `MAX_BYTES` / consent-gate behavior as today — reused constants, not redefined.

### State management
Same chat store as Feature 1; an attachment send follows the same optimistic-append pattern, with `status: 'pending'` shown as a distinct message style (spinner/skeleton) until updated.

### Component spec
`ChatThread.tsx` attach button → file picker → same accepted-type/size validation client-side as `UploadForm.tsx` today (reuse that validation logic rather than rewriting it).

### Design
Pending message renders as a distinct, lower-emphasis bubble (see `docs/design.md` for the "system/status" message style, or extend it there first if it doesn't exist).

### Edge cases
- Unsupported file type / oversized file → reject client-side with the same messages `UploadForm.tsx` already shows; no network round-trip.
- No live consent for the child → `ingestReport` throws `ConsentError` exactly as today; chat shows that message inline rather than a generic error.
- Two attachments for the same child in quick succession → both enqueue independently; two pending messages, resolved independently.

---

## Feature 3 — Chat-driven direct-apply edits (tool-calling + audit)

### User flow
Parent: "Can you drop the handwriting activity and make it more about reading instead?" → assistant calls `edit_plan_activity`, writes the change, replies confirming what changed — no separate approval step.

### DB schema
No new tables. Uses existing `findings`, `plan_activities`, and existing `audit_log` (`actor`, `action`, `entity`, `entity_id`, `payload`).

### DB tasks
- `src/server/chat/tools.ts` (NEW) — the tool allowlist and their JSON schemas (see engineering doc §3 table): `edit_finding_statement`, `exclude_finding`, `restore_finding`, `edit_plan_activity`, `regenerate_plan`, `request_report_reanalysis`.
- `src/server/chat/dispatch.ts` (NEW) — given a tool call from the model, validates args against the schema, calls the existing `src/server/db/findings.ts` / `src/server/db/plans.ts` function, then writes one `audit_log` row with before/after state, `conversation_id`, `message_id`.
- No changes to `findings`/`plan_activities` write functions themselves — they're called exactly as the legacy pages call them today.

### API routes
Tool dispatch happens inside `POST /api/children/:id/chat/messages` (Feature 1) — not a separate route. No new endpoint.

### State management
Assistant's reply includes a short structured summary of what changed (e.g. "Updated activity 2: …") rendered distinctly from free text, so the parent can see at a glance that a write happened, without a confirm/approve step blocking it.

### Component spec
`ChatThread.tsx` renders a "change" message sub-type (diff-style: before → after) for any assistant message with non-empty `tool_results`.

### Design
Use `docs/design.md`'s existing "finding/plan card" visual treatment (from the legacy pages) for the before/after summary, so a chat-rendered change looks recognizably like the same data the legacy pages show.

### Edge cases
- Model calls a tool with an id that doesn't belong to this child/family → dispatch rejects before touching the DB (same family-scoping check pattern as every other route) and the assistant surfaces "I couldn't find that" rather than a raw error.
- Model calls `regenerate_plan` when no findings exist yet → tool returns a typed error the model can relay ("there's nothing to plan from yet").
- Two tool calls in the same model turn targeting the same row → executed sequentially, last write wins, both still audited individually.
- Rate limiting is explicitly **not** in this slice — flagged as engineering-doc §10 open item 3, to close before production use with real families.

---

## Feature 4 — Grounded vs. general-advice routing

### User flow
Parent asks either "Why did his handwriting grade drop?" (grounded) or "How do I make reading fun for a 7-year-old?" (general) or both in one message. The reply treats the two differently: the first carries citations back to the child's data, the second doesn't and isn't expected to.

### DB schema
None.

### DB tasks
None — this is prompt/routing logic, not storage.

### API routes
Internal to `POST /api/children/:id/chat/messages` — two LLM calls per turn: `chat-route.ts` (classify) then `chat.ts` (respond), both via the new chat-capable client (engineering doc §3).

### State management
The classifier's output (`grounded` | `general` | `mixed`) is stored on the assistant `messages` row (in `tool_results` or a dedicated column, Stage-2 to decide) purely for debugging/audit — not surfaced to the parent as UI chrome.

### Component spec
`ChatThread.tsx` renders citation chips inline wherever the assistant response includes them (reusing the citation-click-through behavior from `EditableFinding.tsx`/`SourceViewer.tsx`), and renders general-advice text with no chip — the distinction is visual, not a separate message.

### Design
Citation chip style carried over unchanged from the legacy findings page.

### Edge cases
- Classifier says "grounded" but the respond step can't find a citation for a claim it's about to make → same honesty-path behavior as `src/server/gates/citation.ts` (drop/soften the claim rather than asserting ungrounded) — this gate is reused for chat as described in engineering doc §3, not bypassed.
- Mixed question where the grounded part depends on a report still processing → reply should say so explicitly rather than guessing, and the pending placeholder (Feature 5) is what resolves it once ready.

---

## Feature 5 — Pipeline progress surfaced as a live chat update

### User flow
Already covered end-to-end in Feature 2's flow; this feature is the worker-side half — making `report.analyse` (and `plan.generate`) completion show up in an already-open chat tab without a page reload.

### DB schema
None beyond Feature 1's `messages.status`.

### DB tasks
- In `src/server/queue/jobs/report-analyse.ts` (existing), after publishing findings, add one write: update the matching `pending` message (by `attachment_report_id`) to `status: 'complete'` with a findings summary in `content`, or insert a follow-up message if none exists (legacy-page-only report).
- Equivalent small addition in `plan-generate.ts` for `regenerate_plan`/plan-cycle completions that were enqueued rather than run inline.

### API routes
None — this is a DB write from the worker; delivery to the client is Supabase Realtime, not a route.

### State management
Client subscribes (Feature 1) to `postgres_changes` on `messages` for the open `conversation_id`; on an `UPDATE` or `INSERT` event, merges it into the local message list by id.

### Component spec
No new component — `ChatThread.tsx`'s existing pending-message rendering (Feature 2) is what changes state when this event arrives.

### Design
N/A — same message bubble, state transition only.

### Edge cases
- Worker finishes while the parent has the tab closed → message is simply `complete` in the DB already when they next open the thread; no missed-event handling needed since Realtime is additive to an initial `GET`.
- Worker job fails (`status: 'failed'` or `'held'` on the `reports` row, both existing states) → the placeholder message should update to reflect that plainly ("couldn't find enough to go on in this report") rather than hanging as `pending` forever.

---

## Feature 6 — Audit view (ops, read-only)

### User flow
Ops account signs in, opens the audit view, sees a chronological feed of every chat-originated write (and, separately, legacy-page approvals) with before/after state — for sampling and quality oversight, no actions available.

### DB schema
None — reads existing `audit_log`.

### DB tasks
None beyond what Feature 3 already writes.

### API routes
```
GET /api/audit?entity=&since=&limit=     ops-only, reuses the is_ops() RLS pattern already on review_queue
```

### State management
Simple paginated fetch, filterable by entity type and date range — no realtime requirement for this one.

### Component spec
`src/app/review/page.tsx` (existing route, repurposed) — replace the current `review_queue` listing + approve/reject actions with a read-only `audit_log` feed; `ReviewActions.tsx`/`PlanReviewActions.tsx` are removed from this page's render path but not deleted from the codebase (the legacy per-report/per-plan review pages that still use them stay functional for the legacy surface).

### Design
Table/feed layout — no new visual language needed, this is strictly read-only data display.

### Edge cases
- `audit_log.payload` for a legacy-page approval looks structurally different from a chat tool-call payload (different `action` values) — the feed should handle both without assuming one shape, since both producers write to the same table.
