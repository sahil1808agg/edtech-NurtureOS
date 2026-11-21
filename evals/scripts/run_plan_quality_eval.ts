import '../../src/test/load-env.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPlan, type PlanActivity } from '../../src/server/pipeline/plan.js';
import type { Resource } from '../../src/server/prompts/plan.js';
import { buildOtherConstraints } from '../../src/server/db/plans.js';
import { callOpenAICompat } from '../../src/server/llm/providers/openai-compat.js';

/**
 * Plan-quality eval: does a generated plan cover both sides of the child's
 * report, and does it follow what the parent asked for?
 *
 * Calls the real runPlan() with the input production gives it
 * (plan-generate.ts): targetFindings as { id, statement } only, and the
 * parent's chat requests folded into otherConstraints by the same
 * buildOtherConstraints() getFamilyConstraints() uses — so a "no X"
 * request reaches the planner in the same "The family has said they want:
 * ..." sentence a real one would. A finding's kind and the case's
 * `expected` block live only in the dataset, for grading.
 *
 * Checks, all binary, driven by `expected`:
 * - strengthCovered / growthCovered (when true): at least one activity's
 *   addressesFindingId is a strength finding / a growth finding.
 * - one check per expected item:
 *     include — some activity involves it
 *     exclude — no activity involves it
 *   Decided by the item's keywords (matched at the start of a word in an
 *   activity's title, instructions, steps, materials or localQuery). Only
 *   when no keyword matches does a yes/no judge get asked whether any
 *   activity involves it anyway, to catch synonyms the keywords missed.
 *
 *   npm run eval:plan-quality        options: --case=<id>  --limit=<n>  --concurrency=<n> (default 3)
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

type FindingKind = 'strength' | 'growth';

interface ExpectedItem {
  /** What must (include) or must not (exclude) appear, e.g. "flashcards". Also what the judge is asked about. */
  item: string;
  keywords: string[];
}

/** An ExpectedItem tagged with which list it came from. */
interface ParentRequest extends ExpectedItem {
  type: 'include' | 'exclude';
}

interface TestCase {
  id: string;
  description: string;
  childAgeMonths: number;
  weeklyMinutes: number;
  hasDevice: boolean;
  languages: string[];
  materials?: string[];
  hasLocation: boolean;
  findings: Array<{ id: string; kind: FindingKind; statement: string }>;
  /** What the parent said in chat, saved as family interests and sent to the planner as-is. */
  parentRequests: string[];
  resourceCandidates?: Resource[];
  /** The case's pass criteria. A coverage flag set to false skips that check. */
  expected: {
    strengthCovered: boolean;
    growthCovered: boolean;
    include: ExpectedItem[];
    exclude: ExpectedItem[];
  };
}

interface Check {
  pass: boolean;
  detail: string;
}

interface RequestResult {
  type: ParentRequest['type'];
  item: string;
  /** Activities that involve the item, by index into the plan. */
  activityIndexes: number[];
  decidedBy: 'keyword' | 'judge';
  reasoning: string;
  pass: boolean;
}

interface EvalResult {
  id: string;
  description: string;
  verdict: 'PASS' | 'FAIL';
  checks: Record<string, Check>;
  requestResults: RequestResult[];
  activities: PlanActivity[];
  model: string;
  promptVersion: string;
  planLatencyMs: number;
}

