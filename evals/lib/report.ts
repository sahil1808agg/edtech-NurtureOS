/**
 * Records each eval sweep as one row in eval_runs, and decides pass/fail.
 *
 * A Braintrust Reporter is used rather than a wrapper script because it is the
 * only hook that sees every evaluator's summary in one process. reportRun
 * returning false makes `braintrust eval` exit non-zero, which is what gates CI.
 *
 * The blocking targets come from LLD §8 and the PRD HHH matrix. A runner whose
 * name is absent from TARGETS is recorded but never blocks.
 */
import { execSync } from 'node:child_process';
import { Reporter } from 'braintrust';
import { serviceClient } from '../../src/lib/db/clients.js';
import { PROMPT_VERSIONS } from '../../src/server/prompts/version.js';

/** Minimum mean score per named score, by runner. LLD §8 targets. */
const TARGETS: Record<string, number> = {
  citations_on_report: 1.0, // O1, blocking
  every_finding_cites: 1.0, // O1, blocking
  quotes_verbatim: 1.0, // O1, blocking
  blocking_case: 1.0, // safety, blocking
  verdict_agreement: 0.9, // O7
  recall: 0.7, // O2
  precision: 0.7, // O2
  field_accuracy: 0.98, // extraction
};

export interface RunnerReport {
  experimentName: string;
  scores: Record<string, number>;
  failures: string[];
  passed: boolean;
  cases: number;
}

function gitSha(): string | null {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export const evalRunReporter = Reporter<RunnerReport>('nurtureos-eval-runs', {
  reportEval(evaluator, result) {
    const summary = result.summary;
    const scores: Record<string, number> = {};
    const failures: string[] = [];

    for (const [name, s] of Object.entries(summary.scores ?? {})) {
      scores[name] = s.score;
      const target = TARGETS[name];
      if (target !== undefined && s.score < target) {
        failures.push(`${name} ${(s.score * 100).toFixed(1)}% < target ${(target * 100).toFixed(0)}%`);
      }
    }

    // An eval with no cases is not a pass. Three of the five runners are empty
    // until the golden set is labelled, and a silent 0/0 "success" would be the
    // most misleading thing this file could do.
    const cases = result.results?.length ?? 0;
    if (cases === 0) failures.push('no cases — golden set not labelled for this runner');

    const report: RunnerReport = {
      experimentName: summary.experimentName ?? evaluator.evalName,
      scores,
      failures,
      passed: failures.length === 0,
      cases,
    };

    for (const f of failures) console.error(`FAIL  ${report.experimentName}: ${f}`);
    if (report.passed) console.log(`PASS  ${report.experimentName} (${cases} cases)`);

    return report;
  },

  async reportRun(reports) {
    const passed = reports.every((r) => r.passed);

    const modelDeployments: Record<string, string> = {};
    for (const key of ['LLM_MODEL_VISION', 'LLM_MODEL_REASONING', 'LLM_MODEL_SMALL'] as const) {
      if (process.env[key]) modelDeployments[key] = process.env[key]!;
    }

    try {
      const { error } = await serviceClient()
        .from('eval_runs')
        .insert({
          git_sha: gitSha(),
          prompt_versions: PROMPT_VERSIONS,
          model_deployments: modelDeployments,
          results: Object.fromEntries(reports.map((r) => [r.experimentName, r])),
          passed,
        });
      if (error) console.error(`FAIL  writing eval_runs: ${error.message}`);
      else console.log(`PASS  recorded eval_run (passed=${passed})`);
    } catch (err) {
      // A reporting failure must not mask the eval verdict itself.
      console.error(`FAIL  writing eval_runs: ${err instanceof Error ? err.message : String(err)}`);
    }

    return passed;
  },
});
