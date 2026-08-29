# PRD Evaluation Report: NurtureOS

**Format detected:** Full AI PRD (partial — Weeks 1–4 submitted, Week 5 not yet written)
**Author:** Sahil Aggarwal
**39 passing · 2 blockers · 3 improvements** *(44 items evaluated; Section 9 excluded as not yet submitted)*

> **Disclosure:** this evaluation covers a document produced in collaboration with the same assistant now scoring it. Treat the pass rate as directional and weight the blockers and improvements more heavily than the passes.

| Section | Status |
|---|---|
| 1. Problem Definition & Core Metrics | ● all pass |
| 2. Solution Definition | ● 1 improvement |
| 3. Prioritization | ● all pass |
| 4. Roadmap | ● all pass |
| 5. Implementation Plan | ● 1 improvement |
| 6. Evaluation Plan | ● 2 blockers · ● 1 improvement |
| 7. Data Requirements & Prompt Strategy | ● all pass |
| 8. Responsible AI | ● all pass |
| 9. Pricing & Cost Structure | — Week 5 not yet submitted |

---

## Strengths

**The problem is evidenced with a real artifact, not asserted.** The teardown of an actual 14-page EYP report — ~145 standards, ~350 data points, three named regressions buried across columns, and the teacher's own commentary independently corroborating the grid — does more work than any market statistic. It converts "parents can't read reports" from a claim into something a reviewer can verify in five minutes.

**The "is ML necessary?" discipline runs in both directions.** Most AI PRDs justify adding AI everywhere. This one names three components — guardrails, curriculum context, resource lookup — that were considered and deliberately rejected as model work, with reasons, and downgrades their risk ratings accordingly. The C12 local-options assessment answering "Is ML necessary? **NO — and that is the point**" is the strongest single line in the prioritization section.

**The evaluation strategy is honest about what cannot be measured.** Splitting components into "verifiable" and "judgeable only", stating plainly that Analyse and Plan synthesis have no ground truth and never will, and then defining proxies plus two kill criteria, is rarer and more credible than a table of invented accuracy targets.

---

## Blockers

| Item | Gap |
|---|---|
| 6.5 Launch criteria and go/no-go framework | The Launch Plan section under Week 3 is an empty template placeholder; the Helpful/Honest/Harmless launch table has headers and three stage rows but no populated criteria. |
| 6.6 Experimentation or A/B testing plan | No experiment, holdback, staged rollout, or measurement launch is described anywhere in the document. |

---

## Improvements

| Item | Gap |
|---|---|
| 2.3 Functional requirements in user story format | All 44 FRs use "As a parent, I can…" but omit the "so that [outcome]" clause, so the user benefit is implicit rather than stated. |
| 5.2 Chosen model justified against alternatives | The cross-cutting table says open models "do not currently match frontier vision and reasoning quality," but no specific model or provider is named or compared. |
| 6.4 Evaluation spreadsheet linked or planned | The Evaluations section carries a red placeholder — "Evals sheet: {link to your copy}" — with no link and no column headers specified outside the in-document tables. |

---

## Section Detail

### Section 1: Problem Definition & Core Metrics

| Status | Item | Notes |
|---|---|---|
| Pass | 1.1 Problem & JTBD | "School reports are written for the school's records, not for the parent's decisions," with an explicit JTBD statement and three named anti-jobs. |
| Pass | 1.2 Persona defined | Nine-row persona table plus an A/B/C segmentation by report paradigm and three named anti-personas. |
| Pass | 1.3 Validated with data | UDISE 14.71 lakh schools / 24.69 crore students, 25,000+ CBSE schools on HPC, IB and Cambridge school counts, plus the primary-source report teardown. |
| Pass | 1.4 Worth solving for this user | Five arguments including demonstrability in five minutes, established willingness to pay, and the curriculum-cycle cadence. |
| Pass | 1.5 Defensible MOAT | Four named sources — longitudinal record, execution loop, cross-board ontology, portability across board switches — with a table conceding what a general assistant already does. |
| Pass | 1.6 Agentic AI justified | Seven numbered reasons rule-based fails, including the semantic-clustering example from the real report. |
| Pass | 1.7 Unstructured data types listed | PDFs, photographs, criterion grids, narrative Learning Stories, handwriting, four incompatible scales, context-dependent dash values. |
| Pass | 1.8 Differentiated from ChatGPT | Explicit table conceding that a parent can paste a report into ChatGPT today, then drawing the line at persistent record, execution loop and ontology. |
| Pass | 1.9 North Star defined | "Fortnightly Plan Completion Rate" named singularly, with rationale for why it beats uploads or MAU. |
| Pass | 1.10 Primary metrics | Five primary metrics with units and targets — activation ≥60%, loop retention ≥50%, resonance ≥80%, corroboration ≥70%, paradigm coverage 20. |
| Pass | 1.11 Secondary metrics | Extraction fidelity, time to first insight, conference lift, continuity retention, plus a counter-metric. |
| Pass | 1.12 Measurable over time | Every metric carries a unit and target; monitoring cadence specified in Week 3. |

