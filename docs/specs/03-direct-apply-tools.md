# Spec 03 — Chat-driven direct-apply edits (tool-calling + audit)

Implements Feature 3. No new write paths to the database — every tool calls an existing `src/server/db/*.ts` function. The only new write is one `audit_log` row per tool call.

## Tool schemas (Zod — passed to the model as JSON-schema via the chat client, validated again on the way back)

```ts
// src/server/chat/tools.ts
import { z } from 'zod';

export const EditFindingStatementArgs = z.object({
  findingId: z.string().uuid(),
  newStatement: z.string().min(1).max(500),
});

export const ExcludeFindingArgs = z.object({ findingId: z.string().uuid() });
export const RestoreFindingArgs  = z.object({ findingId: z.string().uuid() });

export const EditPlanActivityArgs = z.object({
  activityId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  instructions: z.string().min(1).max(2000).optional(),
  declined: z.boolean().optional(),
}).refine(a => a.title || a.instructions || a.declined !== undefined, 'at least one field to change');

export const RegeneratePlanArgs = z.object({ childId: z.string().uuid() });
export const RequestReportReanalysisArgs = z.object({ reportId: z.string().uuid() });

export const TOOL_DEFINITIONS = [
  { name: 'edit_finding_statement', description: "Reword a finding's statement. The model's original wording is preserved.", schema: EditFindingStatementArgs },
  { name: 'exclude_finding',        description: 'Drop a finding from the active set; it stops being used for plans.', schema: ExcludeFindingArgs },
  { name: 'restore_finding',        description: 'Bring a previously excluded finding back into the active set.', schema: RestoreFindingArgs },
  { name: 'edit_plan_activity',     description: "Change an activity's title/instructions, or mark it declined.", schema: EditPlanActivityArgs },
  { name: 'regenerate_plan',        description: "Re-run plan generation for the child's current active findings.", schema: RegeneratePlanArgs },
  { name: 'request_report_reanalysis', description: 'Re-run finding analysis for a report (queues; does not block the reply).', schema: RequestReportReanalysisArgs },
] as const;
```

## Dispatch

```ts
// src/server/chat/dispatch.ts
export interface ToolDispatchContext {
  familyId: string;
  childId: string;
  conversationId: string;
  messageId: string;
  actorProfileId: string;      // the parent's own profile id — audit actor
}

export interface ToolDispatchResult {
  ok: boolean;
  summary: string;              // short human-readable description, relayed to the model for its reply
  before?: unknown;
  after?: unknown;
  error?: { code: string; message: string };
}

export async function dispatchTool(
  name: string, rawArgs: unknown, ctx: ToolDispatchContext,
): Promise<ToolDispatchResult>;
```

`dispatchTool` for each tool:

1. Validates `rawArgs` against the matching Zod schema in `TOOL_DEFINITIONS` — a validation failure returns `{ ok: false, error: { code: 'INVALID_ARGS', ... } }`, never touches the DB.
2. Re-checks ownership: the target row (`finding`/`plan_activity`/`report`) must belong to `ctx.familyId` — same `family_id` equality check every other route already does, now done in code rather than relying on RLS alone (defense in depth, since this path may use the service client).
3. Calls the existing function:
   - `edit_finding_statement` / `exclude_finding` / `restore_finding` → `src/server/db/findings.ts` (same functions `EditableFinding.tsx`'s `PATCH /api/findings/[id]` already calls).
   - `edit_plan_activity` → `src/server/db/plans.ts` (same function the legacy plan page uses).
   - `regenerate_plan` → calls `src/server/pipeline/plan.ts` directly (in-process, not queued — see engineering doc §2/§3) and writes the result with `status: 'approved'` directly (no `review_queue` insert).
   - `request_report_reanalysis` → `src/server/queue/enqueue.ts` (`enqueue('report.analyse', { reportId })`) — this one queues, same as the pipeline always has.
4. On success, inserts one row:

```ts
await admin.from('audit_log').insert({
  actor: ctx.actorProfileId,
  action: `chat.${name}`,
  entity: name.includes('finding') ? 'finding' : name.includes('plan') ? 'plan' : 'report',
  entity_id: /* the affected row's id */,
  payload: { before, after, conversationId: ctx.conversationId, messageId: ctx.messageId },
});
```

5. Returns `{ ok: true, summary, before, after }`; the chat orchestration loop (Spec 04) relays `summary` back to the model so it can describe the change in its reply, and stores `toolResults` on the assistant `messages` row.

## Edge cases

- Target id not found or not owned by `ctx.familyId` → `{ ok: false, error: { code: 'NOT_FOUND', ... } }`; model relays "I couldn't find that" rather than a raw DB error.
- `regenerate_plan` called with zero active (non-excluded) findings → `src/server/pipeline/plan.ts` is expected to already handle "nothing to plan from"; dispatch relays that typed result rather than treating it as a failure.
- Multiple tool calls in one model turn → `dispatchTool` is called once per tool call, sequentially, each producing its own `audit_log` row — no batching, so partial success (call 1 ok, call 2 fails) is visible and auditable per-call.
