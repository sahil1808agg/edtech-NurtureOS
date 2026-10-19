import '../src/test/load-env.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPlan, type PlanActivity } from '../src/server/pipeline/plan.js';
import type { FamilyConstraints } from '../src/server/prompts/plan.js';

/**
 * Deterministic eval for the opposite direction from run_local_venue_eval.ts:
 * that one checks an owned venue never becomes kind "local"; this one checks
 * that when hasLocation is true and there's no reason to suppress it, the
 * plan actually CONTAINS "local" activities rather than defaulting to an
 * all-home/resource plan. Written after tracing a reported "new plans are
 * all-home" issue back to a stale plan generated under an old prompt
 * version (plan:2), which predated the hasLocation-gated local-activity
 * rule — current code (confirmed via live runPlan() calls) already mixes
 * local/home/resource correctly, but nothing previously caught it if that
 * regressed again. Same "dumbest possible eval" structural-check approach,
 * no judge needed.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

function formatIST(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}_${pad(ist.getUTCHours())}-${pad(ist.getUTCMinutes())}-${pad(ist.getUTCSeconds())}`;
}

interface TestCase {
  id: string;
  description: string;
  childAgeMonths: number;
  targetFindings: Array<{ id: string; statement: string }>;
  otherConstraints: string | null;
  hasLocation: boolean;
  minLocalCount: number;
  maxLocalCount: number | null;
  /** Only for the own-venue scope-test case: every one of these substrings (case-insensitive) must appear in an activity's title+instructions for it to count as "the family's own venue". */
  venueKeywords?: string[];
}

interface EvalResult {
  id: string;
  description: string;
  verdict: 'PASS' | 'FAIL';
  reasoning: string;
  localCount: number;
  activities: PlanActivity[];
  model: string;
}

function matchesVenue(activity: PlanActivity, venueKeywords: string[]): boolean {
  const text = `${activity.title} ${activity.instructions}`.toLowerCase();
  return venueKeywords.every(k => text.includes(k.toLowerCase()));
}

async function evaluateCase(testCase: TestCase): Promise<EvalResult> {
  const constraints: FamilyConstraints = {
    weeklyMinutes: 90,
    hasDevice: true,
    languages: ['English'],
    otherConstraints: testCase.otherConstraints,
  };

  const result = await runPlan({
    childAgeMonths: testCase.childAgeMonths,
    targetFindings: testCase.targetFindings,
    constraints,
    topicContext: null,
    resourceCandidates: [],
    priorFailures: [],
    hasLocation: testCase.hasLocation,
  });

  if (!result.ok) {
    return {
      id: testCase.id,
      description: testCase.description,
      verdict: 'FAIL',
      reasoning: `Plan generation failed: ${JSON.stringify(result.error)}`,
      localCount: 0,
      activities: [],
      model: 'unknown',
    };
  }

  const activities = result.value.activities;
  const localCount = activities.filter(a => a.kind === 'local').length;

  let verdict: 'PASS' | 'FAIL' = 'PASS';
  let reasoning: string;

  if (localCount < testCase.minLocalCount) {
    verdict = 'FAIL';
    reasoning = `Expected at least ${testCase.minLocalCount} "local" activity(ies) but got ${localCount}.`;
  } else if (testCase.maxLocalCount !== null && localCount > testCase.maxLocalCount) {
    verdict = 'FAIL';
    reasoning = `Expected at most ${testCase.maxLocalCount} "local" activity(ies) but got ${localCount}.`;
  } else if (testCase.venueKeywords) {
    const venueActivity = activities.find(a => matchesVenue(a, testCase.venueKeywords!));
    const otherLocal = activities.find(a => a.kind === 'local' && !matchesVenue(a, testCase.venueKeywords!));

    if (!venueActivity) {
      verdict = 'FAIL';
      reasoning = `No activity referenced the family's stated venue (expected all of: ${testCase.venueKeywords.join(', ')}).`;
    } else if (venueActivity.kind !== 'home') {
      verdict = 'FAIL';
      reasoning = `Activity "${venueActivity.title}" references the family's own venue but was generated as kind "${venueActivity.kind}", not "home".`;
    } else if (!otherLocal) {
      verdict = 'FAIL';
      reasoning = `The owned-venue activity was correctly "home", but no OTHER domain got a "local" activity — the own-venue rule appears to have suppressed "local" plan-wide instead of just for its own domain.`;
    } else {
      reasoning = `Venue activity "${venueActivity.title}" correctly "home"; "${otherLocal.title}" in another domain correctly "local" — own-venue rule scoped correctly.`;
    }
  } else {
    reasoning = `Got ${localCount} "local" activity(ies), within expected range [${testCase.minLocalCount}, ${testCase.maxLocalCount ?? '∞'}].`;
  }

  return {
    id: testCase.id,
    description: testCase.description,
    verdict,
    reasoning,
    localCount,
    activities,
    model: result.meta.modelDeployment,
  };
}

async function main() {
  const runAt = new Date();
  const datasetPath = join(__dirname, 'local-mix-dataset.json');
  const dataset: TestCase[] = JSON.parse(readFileSync(datasetPath, 'utf8'));

  console.log('\n' + '='.repeat(65));
  console.log('   RUNNING LOCAL-MIX EVAL (live LLM calls)');
  console.log('='.repeat(65) + '\n');

  const results: EvalResult[] = [];

  for (const [idx, testCase] of dataset.entries()) {
    const res = await evaluateCase(testCase);
    results.push(res);

    console.log(`[${idx + 1}/${dataset.length}] ${res.verdict} | ${res.id}`);
    console.log(`    Scenario: ${res.description}`);
    console.log(`    Activities:`);
    for (const a of res.activities) {
      console.log(`      - [${a.kind}] "${a.title}"${a.localQuery ? ` (localQuery: "${a.localQuery}")` : ''}`);
    }
    console.log(`    Reasoning: ${res.reasoning}\n`);
  }

  const total = results.length;
  const passed = results.filter(r => r.verdict === 'PASS').length;
  const failed = total - passed;
  const passRate = total > 0 ? (passed / total) * 100 : 0;

  console.log('-'.repeat(65));
  console.log('EVALUATION SUMMARY');
  console.log('-'.repeat(65));
  console.log(`Total Test Cases: ${total}`);
  console.log(`Passed:           ${passed}`);
  console.log(`Failed:           ${failed}`);
  console.log(`Final Pass Rate:  ${passRate.toFixed(1)}%`);
  console.log('-'.repeat(65) + '\n');

  const output = {
    runAtIST: `${formatIST(runAt).replace('_', ' ')} IST`,
    runAt: runAt.toISOString(),
    summary: { total, passed, failed, passRate },
    results,
  };

  const runsDir = join(__dirname, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const runPath = join(runsDir, `eval_results_local_mix_${formatIST(runAt)}_IST.json`);
  writeFileSync(runPath, JSON.stringify(output, null, 2), 'utf8');

  const latestPath = join(__dirname, 'eval_results_local_mix.json');
  writeFileSync(latestPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Detailed results logged to ${runPath}\n(also updated ${latestPath})\n`);

  if (passRate < 100) process.exitCode = 1;
}

main().catch(err => {
  console.error('Eval run failed:', err);
  process.exitCode = 1;
});