No blockers or improvements in this section.

---

### Section 2: Solution Definition

| Status | Item | Notes |
|---|---|---|
| Pass | 2.1 Visual user flow | Two embedded diagrams — the five-stage core loop and the internals of "understand" — plus a stage-detail table naming input, output and blocker per stage. |
| Pass | 2.2 AI drawbacks addressed | Ten-row failure-mode table covering fabricated findings, over-reading thin data, ambiguous values, fabricated places, diagnostic drift, anxiety framing, staleness and opacity. |
| Improvement | 2.3 User story format | Requirements use "As a parent, I can…" without the "so that" clause. |
| Pass | 2.4 Agent capabilities and behaviour | Design-decisions table states the agent recommends but never transacts; blocking gates, fallback paths and error handling specified per stage. |

**2.3 Functional requirements in user story format**
**What's missing:** FR-1.1 reads "As a parent, I can create an account and add one or more children" with acceptance criteria in the next column. The actor and action are there; the outcome clause is not. Across all 44 FRs the benefit has to be inferred.
**What to write:** Add the outcome to the FRs where the benefit is not obvious — particularly the constraint and safety ones, where the "so that" is the whole argument. For example, FR-5.1 becomes: "As a parent, I get a fortnightly plan of at most 3 activities **so that I can actually finish it in a normal fortnight**." That single clause makes the cap read as a deliberate product decision rather than an arbitrary limit, which is exactly the point the PRD argues elsewhere.

---

### Section 3: Prioritization

| Status | Item | Notes |
|---|---|---|
| Pass | 3.1 Workflow broken into components | Thirteen named components across three stages, with an embedded risk-coloured component map. |
| Pass | 3.2 Risk assessment per component | Every component has a risk rating and a specific comment; three carry full 10-check assessments. |
| Pass | 3.3 ML feasibility, data, accuracy, explainability | C2, C5 and C12 answer all ten checks including "is ML necessary", data availability, accuracy achievability, bias and explainability. |
| Pass | 3.4 Features prioritised by risk, cost, value | FRs carry M/S/C priority; an eight-tier prioritized-story table gives the rationale for each tier's position. |
| Pass | 3.5 Scope narrowed to MVP with rationale | Assumptions ranked by risk and cost-to-test, segment C chosen with four reasons and its objection conceded, five items explicitly deferred. |

No blockers or improvements in this section.

---

### Section 4: Roadmap

| Status | Item | Notes |
|---|---|---|
| Pass | 4.1 Clear phases | MVP, MVP 1, Launch, Iteration. |
| Pass | 4.2 Features and durations per phase | 6 weeks, 6 weeks, 8 weeks, ongoing, each with a feature description. |
| Pass | 4.3 Linked to priorities and risks | Deferrals trace to the risk summary — local options deferred because C12 is the only component that can destroy trust in one output. |
| Pass | 4.4 Dependencies named | Places-provider coverage (C12 assessment), teacher labelling for ground truth (Week 3), school-ERP vendors as competitor or partner (MOAT section). |
| Pass | 4.5 Phasing realistic and distinct | MVP is one template family and no local options; Launch adds a new segment, billing and bias monitoring. |

Note on 4.4: dependencies are real but scattered across three sections rather than stated in the roadmap. Worth consolidating when Week 5 is written, though it passes as-is.

