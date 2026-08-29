# NurtureOS — Low Level Design

**Source:** `docs/engineering/engineering-doc.md`, `docs/PRD.md`
**Scope:** MVP path end to end — upload → findings → review → plan → check-in
**Schema:** `docs/specs/supabase-schema.sql`
**Last updated:** 23 August 2026

Out of scope here: local options (C12), classify (C1), extraction retry, trajectory across reports, conference prep. All MVP 1 or later.

---

## 1. Stage contracts

Every pipeline stage is a pure function from a typed input to a typed output, wrapped by a job that persists the result. Stages never call each other directly — the queue sequences them.

```ts
// src/server/pipeline/types.ts

export type StageResult<T> =
  | { ok: true; value: T; meta: CallMeta }
  | { ok: false; error: StageError; meta?: CallMeta };

export interface CallMeta {
  promptVersion: string;      // 'analyse-record:12'
  modelDeployment: string;    // 'gpt-4.1-prod'
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export type StageError =
  | { code: 'SCHEMA_INVALID'; detail: string }
  | { code: 'LOW_CONFIDENCE'; field: string; confidence: number }
  | { code: 'UNKNOWN_TEMPLATE' }
  | { code: 'SEN_DETECTED' }
  | { code: 'PROVIDER_ERROR'; status: number; retryable: boolean }
  | { code: 'TIMEOUT' };
```

### Extract — one page

```ts
export interface ExtractInput {
  reportId: string;
  pageNo: number;
  imageUrl: string;          // signed, short TTL
  layout: DocIntelligenceLayout;  // pre-pass output
}

export interface ExtractedCell {
  rawLabel: string;          // 'Solve simple story sums based on real-life situations'
  section: string | null;    // 'Number'
  subject: string;           // 'Mathematics'
  values: Array<{ termIndex: number; rawValue: string | null }>;
  sourceRef: { page: number; table: number; row: number; cell: number };
  confidence: number;
}

export interface ExtractOutput {
  cells: ExtractedCell[];
  narratives: Array<{ subject: string | null; text: string; sourceRef: SourceRef }>;
  scaleHint: string | null;  // 'IB_OPCE'
  senIndicators: string[];   // non-empty triggers the decline path
}
```

**Why Document Intelligence runs first:** it returns table geometry deterministically. The vision model is then asked to label cells within a known grid rather than to find the grid — which is where most extraction error comes from on a 14-page criterion report.

**`rawValue: null` is meaningful.** It encodes a dash or blank and must survive into `observations.is_ambiguous`. Losing it here silently manufactures regressions downstream.

### Normalise

```ts
export interface NormaliseInput {
  reportId: string;
  cells: ExtractedCell[];
  board: string;
  programme: string | null;
  scaleId: string;
}

export interface NormaliseOutput {
  observations: Array<{
    skillId: string | null;    // null when no alias matches — logged, not guessed
    rawLabel: string;
    termIndex: number;
    rawValue: string | null;
    normalised: number | null;
    isAmbiguous: boolean;
    sourceRef: SourceRef;
    confidence: number;
  }>;
  unmappedLabels: string[];    // feeds skill_aliases curation
}
```

**Order of resolution** — cheapest first, model last:

1. Exact match on `skill_aliases (board, programme, raw_label)`.
2. Normalised-string match (lowercase, punctuation stripped).
3. Model call, constrained to return a `skill.code` from a supplied candidate list or `null`.

Steps 1 and 2 handle the overwhelming majority once the alias table is seeded, so this stage becomes near-deterministic as coverage grows. Every step-3 resolution is written back to `skill_aliases` after review.

### Analyse

```ts
export interface AnalyseInput {
  childId: string;
  reportId: string;
  observations: ObservationRow[];   // includes ids — the model must cite them
  narrativesAvailable: boolean;     // narratives are NOT passed here
}

export interface CandidateClaim {
  kind: 'strength' | 'growth';
  statement: string;
  citedObservationIds: string[];    // must be ids from the input
  reasoning: string;                // logged, never shown to the parent
}

export interface AnalyseOutput {
  claims: CandidateClaim[];         // 0..5
  insufficientEvidence: boolean;
}
```

