import '../src/test/load-env.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlanningAgentSystemPrompt } from '../src/server/prompts/chat-planning-agent.js';
import type { ChildContext } from '../src/server/prompts/chat-orchestrator.js';
import { PLANNING_AGENT_TOOL_DEFINITIONS_FOR_MODEL, type ToolName } from '../src/server/chat/tools.js';
import { callChatModel } from '../src/server/llm/chat-client.js';

/**
 * Binary pass/fail tool-selection eval for the planning agent, same "dumbest
 * possible eval" approach as run_evals.ts (orchestrator routing) — just one
 * layer deeper: where that eval checks which AGENT gets called, this checks
 * which TOOL the planning agent picks once it's already been handed a turn,
 * and (for edit_plan_activity) whether it targeted the right activityId
 * with the right declined flag. This is exactly the ambiguity
 * templates/chat-planning-agent.md calls out — one-off feedback on a single
 * activity (edit_plan_activity/decline) vs. a lasting preference
 * (update_family_interests) — and the ambiguity that produced the
 * routing-eval miss on "mark the reading activity as declined" (see
 * evals/dataset.json planning-003). No judge needed: tool choice and args
 * are exact-match checks on the model's own first tool-call turn, not a
 * semantic judgment about text it wrote.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

function formatIST(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}_${pad(ist.getUTCHours())}-${pad(ist.getUTCMinutes())}-${pad(ist.getUTCSeconds())}`;
}

interface TestCase {
  id: string;
  input: string;
  expectedTools: ToolName[];
  /** Only checked when expectedTools includes edit_plan_activity. */
  expectedActivityId?: string;
  /**
   * true requires declined to be exactly true. false requires it NOT to be
   * true — `undefined` (field omitted, meaning "don't touch declined") is a
   * valid way to satisfy false, since editPlanActivity (dispatch.ts) treats
   * an omitted declined as "leave it as-is," not "set it to false".
   */
  expectedDeclined?: boolean;
  note: string;
}

interface EvalResult {
  id: string;
  input: string;
  expectedTools: ToolName[];
  actualTools: string[];
  verdict: 'PASS' | 'FAIL';
  reasoning: string;
  model: string;
}

// Same fixture ids as evals/dataset.json's FIXTURE_CONTEXT, so an activityId
// check here means something concrete: a1111111... is "Daily reading",
// a2222222... is "Letter tracing".
const FIXTURE_CONTEXT: ChildContext = {
  childName: 'Maya',
  activeFindingsSummary: [
    '- [f1111111-1111-1111-1111-111111111111] Building confidence sounding out unfamiliar words while reading aloud',
    '- [f2222222-2222-2222-2222-222222222222] Strong number sense; comfortable with addition and subtraction within 20',
    '- [f3333333-3333-3333-3333-333333333333] Handwriting legibility is inconsistent, especially with lowercase letters',
  ].join('\n'),
  currentPlanSummary: [
    '- [a1111111-1111-1111-1111-111111111111] Daily reading: Read 10 minutes aloud together, sounding out tricky words',
    '- [a2222222-2222-2222-2222-222222222222] Letter tracing: Practice lowercase letter formation 3x/week',
  ].join('\n'),
  standingPreferences: '(none stated yet)',
  report: null,
};

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

async function evaluateCase(testCase: TestCase): Promise<EvalResult> {
  const system = buildPlanningAgentSystemPrompt(FIXTURE_CONTEXT);
  const turn = await callChatModel('chat_planning_agent', system, [{ role: 'user', content: testCase.input }], PLANNING_AGENT_TOOL_DEFINITIONS_FOR_MODEL);
  const calls = turn.message.toolCalls ?? [];
  const actualTools = calls.map(c => c.name);

  let verdict: 'PASS' | 'FAIL' = 'PASS';
  let reasoning: string;

  if (!sameSet(actualTools, testCase.expectedTools)) {
    verdict = 'FAIL';
    reasoning = `Expected tool(s) [${testCase.expectedTools.join(', ')}] but got [${actualTools.length ? actualTools.join(', ') : '(none)'}].`;
  } else if (testCase.expectedActivityId !== undefined || testCase.expectedDeclined !== undefined) {
    const editCall = calls.find(c => c.name === 'edit_plan_activity');
    const args = editCall?.args as { activityId?: string; declined?: boolean; title?: string; instructions?: string } | undefined;

    if (testCase.expectedActivityId !== undefined && args?.activityId !== testCase.expectedActivityId) {
      verdict = 'FAIL';
      reasoning = `edit_plan_activity targeted activityId "${args?.activityId}" but expected "${testCase.expectedActivityId}".`;
    } else if (testCase.expectedDeclined === true && args?.declined !== true) {
      verdict = 'FAIL';
      reasoning = `edit_plan_activity called with declined=${args?.declined} but expected declined=true.`;
    } else if (testCase.expectedDeclined === false && args?.declined === true) {
      verdict = 'FAIL';
      reasoning = `edit_plan_activity called with declined=true but this was a non-decline edit — expected declined to stay false/unset.`;
    } else {
      reasoning = `Correctly called edit_plan_activity on "${args?.activityId}" with declined=${args?.declined}.`;
    }
  } else {
    reasoning = `Correctly called [${actualTools.join(', ')}].`;
  }

  return {
    id: testCase.id,
    input: testCase.input,
    expectedTools: testCase.expectedTools,
    actualTools,
    verdict,
    reasoning,
    model: turn.model,
  };
}

async function main() {
  const runAt = new Date();
  const datasetPath = join(__dirname, 'planning-tool-selection-dataset.json');
  const dataset: TestCase[] = JSON.parse(readFileSync(datasetPath, 'utf8'));

  console.log('\n' + '='.repeat(65));
  console.log('   RUNNING PLANNING-AGENT TOOL-SELECTION EVAL (live LLM calls)');
  console.log('='.repeat(65) + '\n');

  const results: EvalResult[] = [];

  for (const [idx, testCase] of dataset.entries()) {
    const res = await evaluateCase(testCase);
    results.push(res);

    console.log(`[${idx + 1}/${dataset.length}] ${res.verdict} | ${res.id}`);
    console.log(`    Input:    "${res.input}"`);
    console.log(`    Expected: [${res.expectedTools.join(', ')}]`);
    console.log(`    Actual:   [${res.actualTools.length ? res.actualTools.join(', ') : '(none)'}]`);
    console.log(`    Details:  ${res.reasoning}\n`);
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
  const runPath = join(runsDir, `eval_results_planning_tools_${formatIST(runAt)}_IST.json`);
  writeFileSync(runPath, JSON.stringify(output, null, 2), 'utf8');

  const latestPath = join(__dirname, 'eval_results_planning_tools.json');
  writeFileSync(latestPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Detailed results logged to ${runPath}\n(also updated ${latestPath})\n`);

  if (passRate < 100) process.exitCode = 1;
}

main().catch(err => {
  console.error('Eval run failed:', err);
  process.exitCode = 1;
});