---

### Section 5: Implementation Plan

| Status | Item | Notes |
|---|---|---|
| Pass | 5.1 Model selection criteria | Eight criteria per feature — open/closed, context, modalities, tuning, speed, accuracy, parameters, timing — plus five cross-cutting requirements. |
| Improvement | 5.2 Justified against alternatives | Only a category of alternative is named, not a specific model. |

**5.2 Chosen model justified against alternatives**
**What's missing:** The closest the document comes is "No capacity to self-host or maintain inference infrastructure, and open models do not currently match frontier vision and reasoning quality at this team size." That rejects a class. No specific model is named anywhere — the tables say "Frontier", "Mid" and "Small" as tiers.
**What to write:** Name the candidates and why one wins for the two hardest components. For example: "Extract requires a vision model with high max output — ~350 structured values from 14 pages. We evaluated Claude Opus 5, GPT-4-class vision, and Gemini on the golden set; the selection criterion is field-level accuracy on the 5 hand-transcribed reports, with output token limit as the disqualifier. Open-weight vision models were excluded on accuracy, not cost." Naming the disqualifying criterion matters more than naming the winner.

---

### Section 6: Evaluation Plan

| Status | Item | Notes |
|---|---|---|
| Pass | 6.1 Evaluation over time | Nine evaluation axes, regression on every prompt change, weekly drift and monthly bias review. |
| Pass | 6.2 Ground truth identified | 26-report golden set — 20 real, 6 constructed adversarial — with a labelling protocol that requires pre-labelling and records inter-annotator agreement. |
| Pass | 6.3 Thresholds or HHH defined | Populated HHH tables with 25 test cases, plus numeric targets: extraction ≥98%, groundedness 100%, correctness ≥70% recall and precision. |
| Improvement | 6.4 Eval spreadsheet linked or planned | Placeholder only. |
| Blocker | 6.5 Launch criteria and go/no-go | Launch Plan section is an empty template table. |
| Blocker | 6.6 Experimentation or A/B plan | No experiment described anywhere. |
| Pass | 6.7 Post-launch monitoring | Five-row monitoring table with cadence, plus a bias alert threshold of 5 percentage points. |

**6.4 Evaluation spreadsheet linked or planned**
**What's missing:** The Evaluations section opens with "Evals sheet: {link to your copy}" in red placeholder text. The in-document HHH tables do define columns — ID, Test, Pass criteria, Status — so the structure exists; the artifact does not.
**What to write:** Create the sheet and link it, with one row per test case and columns for run date, model version, prompt version, result, and failing example. The prompt-version column is the one that earns its place — without it you cannot attribute a regression to a change.

**6.5 Launch criteria and go/no-go decision framework**
**What's missing:** The Week 3 Launch Plan table has the three stage rows the template supplies — measurement launch 1–2%, beta 2–10%, launch — and all HHH cells are empty. Two measurable gates do exist elsewhere: the pre-launch gate ("the left column, all five blocking") and the MVP→MVP 1 gate (resonance ≥80%, week-8 retention ≥50% on ten paying families). They are not organised as a staged go/no-go framework.
**What to write:** The percentage stages do not fit a ten-family MVP and should be reinterpreted as cohorts. For example: "**Stage 1 — own family (n=1):** all five pre-launch axes pass; every output reviewed. **Stage 2 — warm cohort (n=10, paid):** groundedness 100%, zero diagnostic-language violations across 40 consecutive outputs, resonance ≥80%. **Stage 3 — paying strangers:** week-8 completion ≥50%, anxiety counter-metric ≤10%." Two of those three rows are already written elsewhere in the document — this is mostly consolidation, not new thinking.

**6.6 Experimentation or A/B testing plan**
**What's missing:** No holdback, A/B test, or measurement launch appears anywhere. The monitoring table covers regression and drift but not deliberate experimentation.
**What to write:** Name one experiment that tests the riskiest assumption. The obvious candidate given the channel decision: "**A/B on plan delivery.** Arm A receives the full plan in the email body with one-click check-in; arm B receives a notification linking to the app. Primary metric: fortnightly plan completion at week 8. n=10 is underpowered for significance, so this is a directional read, stated as such." Acknowledging that ten families cannot produce statistical significance is stronger than pretending otherwise.