**Narratives are deliberately withheld from Analyse.** If Analyse sees the teacher's words it will echo them, and Corroborate then "confirms" a claim derived from the same text. Independence is only real if the two stages see different inputs.

### Corroborate — one claim

```ts
export interface CorroborateInput {
  claimStatement: string;           // the claim only
  narratives: Array<{ id: string; subject: string | null; text: string }>;
  // no observations, no reasoning, no other claims
}

export interface CorroborateOutput {
  verdict: 'corroborated' | 'not_mentioned' | 'conflicting';
  quote: string | null;             // must be a verbatim substring of a narrative
  narrativeId: string | null;
}
```

**Validation:** if `quote` is not a literal substring of the referenced narrative, the verdict is downgraded to `not_mentioned` and the call is logged as a quote violation. This is checked in code, not trusted from the model.

### Plan synthesis

```ts
export interface PlanInput {
  childAgeMonths: number;
  targetFindings: Array<{ id: string; statement: string }>;  // max 2
  constraints: FamilyConstraints;
  topicContext: string | null;      // from curriculum_topics lookup
  resourceCandidates: Resource[];   // pre-filtered by skill + age; model may not name others
  priorFailures: Array<{ title: string; reason: string | null }>;
}

export interface PlanOutput {
  activities: Array<{
    kind: 'home' | 'resource';
    title: string;
    instructions: string;
    addressesFindingId: string;     // must be one of targetFindings
    resourceId: string | null;      // must be one of resourceCandidates
  }>;                               // exactly 3
}
```

Resource candidates are passed as data. The model selects an id; it never writes a title or a URL.

---

## 2. Gates

`src/server/gates/` — no model calls, by construction.

### Citation gate

```ts
export async function citationGate(
  reportId: string,
  claims: CandidateClaim[]
): Promise<{ kept: CandidateClaim[]; dropped: DroppedClaim[] }> {
  const valid = new Set(
    await db.query<string>(
      `select id::text from observations where report_id = $1`, [reportId]
    )
  );
  const kept: CandidateClaim[] = [];
  const dropped: DroppedClaim[] = [];

  for (const c of claims) {
    const unresolved = c.citedObservationIds.filter(id => !valid.has(id));
    if (unresolved.length > 0 || c.citedObservationIds.length === 0) {
      dropped.push({ claim: c, reason: 'UNRESOLVED_CITATION', unresolved });
    } else {
      kept.push(c);
    }
  }
  return { kept, dropped };
}
```

Dropped claims are written to `audit_log`, never rendered. A claim with zero citations is dropped for the same reason as one with a bad citation.

### Sufficiency gate

```ts
export const SUFFICIENCY = {
  minObservations: 25,
  minNonAmbiguousRatio: 0.5,
  minNarrativeChars: 200,
} as const;

export function sufficiencyGate(obs: ObservationRow[], narrativeChars: number) {
  const total = obs.length;
  const solid = obs.filter(o => !o.isAmbiguous && o.normalised !== null).length;
  const pass =
    total >= SUFFICIENCY.minObservations &&
    solid / Math.max(total, 1) >= SUFFICIENCY.minNonAmbiguousRatio &&
    narrativeChars >= SUFFICIENCY.minNarrativeChars;
  return { pass, total, solid, narrativeChars };
}
```

Failure sets `finding_sets.honesty_path = true` and emits static text plus three fixed teacher questions. No model runs.

### Trajectory and ambiguity

```ts
export interface Trajectory {
  skillId: string;
  scaleId: string;
  points: Array<{ termIndex: number; value: number | null; ambiguous: boolean }>;
  reportable: boolean;
  delta: number | null;
}

export function buildTrajectory(rows: ObservationRow[]): Trajectory {
  const points = rows.sort((a, b) => a.termIndex - b.termIndex)
    .map(r => ({ termIndex: r.termIndex, value: r.normalised, ambiguous: r.isAmbiguous }));

  const sameScale = new Set(rows.map(r => r.scaleId)).size === 1;
  const solid = points.filter(p => !p.ambiguous && p.value !== null);
  const reportable = sameScale && solid.length >= 2 && !points.some(p => p.ambiguous);

  return {
    skillId: rows[0].skillId,
    scaleId: rows[0].scaleId,
    points,
    reportable,
    delta: reportable ? solid[solid.length - 1].value! - solid[0].value! : null,
  };
}
```

