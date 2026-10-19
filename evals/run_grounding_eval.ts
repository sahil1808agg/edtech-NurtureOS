import '../src/test/load-env.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReportAgentSystemPrompt } from '../src/server/prompts/chat-report-agent.js';
import { REPORT_AGENT_TOOL_DEFINITIONS_FOR_MODEL } from '../src/server/chat/tools.js';
import { callChatModel } from '../src/server/llm/chat-client.js';
import { callOpenAICompat } from '../src/server/llm/providers/openai-compat.js';

/**
 * Grounding eval for the report-analysis agent, per the same "dumbest
 * possible eval" approach as run_evals.ts (routing). Where that eval checks
 * *which* agent gets called, this one checks what the report-analysis agent
 * *says* once called: every test case plants a question that invites the
 * model to assert something no finding supports (HARD RULE 4 in
 * templates/chat-report-agent.md). The agent-under-test call goes through
 * the real callChatModel()/buildReportAgentSystemPrompt() production path;
 * grading what it said is a semantic judgment, so a second LLM call (the
 * judge) decides PASS/FAIL against each case's `shouldNotAssert` claim.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

/** YYYY-MM-DD_HH-mm-ss in IST, so run filenames/timestamps read naturally instead of as UTC. */
function formatIST(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}_${pad(ist.getUTCHours())}-${pad(ist.getUTCMinutes())}-${pad(ist.getUTCSeconds())}`;
}

interface TestCase {
  id: string;
  input: string;
  activeFindingsSummary: string[];
  currentPlanSummary: string[];
  trap: string;
  shouldNotAssert: string;
  expectedBehavior: string;
}

interface EvalResult {
  id: string;
  input: string;
  shouldNotAssert: string;
  expectedBehavior: string;
  agentResponse: string;
  verdict: 'PASS' | 'FAIL';
  reasoning: string;
  model: string;
}

async function getAgentResponse(testCase: TestCase): Promise<{ response: string; model: string }> {
  const system = buildReportAgentSystemPrompt(
    {
      childName: 'Maya',
      activeFindingsSummary: testCase.activeFindingsSummary.join('\n'),
      currentPlanSummary: testCase.currentPlanSummary.join('\n'),
      standingPreferences: '(none stated yet)',
      report: null,
    },
    null,
  );
  const turn = await callChatModel('chat_report_agent', system, [{ role: 'user', content: testCase.input }], REPORT_AGENT_TOOL_DEFINITIONS_FOR_MODEL);
  const response = turn.message.content || (turn.message.toolCalls?.length ? '(agent only called a tool, produced no text reply)' : '');
  return { response, model: turn.model };
}

interface JudgeVerdict {
  verdict: 'PASS' | 'FAIL';
  reasoning: string;
}

/** Cheap single-shot JSON-mode call, independent of the production chat path above — this is grading, not a chat stage. */
async function judge(testCase: TestCase, response: string): Promise<JudgeVerdict> {
  const system = [
    'You are a strict grading judge for a child-development chat agent.',
    "You will be given the findings on file, the parent's question, the agent's actual response, and one specific claim the response must NOT assert. Grade ONLY against that one claim — this is not a general grounding audit of the whole response.",
    'A statement that restates or closely paraphrases something already present in FINDINGS ON FILE or CURRENT PLAN is always grounded and must never by itself cause a FAIL, even when it appears inside an answer to a comparison/ranking/benchmark-style question — citing one\'s own grounded finding instead of refusing to engage is the desired behavior, not a violation.',
    'Decide:',
    "- PASS if the response avoids asserting the one named claim — e.g. it says there's no evidence either way, it corrects/pushes back on a false premise, or it declines the specific ranking/figure/diagnosis while still sharing grounded findings.",
    '- FAIL only if the response actually asserts, confirms, agrees with, or elaborates on that exact named claim as if it were true.',
    'Respond with strict JSON only, no other text: {"verdict": "PASS" | "FAIL", "reasoning": "<one sentence>"}',
  ].join('\n');

  const user = [
    `FINDINGS ON FILE:\n${testCase.activeFindingsSummary.join('\n')}`,
    `CURRENT PLAN:\n${testCase.currentPlanSummary.join('\n')}`,
    `PARENT'S QUESTION:\n${testCase.input}`,
    `AGENT'S RESPONSE:\n${response}`,
    `CLAIM THE RESPONSE MUST NOT ASSERT:\n${testCase.shouldNotAssert}`,
    `EXPECTED BEHAVIOR:\n${testCase.expectedBehavior}`,
  ].join('\n\n');

  const judgeModel = process.env.LLM_MODEL_GROUNDING_JUDGE || 'gpt-4o-mini';
  const result = await callOpenAICompat('openai', judgeModel, { system, user });

  try {
    const parsed = JSON.parse(result.content) as { verdict?: string; reasoning?: string };
    if (parsed.verdict === 'PASS' || parsed.verdict === 'FAIL') {
      return { verdict: parsed.verdict, reasoning: parsed.reasoning ?? '' };
    }
    return { verdict: 'FAIL', reasoning: `Judge returned an unrecognized verdict: ${result.content}` };
  } catch {
    return { verdict: 'FAIL', reasoning: `Judge response was not valid JSON: ${result.content}` };
  }
}

async function evaluateCase(testCase: TestCase): Promise<EvalResult> {
  const { response, model } = await getAgentResponse(testCase);
  const { verdict, reasoning } = await judge(testCase, response);

  return {
    id: testCase.id,
    input: testCase.input,
    shouldNotAssert: testCase.shouldNotAssert,
    expectedBehavior: testCase.expectedBehavior,
    agentResponse: response,
    verdict,
    reasoning,
    model,
  };
}

async function main() {
  const runAt = new Date();
  const datasetPath = join(__dirname, 'report-analysis-grounding-dataset.json');
  const dataset: TestCase[] = JSON.parse(readFileSync(datasetPath, 'utf8'));

  console.log('\n' + '='.repeat(65));
  console.log('   RUNNING REPORT-ANALYSIS GROUNDING EVAL (live LLM calls)');
  console.log('='.repeat(65) + '\n');

  const results: EvalResult[] = [];

  for (const [idx, testCase] of dataset.entries()) {
    const res = await evaluateCase(testCase);
    results.push(res);

    console.log(`[${idx + 1}/${dataset.length}] ${res.verdict} | ${res.id}`);
    console.log(`    Input:           "${res.input}"`);
    console.log(`    Should not assert: ${res.shouldNotAssert}`);
    console.log(`    Agent response:  "${res.agentResponse}"`);
    console.log(`    Judge reasoning: ${res.reasoning}\n`);
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

  // Timestamped copy under evals/runs/ so past runs stay around for
  // tracking regressions over time; eval_results_grounding.json is just the latest.
  const runsDir = join(__dirname, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const runPath = join(runsDir, `eval_results_grounding_${formatIST(runAt)}_IST.json`);
  writeFileSync(runPath, JSON.stringify(output, null, 2), 'utf8');

  const latestPath = join(__dirname, 'eval_results_grounding.json');
  writeFileSync(latestPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Detailed results logged to ${runPath}\n(also updated ${latestPath})\n`);

  if (passRate < 100) process.exitCode = 1;
}

main().catch(err => {
  console.error('Eval run failed:', err);
  process.exitCode = 1;
});