function formatIST(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}_${pad(ist.getUTCHours())}-${pad(ist.getUTCMinutes())}-${pad(ist.getUTCSeconds())}`;
}

function parseArgs(argv: string[]) {
  const get = (name: string) => argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
  return {
    caseId: get('case') ?? null,
    limit: get('limit') ? Number(get('limit')) : null,
    concurrency: Math.max(1, Number(get('concurrency') ?? 3)),
  };
}

const JUDGE_MODEL = process.env.LLM_MODEL_PLAN_JUDGE || 'gpt-4o';

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

function coverageChecks(testCase: TestCase, activities: PlanActivity[]): Record<string, Check> {
  const kindById = new Map(testCase.findings.map(f => [f.id, f.kind]));
  const check = (kind: FindingKind): Check => {
    const hits = activities.filter(a => kindById.get(a.addressesFindingId) === kind);
    const total = testCase.findings.filter(f => f.kind === kind).length;
    return hits.length
      ? { pass: true, detail: `${hits.length} activit${hits.length === 1 ? 'y' : 'ies'} for the ${total} ${kind} finding(s): ${hits.map(a => `"${a.title}"`).join(', ')}.` }
      : { pass: false, detail: `No activity addresses any of the ${total} ${kind} finding(s).` };
  };
  const checks: Record<string, Check> = {};
  if (testCase.expected.strengthCovered) checks.strengthCovered = check('strength');
  if (testCase.expected.growthCovered) checks.growthCovered = check('growth');
  return checks;
}

// ---------------------------------------------------------------------------
// Include / exclude
// ---------------------------------------------------------------------------

function activityText(a: PlanActivity): string {
  return [a.title, a.instructions, ...(a.steps ?? []), ...(a.materials ?? []), a.localQuery ?? ''].join(' ');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordHits(req: ParentRequest, activities: PlanActivity[]): { indexes: number[]; matched: string[] } {
  const patterns = req.keywords.map(k => ({ k, re: new RegExp(`\\b${escapeRegExp(k)}`, 'i') }));
  const indexes: number[] = [];
  const matched = new Set<string>();
  activities.forEach((a, i) => {
    const text = activityText(a);
    const found = patterns.filter(p => p.re.test(text));
    if (found.length) {
      indexes.push(i);
      found.forEach(p => matched.add(p.k));
    }
  });
  return { indexes, matched: [...matched] };
}

/** One yes/no question per unresolved item: does any activity involve it? */
async function judgeInvolvement(
  requests: ParentRequest[],
  activities: PlanActivity[],
): Promise<Array<{ involved: boolean; activityIndexes: number[]; reasoning: string }>> {
  const system = [
    "You check whether a child's activity plan involves particular things a parent mentioned.",
    'For each item, answer one yes/no question: does ANY activity actually involve it — as the activity itself, a step, or a material? Only what the activity text says counts; a shared theme or a passing mention that it is NOT used does not.',
    'Respond with strict JSON only: {"items": [{"index": number, "involved": boolean, "activityIndexes": number[], "reasoning": "<one sentence>"}]}',
  ].join('\n');
  const user = JSON.stringify({
    items: requests.map((r, index) => ({ index, item: r.item })),
    activities: activities.map((a, index) => ({ index, title: a.title, instructions: a.instructions, steps: a.steps, materials: a.materials, localQuery: a.localQuery })),
  });
  const result = await callOpenAICompat('openai', JUDGE_MODEL, { system, user });
  const out = JSON.parse(result.content) as { items?: Array<{ index: number; involved?: boolean; activityIndexes?: number[]; reasoning?: string }> };
  return requests.map((_, i) => {
    const item = out.items?.find(x => x.index === i);
    if (!item || typeof item.involved !== 'boolean') throw new Error(`judge returned no answer for "${requests[i].item}"`);
    return { involved: item.involved, activityIndexes: item.activityIndexes ?? [], reasoning: item.reasoning ?? '' };
  });
}

async function checkRequests(testCase: TestCase, activities: PlanActivity[]): Promise<RequestResult[]> {
  const requests: ParentRequest[] = [
    ...testCase.expected.include.map(e => ({ ...e, type: 'include' as const })),
    ...testCase.expected.exclude.map(e => ({ ...e, type: 'exclude' as const })),
  ];
  const results: Array<RequestResult | null> = requests.map(req => {
    const { indexes, matched } = keywordHits(req, activities);
    if (!indexes.length) return null;
    return {
      type: req.type,
      item: req.item,
      activityIndexes: indexes,
      decidedBy: 'keyword',
      reasoning: `Matched ${matched.map(k => `"${k}"`).join(', ')} in ${indexes.map(i => `"${activities[i].title}"`).join(', ')}.`,
      pass: req.type === 'include',
    };
  });

  const unresolved = requests.filter((_, i) => results[i] === null);
  if (unresolved.length) {
    const answers = await judgeInvolvement(unresolved, activities);
    let next = 0;
    requests.forEach((req, i) => {
      if (results[i]) return;
      const a = answers[next++];
      results[i] = {
        type: req.type,
        item: req.item,
        activityIndexes: a.activityIndexes,
        decidedBy: 'judge',
        reasoning: `No keyword matched; judge: ${a.reasoning}`,
        pass: req.type === 'include' ? a.involved : !a.involved,
      };
    });
  }
  return results as RequestResult[];
}

function requestChecks(results: RequestResult[]): Record<string, Check> {
  return Object.fromEntries(
    results.map(r => [
      `${r.type}: ${r.item}`,
      { pass: r.pass, detail: `${r.pass ? '' : r.type === 'include' ? 'Not in the plan. ' : 'In the plan anyway. '}${r.reasoning} [${r.decidedBy}]` },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Running a case
// ---------------------------------------------------------------------------

async function evaluateCase(testCase: TestCase): Promise<EvalResult> {
  const started = Date.now();
  const result = await runPlan({
    childAgeMonths: testCase.childAgeMonths,
    // Same shape production sends (db/plans.ts getTargetFindings) — no kind.
    targetFindings: testCase.findings.map(({ id, statement }) => ({ id, statement })),
    constraints: {
      weeklyMinutes: testCase.weeklyMinutes,
      hasDevice: testCase.hasDevice,
      languages: testCase.languages,
      otherConstraints: buildOtherConstraints(testCase.parentRequests, testCase.materials ?? []),
    },
    topicContext: null,
    resourceCandidates: testCase.resourceCandidates ?? [],
    priorFailures: [],
    hasLocation: testCase.hasLocation,
  });
  const planLatencyMs = Date.now() - started;

  if (!result.ok) {
    return {
      id: testCase.id,
      description: testCase.description,
      verdict: 'FAIL',
      checks: { planGenerated: { pass: false, detail: `Plan generation failed: ${JSON.stringify(result.error)}` } },
      requestResults: [],
      activities: [],
      model: 'unknown',
      promptVersion: 'unknown',
      planLatencyMs,
    };
  }

  const activities = result.value.activities;
  const checks: Record<string, Check> = { planGenerated: { pass: true, detail: `${activities.length} activities.` }, ...coverageChecks(testCase, activities) };

  let requestResults: RequestResult[] = [];
  try {
    requestResults = await checkRequests(testCase, activities);
    Object.assign(checks, requestChecks(requestResults));
  } catch (err) {
    checks.judge = { pass: false, detail: `Judge call failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  return {
    id: testCase.id,
    description: testCase.description,
    verdict: Object.values(checks).every(c => c.pass) ? 'PASS' : 'FAIL',
    checks,
    requestResults,
    activities,
    model: result.meta.modelDeployment,
    promptVersion: result.meta.promptVersion,
    planLatencyMs,
  };
}