---

### Section 7: Data Requirements & Prompt Strategy

| Status | Item | Notes |
|---|---|---|
| Pass | 7.1 Data strategy listed | Sources, formats, volumes — 26 reports, 5 hand-transcribed at ~1,750 values, 50–100 curated resources, one syllabus calendar. |
| Pass | 7.2 Quality, availability, compliance | DPDP compliance with the 13 May 2027 enforcement date, retention and deletion, per-family isolation, and an explicit "customer data is never used to train or tune a model". |
| Pass | 7.3 Prompting techniques described | Seven techniques with rationale — typed structured output, task decomposition, citation-forced generation, constraint injection as data, few-shot from one exemplar, explicit insufficiency instruction, retry policy. |
| Pass | 7.4 Constraints and output formats per task | Typed records for Extract, Normalise and Check-in; hard caps of 4 findings and 3 activities; per-component constraint table. |
| Pass | 7.5 Plan for improving prompts | Regression on every prompt change, violations logged by category, every parent-rejected finding becomes a labelled eval case. |

Worth noting: the "no vector store at MVP" decision — arguing that a few hundred structured rows with exact answers should not be given an approximate-match failure mode — is the same discipline applied in Section 3 and is unusual to see argued explicitly.

---

### Section 8: Responsible AI

| Status | Item | Notes |
|---|---|---|
| Pass | 8.1 Four pillars assessed | Accountability, Transparency, Fairness and Reliability & Safety each answered in a four-question table. |
| Pass | 8.2 Human-in-the-loop and fallback | 100% human review at MVP with a six-point checklist; parent confirms every finding before a plan is built; unknown templates route to an ops queue rather than a guess. |
| Pass | 8.3 Sensitive use cases | Children with IEPs or identified special educational needs declared out of scope by design with a detect-and-decline path; foreseeable misuse named including a school using output to compare children. |
| Pass | 8.4 Bias, hallucination, safe failure | Bias — teacher-narrative bias laundering as insight, monitored by child gender and school. Hallucination — groundedness at 100% with no tolerance. Safe failure — honesty path, teacher-question routing, SEN decline. |

The asymmetric-error framing under Reliability — "a poorly-chosen activity is recoverable and tolerable; a wrong developmental claim is not" — is what justifies the differing tolerances elsewhere in the document and is worth keeping verbatim.

---

### Section 9: Pricing & Cost Structure

— Week 5 not yet submitted. Not scored.

Note for when it is written: Week 1 already carries directional market sizing (school counts by board with sources) which will feed 9.4, but TAM and SAM are not yet expressed in revenue terms.

---

## Verdict

**Weeks 1–4 complete.**

Weeks 1 through 4 are done and are stronger than the pass count alone suggests — the problem section is evidenced with a primary-source artifact, the prioritization section rejects AI where it is not needed, and the evaluation strategy admits that its most valuable component cannot be measured against ground truth.

**What remains:** the Launch Plan within Week 3, and all of Week 5.

**Strongest item in the submitted sections:** 3.3 — the C12 Local options assessment answering "Is ML necessary? NO — and that is the point," with the reasoning that keeping the model out of the facts *is* the mitigation. Most AI PRDs cannot produce that answer for any component.

**Weakest item in the submitted sections:** 6.6 — there is no experimentation plan at all. This matters more than it looks, because the document has already identified its riskiest assumption (parents completing a fortnightly loop) and its cheapest test, and then does not design the test.

**Priority order to close:**
1. **6.5 Launch criteria** — mostly consolidation; two of the three cohort gates already exist elsewhere in the document.
2. **6.6 Experimentation** — one designed experiment against the delivery-channel decision would close it.
3. **5.2 Model alternatives** — name the candidates and the disqualifying criterion for Extract and Analyse.
4. **6.4 Eval sheet** — create it and link it.
5. **2.3 User story format** — add "so that" clauses to the FRs where the benefit carries the argument.

None of these require rethinking the product. Items 1, 2 and 4 are the ones a reviewer will notice first.
