/**
 * Extraction — field accuracy against hand transcription. Target ≥98%.
 * Also covers HHH case O9: an unknown template must be declared, never guessed.
 *
 * Reads the PDF from evals/golden/{case}/report.pdf. Those are redacted or
 * synthetic by decision, so this measures accuracy on constructed layouts
 * rather than genuine school formats — a real-template regression will not
 * show up here.
 */
import '../lib/env.js';
import { readFileSync } from 'node:fs';
import { Eval } from 'braintrust';
import { evalRunReporter, type RunnerReport } from '../lib/report.js';
import { loadGoldenCases, type GoldenExpectedCell } from '../lib/db.js';
import { runExtract } from '../../src/server/pipeline/extract.js';

const PROJECT = process.env.BRAINTRUST_PROJECT || 'nurtureos';

interface Case {
  caseId: string;
  pdfPath: string;
}

interface Produced {
  cells: GoldenExpectedCell[];
  narrativeCount: number;
  error: string | null;
}

interface CaseMeta {
  caseId: string;
  origin: string;
  caseLabel: string | null;
  [key: string]: unknown;
}

/** Per-field accuracy: matched fields ÷ total fields across all expected cells. */
function fieldAccuracy(produced: GoldenExpectedCell[], expected: GoldenExpectedCell[]) {
  let total = 0;
  let matched = 0;

  for (const want of expected) {
    // Pair on rawLabel — the one field a transcription can be keyed by.
    const got = produced.find((p) => p.rawLabel.trim() === want.rawLabel.trim());

    total += 2 + want.values.length; // rawLabel, subject, and one per term
    if (!got) continue;

    matched += 1; // rawLabel matched by construction
    if (got.subject?.trim() === want.subject?.trim()) matched++;

    for (const wv of want.values) {
      const gv = got.values.find((v) => v.termIndex === wv.termIndex);
      // A dash or blank must stay null: inventing a value here is the failure.
      if (gv && (gv.rawValue ?? null) === (wv.rawValue ?? null)) matched++;
    }
  }

  return { accuracy: total === 0 ? 0 : matched / total, matched, total };
}

Eval<Case, Produced, GoldenExpectedCell[], CaseMeta, RunnerReport>(PROJECT, {
  experimentName: `extraction-${process.env.PROMPT_VERSION_EXTRACT ?? '?'}`,
  metadata: { runner: 'extraction', hhhCases: 'O9', target: 0.98, blocking: true },

  data: () =>
    loadGoldenCases()
      .filter((c) => c.expectedCells && c.pdfPath)
      .map((c) => ({
        input: { caseId: c.caseId, pdfPath: c.pdfPath! },
        expected: c.expectedCells!,
        metadata: { caseId: c.caseId, origin: c.origin, caseLabel: c.caseLabel ?? null },
      })),

  task: async (input: Case): Promise<Produced> => {
    const result = await runExtract({
      reportId: input.caseId,
      pdfBuffer: readFileSync(input.pdfPath),
    });

    if (!result.ok) {
      return { cells: [], narrativeCount: 0, error: result.error.code };
    }

    return {
      cells: result.value.cells.map((c) => ({
        rawLabel: c.rawLabel,
        subject: c.subject,
        values: c.values,
      })),
      narrativeCount: result.value.narratives.length,
      error: null,
    };
  },

  scores: [
    ({ output, expected }) => {
      const r = fieldAccuracy(output.cells, expected ?? []);
      return { name: 'field_accuracy', score: r.accuracy, metadata: { ...r, error: output.error } };
    },
    ({ output, expected }) => ({
      name: 'cell_recall',
      score: (expected ?? []).length === 0 ? 0 : Math.min(1, output.cells.length / expected!.length),
      metadata: { produced: output.cells.length, expected: (expected ?? []).length },
    }),
  ],
}, evalRunReporter);