// ---------------------------------------------------------------------------

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function printResult(res: EvalResult, idx: number, total: number) {
  console.log(`[${idx + 1}/${total}] ${res.verdict} | ${res.id}  (plan ${(res.planLatencyMs / 1000).toFixed(0)}s, ${res.model})`);
  console.log(`    Scenario: ${res.description}`);
  for (const a of res.activities) {
    console.log(`      - [${a.kind}] "${a.title}" (${a.estimatedMinutes} min) → ${a.addressesFindingId.slice(0, 8)}`);
  }
  for (const [name, check] of Object.entries(res.checks)) {
    console.log(`    ${check.pass ? '✓' : '✗'} ${name}: ${check.detail}`);
  }
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runAt = new Date();

  const datasetPath = join(__dirname, '..', 'datasets', 'plan-quality-dataset.json');
  let dataset: TestCase[] = JSON.parse(readFileSync(datasetPath, 'utf8'));
  if (args.limit !== null) dataset = dataset.slice(0, args.limit);
  if (args.caseId) dataset = dataset.filter(c => c.id === args.caseId);
  if (dataset.length === 0) {
    console.error('No test cases to run.');
    process.exitCode = 1;
    return;
  }

  console.log('\n' + '='.repeat(65));
  console.log(`   RUNNING PLAN-QUALITY EVAL — ${dataset.length} cases, judge ${JUDGE_MODEL}`);
  console.log('='.repeat(65) + '\n');

  let printed = 0;
  const results = await runWithConcurrency(dataset, args.concurrency, async testCase => {
    const res = await evaluateCase(testCase);
    printResult(res, printed++, dataset.length);
    return res;
  });

  const total = results.length;
  const passed = results.filter(r => r.verdict === 'PASS').length;
  const passRate = total > 0 ? (passed / total) * 100 : 0;

  const tally = (pred: (r: EvalResult) => Check | undefined) => {
    const ran = results.map(pred).filter((c): c is Check => !!c);
    return { passed: ran.filter(c => c.pass).length, total: ran.length };
  };
  const allRequests = results.flatMap(r => r.requestResults);
  const requestTally = (type: ParentRequest['type']) => {
    const items = allRequests.filter(r => r.type === type);
    return {
      passed: items.filter(r => r.pass).length,
      total: items.length,
      decidedByJudge: items.filter(r => r.decidedBy === 'judge').length,
    };
  };
  const latencies = results.map(r => r.planLatencyMs).sort((a, b) => a - b);

  const summary = {
    total,
    passed,
    failed: total - passed,
    passRate,
    strengthCovered: tally(r => r.checks.strengthCovered),
    growthCovered: tally(r => r.checks.growthCovered),
    include: requestTally('include'),
    exclude: requestTally('exclude'),
    planLatencySeconds: {
      median: Math.round(latencies[Math.floor(latencies.length / 2)] / 1000),
      max: Math.round(latencies[latencies.length - 1] / 1000),
    },
  };

  console.log('-'.repeat(65));
  console.log('EVALUATION SUMMARY');
  console.log('-'.repeat(65));
  console.log(`Cases passed:      ${passed}/${total} (${passRate.toFixed(1)}%)`);
  console.log(`Strength covered:  ${summary.strengthCovered.passed}/${summary.strengthCovered.total}`);
  console.log(`Growth covered:    ${summary.growthCovered.passed}/${summary.growthCovered.total}`);
  console.log(`Included as asked: ${summary.include.passed}/${summary.include.total}  (${summary.include.decidedByJudge} decided by judge)`);
  console.log(`Excluded as asked: ${summary.exclude.passed}/${summary.exclude.total}  (${summary.exclude.decidedByJudge} decided by judge)`);
  console.log(`Plan latency:      median ${summary.planLatencySeconds.median}s, max ${summary.planLatencySeconds.max}s`);
  console.log('-'.repeat(65) + '\n');

  const output = {
    runAtIST: `${formatIST(runAt).replace('_', ' ')} IST`,
    runAt: runAt.toISOString(),
    judgeModel: JUDGE_MODEL,
    summary,
    results,
  };

  const runsDir = join(__dirname, '..', 'runs');
  mkdirSync(runsDir, { recursive: true });
  const runPath = join(runsDir, `eval_results_plan_quality_${formatIST(runAt)}_IST.json`);
  writeFileSync(runPath, JSON.stringify(output, null, 2), 'utf8');
  const latestPath = join(__dirname, '..', 'results', 'eval_results_plan_quality.json');
  writeFileSync(latestPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Detailed results logged to ${runPath}\n(also updated ${latestPath})\n`);

  if (passRate < 100) process.exitCode = 1;
}

main().catch(err => {
  console.error('Eval run failed:', err);
  process.exitCode = 1;
});
