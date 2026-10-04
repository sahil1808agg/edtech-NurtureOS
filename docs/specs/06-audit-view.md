# Spec 06 — Audit view (ops, read-only)

Implements Feature 6. Repurposes the existing `src/app/review/page.tsx` route; does not delete `ReviewActions.tsx` / `PlanReviewActions.tsx` / the per-report and per-plan review pages, which stay functional for the legacy page surface.

## API route

```
GET /api/audit?entity=finding|plan|report&since=<ISO8601>&limit=50&cursor=<id>
  -> 200 { entries: AuditEntry[], nextCursor: string | null }

  Ops-only: checked via is_ops() the same way review_queue already is — either
  rely on the new audit_log RLS policy (ops_read, in docs/specs/supabase-schema.sql)
  when querying with the user's own session, or explicitly check `user.isOps`
  server-side before querying with the service client. Prefer the former for
  consistency with how review_queue access works today.
```

```ts
export interface AuditEntry {
  id: number;
  actor: string | null;         // profiles.id
  action: string;                // 'chat.edit_finding_statement' | 'chat.regenerate_plan' | 'review.approve' | ...
  entity: 'finding' | 'plan' | 'report';
  entityId: string | null;
  payload: { before?: unknown; after?: unknown; conversationId?: string; messageId?: string; [k: string]: unknown } | null;
  createdAt: string;
}
```

## Page

`src/app/review/page.tsx` — replace the current `review_queue` listing + `ReviewActions`/`PlanReviewActions` rendering with:

- A filter bar (entity type, date range).
- A reverse-chronological list of `AuditEntry` rows, each showing `action`, `actor` (resolved to a display name via `profiles.full_name`), and a before/after diff rendered with the same visual treatment as the legacy finding/plan cards (reuse, don't reinvent — see `EditableFinding.tsx`'s before/after display for the pattern).
- No action buttons — this view is read-only by design (§0/§7 of the engineering doc: there is nothing left to approve before the fact for chat-originated changes).

The legacy `/review/[id]` and `/review/plan/[id]` pages (with their approve/reject actions) remain reachable and functional, unchanged, for any artifact still going through the legacy `review_queue` path.

## Edge cases

- `audit_log.action` values from chat (`chat.*`, per Spec 03) and from the legacy approval flow (e.g. `review.approve`, if that's the existing action string — confirm against `src/app/api/review/[id]/decision/route.ts` before hardcoding) have different `payload` shapes. The feed renders generically keyed on `entity` rather than assuming one payload shape, so both producers display without a crash.
- `entity_id` can be null for actions not tied to one row (none currently defined, but the column allows it) — the UI shows the action/actor/timestamp without a diff in that case rather than erroring.