**Three rules encoded here.** A trajectory containing any ambiguous point is not reportable as change. A trajectory spanning two scales is never reportable — a 0.75 on an IB scale and a 0.75 on a percentage scale are not comparable. And a single point is a value, not a trend.

---

## 3. Jobs

`pg-boss`, one queue per stage. Idempotency key `(report_id, stage)` or `(claim_id, stage)`.

| Job | Retries | Backoff | Concurrency | Timeout |
|---|---|---|---|---|
| `report.split` | 2 | 5s | 4 | 30s |
| `page.extract` | 3 | 10s exp | 6 | 120s |
| `report.normalise` | 2 | 10s | 2 | 90s |
| `report.analyse` | 2 | 15s | 2 | 120s |
| `claim.corroborate` | 3 | 5s | 8 | 45s |
| `report.gate` | 0 | — | 4 | 10s |
| `plan.generate` | 2 | 15s | 2 | 120s |
| `checkin.send` | 5 | 60s exp | 4 | 30s |

**Fan-in.** `page.extract` completions decrement a counter on `reports`; the last one enqueues `report.normalise`. Same pattern for `claim.corroborate` → `report.gate`.

**Retry rules.** `SCHEMA_INVALID` retries once with the validation error appended to the prompt input, then fails. `PROVIDER_ERROR` retries only when `retryable`. `LOW_CONFIDENCE` and `SEN_DETECTED` never retry — they route to review and to the decline path respectively.

**Failure surfacing.** A terminal failure sets `reports.status = 'failed'` with `failure_reason`, and the parent sees an honest message naming the cause. Silent retries that end in nothing are the failure mode to avoid.

---

## 4. Foundry client

```ts
// src/server/foundry/client.ts

const PROMPTS = {
  extract:     process.env.FOUNDRY_PROMPT_EXTRACT!,     // 'extract-report-page:7'
  normalise:   process.env.FOUNDRY_PROMPT_NORMALISE!,
  analyse:     process.env.FOUNDRY_PROMPT_ANALYSE!,
  corroborate: process.env.FOUNDRY_PROMPT_CORROBORATE!,
  plan:        process.env.FOUNDRY_PROMPT_PLAN!,
  checkin:     process.env.FOUNDRY_PROMPT_CHECKIN!,
} as const;

export async function invoke<TIn, TOut>(
  stage: keyof typeof PROMPTS,
  input: TIn,
  schema: ZodSchema<TOut>
): Promise<StageResult<TOut>> {
  const promptVersion = PROMPTS[stage];
  const deployment = deploymentFor(stage);
  const started = Date.now();

  const raw = await foundry.chat({
    deployment,
    promptAsset: promptVersion,
    variables: input,
    responseFormat: { type: 'json_schema', schema: toJsonSchema(schema) },
  });

  const parsed = schema.safeParse(raw);
  const meta = { promptVersion, modelDeployment: deployment, latencyMs: Date.now() - started };

  return parsed.success
    ? { ok: true, value: parsed.data, meta }
    : { ok: false, error: { code: 'SCHEMA_INVALID', detail: parsed.error.message }, meta };
}
```

Prompt versions are pinned, never `latest`. Changing one is a pull request, which is what triggers the evaluation run in CI.

---

## 5. API contracts

All responses are `{ data }` or `{ error: { code, message } }`.

**`POST /api/children/:id/reports`** — multipart, `file`, ≤20MB, PDF or images.
`202 { data: { reportId, status: 'uploaded' } }`
`403 CONSENT_MISSING` · `413 FILE_TOO_LARGE` · `415 UNSUPPORTED_TYPE`

**`GET /api/reports/:id/status`**
`200 { data: { status, stage, pagesDone, pagesTotal, failureReason? } }`

