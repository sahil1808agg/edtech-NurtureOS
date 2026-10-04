# Spec 08 — Orchestrator + sub-agent chat architecture

Replaces Feature 4's `chatroute` → `chat` flow (`docs/specs/04-grounded-general-routing.md`)
with a true orchestrator that hands off to three specialized agents, each its own
model call. Decided with the user in conversation:

- **Orchestration style**: true sub-agents via tool-calling, not a routed prompt swap
  — the orchestrator is a reasoning-tier call that can *invoke* an agent as a tool,
  get a result back, and chain to another agent or compose the final reply.
- **Report-analysis agent scope**: synthesizes from already-gated findings when they
  exist; when a report was just uploaded in this conversation and hasn't finished
  processing (or hasn't been reviewed yet), it must still answer usefully rather than
  say nothing — see "The 'not there yet' case" below, which also fixes a pre-existing
  gap in `loadChildContext`.
- **Nearby activities**: in scope now, via the **Google Places API**, anchored on
  `children.city`/`children.pincode` (already captured, no new consent flow needed).

## Why this replaces, not adds to, Spec 04

`chatroute` (small-tier classify) → `chat` (reasoning-tier, one call, all 6 tools,
scope-note swapped by classification) is a routed-prompt design — one agent wearing
three hats. This spec turns each hat into its own agent, each with a narrower prompt
and its own tool list, callable by an orchestrator that can also chain them. `chat.ts`
(today's generic/grounded prompt) becomes the basis for the **generic agent**; nothing
else from Spec 04 survives as-is.

## Architecture

```
parent message
     │
     ▼
ORCHESTRATOR (reasoning tier, callChatModel, tool-calling)
  tools: report_analysis_agent, planning_agent, generic_agent
     │
     ├─ calls report_analysis_agent(question) ──► REPORT AGENT (own callChatModel)
     │                                              tools: edit_finding_statement,
     │                                              exclude_finding, restore_finding,
     │                                              request_report_reanalysis
     │    ◄── structured result + draft text ───────────┘
     │
     ├─ calls planning_agent(question) ──► PLANNING AGENT (own callChatModel)
     │                                       tools: edit_plan_activity,
     │                                       regenerate_plan, find_nearby_resources
     │    ◄── structured result + draft text ──┘
     │
     └─ calls generic_agent(question) ──► GENERIC AGENT (own callChatModel, no tools)
          ◄── draft text ──┘
     │
     ▼
orchestrator composes the final reply from whichever agent(s) it called,
loop continues (max iterations) if it chains a second agent, then persists
```

One parent turn can therefore cost up to 4 model calls (orchestrator + up to 3
agents, though normally just 1) versus today's 2 (`chatroute` + `chat`). This is the
direct, accepted cost of the tool-calling design — flagged explicitly since it's a
real latency/spend increase a parent waits through and the observability dashboard
will show it plainly broken out per stage.

## Stage keys (for `prompts/version.ts`, `logLlmRequest`, observability)

`chatroute` and `chat` are retired. Four new conversational stages, all going
through a `callChatModel`-style path (multi-turn, tool-capable) — **not**
`callModel()`/`STAGE_TIER`, same as today's `chat` already works:

| Stage key | Tier | Tools |
|---|---|---|
| `chat_orchestrator` | reasoning | the 3 agents, as callable tools |
| `chat_report_agent` | reasoning | `edit_finding_statement`, `exclude_finding`, `restore_finding`, `request_report_reanalysis` |
| `chat_planning_agent` | reasoning | `edit_plan_activity`, `regenerate_plan`, `find_nearby_resources` (new) |
| `chat_generic_agent` | reasoning | none |

Each gets its own `LLM_<STAGE>_PROVIDER`/`LLM_MODEL_<STAGE>` override, same
resolution convention as every other stage, defaulting the way `LLM_CHAT_PROVIDER`
does today (openai) unless overridden.

## The orchestrator

`src/server/prompts/chat-orchestrator.ts` (new, replaces `chat-route.ts`). System
prompt: identify what the parent is actually asking for, call the matching agent(s),
then write the reply to the parent using what came back — **the orchestrator writes
the final text the parent sees**, it does not just relay an agent's draft verbatim
(an agent's output is working material, same trust level as a tool result today).

Agent tools, defined like the existing direct-apply tools (`src/server/chat/tools.ts`
pattern) but each `parameters` is just `{ question: string }` — the sub-agent gets
the parent's intent in its own words plus the same `ChildContext` (findings/plan
summary) already loaded once per turn and threaded to every agent, not reloaded per
agent call.

Dispatch: `src/server/chat/orchestrator-dispatch.ts` (new). When the orchestrator
calls `report_analysis_agent`/`planning_agent`/`generic_agent`, this runs the matching
agent's **own** `callChatModel()` turn (its own system prompt, its own tool list, its
own tool-dispatch sub-loop reusing the *existing* `src/server/chat/dispatch.ts`
`dispatchTool()` for the six today's six direct-apply tools, which stays exactly as
written — only `find_nearby_resources` is new there). The agent's result (final text
+ any `audit_log`-worthy writes it made) comes back to the orchestrator as a
`role: 'tool'` message, same mechanics as today's direct-apply tool loop, just one
level deeper.

## Report analysis agent

`src/server/prompts/chat-report-agent.ts` (new). Reads the child's findings and
observations, answers in terms of strengths / gaps / opportunities (reframing
`kind: 'strength' | 'growth'` into that three-part language, not inventing a third
database category). Reuses `getObservations`/`getNarratives` (`db/findings.ts`) when
a specific report is in question, and `getTargetFindings`-equivalent for an
across-reports view.

