/**
 * Correctness — HHH case O2 ("the cited cell supports the claim, not merely
 * exists"). Target: recall and precision ≥70%.
 *
 * Matching is cited-observation overlap, never string similarity (LLD §8).
 * See ../lib/match.ts for the rule.
 *
 * Requires a labelled golden set. With no labelled cases this reports zero
 * cases rather than a passing score — an empty run must never look like a pass.
 *
 * NOTE: this runner calls the model, and sampling is unpinned (no temperature
 * or seed is set anywhere in src/server/llm). Expect run-to-run movement of a
 * finding or two independent of any prompt change.
 */
import '../lib/env.js';
import { Eval } from 'braintrust';
import { evalRunReporter, type RunnerReport } from '../lib/report.js';
import { loadGoldenCases, type GoldenExpectedFinding } from '../lib/db.js';
import { getObservations } from '../../src/server/db/findings.js';
import { runAnalyse } from '../../src/server/pipeline/analyse.js';
import { citationGate } from '../../src/server/gates/citation';
import { scoreClaims, type ClaimLike } from '../lib/match.js';

const PROJECT = process.env.BRAINTRUST_PROJECT || 'nurtureos';

interface Case {
  caseId: string;
  reportId: string;
  childId: string;
}

interface Produced {
  claims: ClaimLike[];
  droppedByGate: number;
  insufficientEvidence: boolean;
  error: string | null;
}

interface CaseMeta {
  caseId: string;
  origin: string;
  caseLabel: string | null;
  annotator: string;
  [key: string]: unknown;
}

Eval<Case, Produced, GoldenExpectedFinding[], CaseMeta, RunnerReport>(PROJECT, {
  experimentName: `correctness-analyse-${process.env.PROMPT_VERSION_ANALYSE ?? '?'}`,
  metadata: { runner: 'correctness', hhhCases: 'O2', target: 0.7, blocking: true },

  data: () =>
    loadGoldenCases()
      .filter((c) => c.expectedFindings && c.reportId)
      .map((c) => ({
        input: { caseId: c.caseId, reportId: c.reportId!, childId: c.caseId },
        expected: c.expectedFindings!,
        metadata: {
          caseId: c.caseId,
          origin: c.origin,
          caseLabel: c.caseLabel ?? null,
          annotator: c.annotator,
        },
      })),

  task: async (input: Case): Promise<Produced> => {
    const observations = await getObservations(input.reportId);
    const result = await runAnalyse({
      childId: input.childId,
      reportId: input.reportId,
      observations,
    });

    if (!result.ok) {
      return { claims: [], droppedByGate: 0, insufficientEvidence: false, error: result.error.code };
    }

    // Score what survives the gate, not what the model said: an ungrounded
    // claim never reaches a parent, so counting it would flatter the model.
    const validIds = new Set(observations.map((o) => o.id));
    const { kept, dropped } = citationGate(result.value.claims, validIds);

    return {
      claims: kept.map((c) => ({ kind: c.kind, citedObservationIds: c.citedObservationIds })),
      droppedByGate: dropped.length,
      insufficientEvidence: result.value.insufficientEvidence,
      error: null,
    };
  },

  scores: [
    ({ output, expected }) => {
      const m = scoreClaims(output.claims, expected ?? []);
      return { name: 'recall', score: m.recall, metadata: { ...m, error: output.error } };
    },
    ({ output, expected }) => {
      const m = scoreClaims(output.claims, expected ?? []);
      return { name: 'precision', score: m.precision, metadata: { ...m } };
    },
    ({ output }) => ({
      // Anything the gate drops was an ungrounded claim the model tried to make.
      name: 'survived_citation_gate',
      score:
        output.claims.length + output.droppedByGate === 0
          ? 1
          : output.claims.length / (output.claims.length + output.droppedByGate),
      metadata: { dropped: output.droppedByGate, kept: output.claims.length },
    }),
  ],
}, evalRunReporter);
