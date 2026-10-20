import '../../src/test/load-env.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPlan, type PlanActivity } from '../../src/server/pipeline/plan.js';
import type { FamilyConstraints } from '../../src/server/prompts/plan.js';

/**
 * Deterministic eval for the "own venue" rule in prompts/plan.ts: when
 * constraints.otherConstraints names a venue the family already has access
 * to (their own society/club/membership), the activity that uses it must be
 * kind "home" with the venue named in the instructions — never kind "local",
 * which triggers a public-places lookup that has no way to know what "our
 * society" refers to and will silently swap in an unrelated nearby business
 * (see resolve-local-activities.ts). No judge needed — this is a structural
 * check on runPlan()'s own output, same "dumbest possible eval" approach as
 * run_evals.ts/run_grounding_eval.ts, just one layer lower (the plan
 * pipeline itself rather than the chat agent wrapping it).
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
  otherConstraints: string;
  /** Every one of these substrings (case-insensitive) must appear in an activity's title+instructions for it to count as "the family's own venue". */
  venueKeywords: string[];
}

interface EvalResult {
  id: string;
  description: string;
  verdict: 'PASS' | 'FAIL';
  reasoning: string;
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
    hasLocation: true,
  });

  if (!result.ok) {
    return {
      id: testCase.id,
      description: testCase.description,
      verdict: 'FAIL',
      reasoning: `Plan generation failed: ${JSON.stringify(result.error)}`,
      activities: [],
      model: 'unknown',
    };
  }

  const activities = result.value.activities;
  const venueActivities = activities.filter(a => matchesVenue(a, testCase.venueKeywords));

  let verdict: 'PASS' | 'FAIL';
  let reasoning: string;

  if (venueActivities.length === 0) {
    verdict = 'FAIL';
    reasoning = `No activity referenced the family's stated venue (expected all of: ${testCase.venueKeywords.join(', ')}) — the standing preference naming it was ignored.`;
  } else {
    const violation = venueActivities.find(a => a.kind !== 'home' || a.localQuery !== null || a.resourceId !== null);
    if (violation) {
      verdict = 'FAIL';
      reasoning = `Activity "${violation.title}" references the family's own venue but was generated as kind "${violation.kind}"${violation.localQuery ? ` with localQuery "${violation.localQuery}"` : ''}${violation.resourceId ? ` with resourceId "${violation.resourceId}"` : ''} — should be kind "home" with the venue named directly, never "local"/"resource", since "local" would silently swap in an unrelated nearby place.`;
    } else {
      verdict = 'PASS';
      reasoning = `Activity "${venueActivities[0].title}" correctly generated as kind "home" naming the family's own venue.`;
    }
  }

  return {
    id: testCase.id,
    description: testCase.description,
    verdict,
    reasoning,
    activities,
    model: result.meta.modelDeployment,
  };
}

async function main() {
  const runAt = new Date();
  const datasetPath = join(__dirname, '..', 'datasets', 'local-venue-dataset.json');
  const dataset: TestCase[] = JSON.parse(readFileSync(datasetPath, 'utf8'));

  console.log('\n' + '='.repeat(65));
  console.log('   RUNNING LOCAL-VS-HOME VENUE EVAL (live LLM calls)');
  console.log('='.repeat(65) + '\n');

  const results: EvalResult[] = [];

  for (const [idx, testCase] of dataset.entries()) {
    const res = await evaluateCase(testCase);
    results.push(res);

    console.log(`[${idx + 1}/${dataset.length}] ${res.verdict} | ${res.id}`);
    console.log(`    Scenario: ${res.description}`);
    console.log(`    Activities:`);
    for (const a of res.activities) {
      console.log(`      - [${a.kind}] "${a.title}"${a.localQuery ? ` (localQuery: "${a.localQuery}")` : ''}${a.resourceId ? ` (resourceId: ${a.resourceId})` : ''}`);
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

  const runsDir = join(__dirname, '..', 'runs');
  mkdirSync(runsDir, { recursive: true });
  const runPath = join(runsDir, `eval_results_venue_${formatIST(runAt)}_IST.json`);
  writeFileSync(runPath, JSON.stringify(output, null, 2), 'utf8');

  const latestPath = join(__dirname, '..', 'results', 'eval_results_venue.json');
  writeFileSync(latestPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Detailed results logged to ${runPath}\n(also updated ${latestPath})\n`);

  if (passRate < 100) process.exitCode = 1;
}

main().catch(err => {
  console.error('Eval run failed:', err);
  process.exitCode = 1;
});
