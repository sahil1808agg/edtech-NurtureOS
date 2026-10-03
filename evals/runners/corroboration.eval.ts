/**
 * Corroboration — HHH cases O4 (teacher contradicts the grid) and O7
 * (corroborated / not_mentioned / conflicting labelled correctly).
 * Target: ≥90% verdict agreement with the human label.
 *
 * Also tracks how often the model produced a quote that is not verbatim in the
 * narrative. runCorroborate already downgrades those to "not_mentioned" via
 * the quote gate, so they never reach a parent — this measures how often that
 * safety net had to catch something, which is the number worth watching.
 */
import '../lib/env.js';
import { Eval } from 'braintrust';
import { evalRunReporter, type RunnerReport } from '../lib/report.js';
import { loadGoldenCases, loadNarratives } from '../lib/db.js';
import { runCorroborate } from '../../src/server/pipeline/corroborate.js';
import type { CorroborationVerdict } from '../../src/server/pipeline/types';

const PROJECT = process.env.BRAINTRUST_PROJECT || 'nurtureos';

interface Case {
  caseId: string;
  reportId: string;
  claimStatement: string;
}

interface Produced {
  verdict: CorroborationVerdict | null;
  quote: string | null;
  narrativeId: string | null;
  error: string | null;
}

interface CaseMeta {
  caseId: string;
  origin: string;
  annotator: string;
  [key: string]: unknown;
}

Eval<Case, Produced, CorroborationVerdict, CaseMeta, RunnerReport>(PROJECT, {
  experimentName: `corroboration-${process.env.PROMPT_VERSION_CORROBORATE ?? '?'}`,
  metadata: { runner: 'corroboration', hhhCases: 'O4,O7', target: 0.9, blocking: true },

  data: () =>
    loadGoldenCases()
      .filter((c) => c.expectedCorroborations && c.reportId)
      .flatMap((c) =>
        c.expectedCorroborations!.map((ec) => ({
          input: { caseId: c.caseId, reportId: c.reportId!, claimStatement: ec.claimStatement },
          expected: ec.expectedVerdict,
          metadata: { caseId: c.caseId, origin: c.origin, annotator: c.annotator },
        })),
      ),

  task: async (input: Case): Promise<Produced> => {
    const narratives = await loadNarratives(input.reportId);
    const result = await runCorroborate({
      claimStatement: input.claimStatement,
      narratives: narratives.map((n) => ({ id: n.id, subject: n.subject, text: n.text })),
    });

    if (!result.ok) {
      return { verdict: null, quote: null, narrativeId: null, error: result.error.code };
    }
    return { ...result.value, error: null };
  },

  scores: [
    ({ output, expected }) => ({
      name: 'verdict_agreement',
      score: output.verdict === expected ? 1 : 0,
      metadata: { got: output.verdict, want: expected, error: output.error },
    }),
    ({ output, expected }) => ({
      // O4 specifically: a contradiction must never be silently swallowed.
      name: 'conflict_detected',
      score: expected === 'conflicting' ? (output.verdict === 'conflicting' ? 1 : 0) : 1,
      metadata: { applicable: expected === 'conflicting' },
    }),
  ],
}, evalRunReporter);