**`GET /api/children/:id/findings`** — only `published` sets.
```json
{ "data": { "honestyPath": false, "findings": [ {
  "id": "…", "kind": "growth",
  "statement": "Computation is strong; mathematical reasoning expressed in language is one level behind.",
  "corroboration": { "status": "corroborated", "quote": "…", "subject": "Mathematics" },
  "citations": [ { "rawLabel": "Solve simple story sums…", "values": ["C","O","P"], "sourceRef": { "page": 9 } } ],
  "yourResponse": null } ] } }
```

**`POST /api/findings/:id/response`** — `{ response, note? }` → `200`

**`POST /api/checkins/:token`** — sessionless.
`{ activitiesDone: 0|1|2|3, note?, concernRaised? }` → `200 { data: { decision } }`
`410 TOKEN_EXPIRED` · `409 ALREADY_ANSWERED`

Token is `hmac(secret, checkinId)`, single-use, stored as `token_hash`, expiring with the cycle. Comparison is constant-time.

**Ops** — `POST /api/review/:id/approve` with the six-item checklist; rejection requires at least one violation category from a fixed enum. Approval publishes and enqueues the email in one transaction.

---

## 6. Review console

Route `/(ops)/review/[id]`. Three panes: generated artifact, citations resolved back to source cells with page and row, and the checklist.

Checklist keys are stored verbatim in `review_queue.checklist`:

```ts
export const CHECKLIST = [
  'citations_resolve',
  'no_condition_named',
  'no_comparison',
  'growth_framing',
  'within_constraints',
  'resources_from_library',
] as const;

export const VIOLATIONS = [
  'diagnostic_language','comparison','deficit_framing',
  'uncited_claim','constraint_violation','resource_not_in_library',
] as const;
```

Approve is disabled until all six are ticked. Rejections accumulate in `review_queue.violations` — the labelled training set for the Launch-stage classifier.

---

## 7. Email

Two templates, both carrying full content rather than a link.

**Findings ready** — the findings with their evidence, and a link to respond in the app.
**Fortnightly plan** — the three activities in the body, plus three one-click check-in buttons (`Did all three` / `Did some` / `Didn't get to it`) each hitting `/api/checkins/:token` with a different `activitiesDone`.

The buttons are `GET`-safe links that render a confirmation page and then `POST` server-side, so mail-client prefetching cannot record a false answer.

---

## 8. Evaluation runners

```
evals/
  golden/{id}/report.pdf, labels.json
  runners/groundedness.ts   -- SQL: every citation resolves. Target 100%
  runners/correctness.ts    -- set overlap vs frozen labels. Recall + precision ≥70%
  runners/corroboration.ts  -- verdict vs human label. ≥90%
  runners/safety.ts         -- HHH cases A1–A9, O1–O9. Blocking cases 100%
  runners/extraction.ts     -- field accuracy vs hand transcription. ≥98%
```

Correctness matching uses skill-set overlap, not string similarity: a produced claim matches an expected one when the cited observations overlap by ≥50% and the `kind` agrees. Judging statement wording would measure phrasing rather than finding.

CI runs the full set on any PR touching a pinned prompt version, a gate, or the ontology, and writes the result to `eval_runs`.

---

## 9. Build order

1. Schema, RLS, auth, consent gate — nothing may run without a live consent row.
2. Ontology and `skill_aliases` seeded from one real report. **Hardest task; do it first.**
3. Upload, storage, `report.split`, Document Intelligence pre-pass.
4. Extract → Normalise, with the golden set's five hand-transcribed reports as the accuracy target.
5. **Gates before Analyse.** Building the citation gate first means the first finding ever produced is already checked.
6. Analyse → Corroborate.
7. Review console — it is a Week 1 hard gate's enforcement mechanism, not an internal tool.
8. Findings UI, parent responses.
9. Plan synthesis, curated resource library.
10. Email, check-in tokens, fortnightly scheduler.

Steps 1–5 are the risky half. Step 5 before step 6 is deliberate: a gate written after the thing it gates tends to be written to let that thing through.