### The "not there yet" case

Today's `getTargetFindings()` (`db/plans.ts:56`) only reads **published** finding
sets — deliberately, per its own comment, since a draft hasn't been through review.
But `report-analyse.ts`'s existing `postChatUpdate` (Spec 05) already posts a findings
summary into chat the moment analysis finishes, while the finding set is still
`draft`/`in_review` — so there's a pre-existing gap: ask a follow-up question one
turn after that summary, and `loadChildContext` would ground on nothing, contradicting
what the parent was just told. This spec treats that as a bug to fix alongside the
new agent, not new scope:

- New `getFindingsForChat(childId)` in `db/findings.ts`, reading the child's most
  recent **non-rejected** finding set (draft, in_review, or published — excluding
  only `rejected`), same shape as `getTargetFindings`. Used by both `loadChildContext`
  (context.ts) and the report-analysis agent, replacing `getTargetFindings` there.
  `getTargetFindings` itself is untouched and stays published-only for
  **planning** (`plan-generate.ts`, `dispatch.ts`'s `regeneratePlan`) — a plan is a
  bigger, more consequential commitment than a chat answer, and that gate stays.
- If the report has **no finding set at all yet** (just uploaded, pipeline hasn't
  reached `analyse`): the agent checks report status (`getReport`); if it's
  `uploaded`/`extracted`/`normalised` (mid-pipeline, not failed), it replies that
  analysis is in progress rather than guessing — it does **not** independently
  re-derive claims from raw observations, which would bypass `citationGate`/
  `corroborate.ts` entirely. If `report.analyse` was never enqueued at all (shouldn't
  happen via the chat-attachment path, which always enqueues — Spec 02 — but could
  via a stale/orphaned row), it calls `request_report_reanalysis` itself, same as the
  existing tool.
- If the report `failed` or `held`: relay that plainly (same language
  `buildFailureMessageForChat` already uses), don't retry silently.

## Planning agent

`src/server/prompts/chat-planning-agent.ts` (new). Wraps the existing `runPlan()`
pipeline call (`src/server/pipeline/plan.ts`) exactly as `regenerate_plan` does
today (`dispatch.ts:100-147`, unchanged) for the activity-generation half, and adds:

### `find_nearby_resources` (new tool)

```ts
export const FindNearbyResourcesArgs = z.object({
  query: z.string().min(1).max(200),   // e.g. "swimming classes", "library storytime"
});
```

`src/server/places/google-places.ts` (new): given the child's `city`/`pincode`
(`db/plans.ts:getChild` extended to also select these two columns) and the tool's
`query`, calls Google Places **Text Search** (`"<query> near <city> <pincode>"`),
returns up to 5 results (`name`, `address`, `rating` if present, `googleMapsUrl`).
Results are **not persisted** — this is a live lookup per request, not a resource the
family can revisit later via a saved id, unlike the curated `resources` catalog. If
that turns out to matter (a parent wants to come back to a suggested place), caching
becomes a later decision; flagging it rather than deciding it here.

New env var: `GOOGLE_PLACES_API_KEY`, added to `.env.example` under a new
`---------- Google Places (nearby resources) ----------` section.

**Failure handling**: a Places API error (quota, network, bad key) must not fail the
whole turn — `find_nearby_resources` catches and returns a tool result the agent can
relay honestly ("I couldn't look up nearby places right now, but here's a home
activity instead"), falling back to the home-activity half of planning rather than
blocking on the external call.

**No city/pincode on file**: the tool declines gracefully (returns a result saying
so) rather than searching with a blank location — the planning agent then just
doesn't offer nearby options for that turn, home activities still work.

## Generic agent

`src/server/prompts/chat-generic-agent.ts` (new) — the direct continuation of
today's `chat.ts` with `classification: 'general'`: no `ChildContext` grounding
requirement, no tools, ordinary parenting/education advice.

## Audit logging

Unchanged mechanics (`writeAudit` in `dispatch.ts`), but `action` strings now carry
which agent made the call, e.g. `report_agent.edit_finding_statement`,
`planning_agent.edit_plan_activity`, so the audit view (`/review`, Spec 06) can
distinguish them — `entity`/`entity_id`/`payload` shapes are unchanged, so Spec 06's
generic-by-`entity` rendering needs no changes.

## Observability

No schema changes — `llm_request_log.stage` already stores whatever string
`logLlmRequest` is given, and `request_text`/`response_text` already capture full
system/history/response per call, so a 3-4-call turn just shows as 3-4 rows, each
independently attributable. `/observability`'s stage filter dropdown
(`ObservabilityDashboard.tsx`'s hardcoded `STAGES` list) needs its 8 entries updated
to replace `chatroute`/`chat` with the four new stage keys.

## Edge cases

- **Orchestrator calls two agents in one turn** (e.g. "how's she doing, and can you
  suggest an activity for it") — allowed, same `MAX_TOOL_ITERATIONS`-style cap as
  today's direct-apply loop, just counting agent calls instead of direct-apply calls.
- **An agent itself calls a direct-apply tool that fails** (e.g. `NOT_FOUND`) — the
  failure reaches the agent as a tool result exactly like today, the agent decides
  how to tell the parent, and that text becomes what the orchestrator sees as the
  agent's result. No new error shape.
- **Cost**: by default every turn is now priced at 2-4x today's 2-call baseline.
  Worth watching on `/observability` after this ships — if `chat_orchestrator` +
  `chat_generic_agent` (the common "just answer a general question" path) turns out
  to be 2 reasoning-tier calls for something that needs neither classification nor
  an agent hand-off, that's the first place to reconsider the deterministic-branch
  alternative for that one path specifically.
