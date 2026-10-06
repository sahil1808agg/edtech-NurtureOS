import '../src/test/load-env.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOrchestratorSystemPrompt, type ChildContext } from '../src/server/prompts/chat-orchestrator.js';
import { AGENT_TOOL_DEFINITIONS_FOR_MODEL, AGENT_NAMES, type AgentName } from '../src/server/chat/tools.js';
import { callChatModel } from '../src/server/llm/chat-client.js';

/**
 * Binary pass/fail routing eval, per Hamel Hussain's "write the dumbest
 * possible eval that would catch a real regression" approach. This calls
 * the real orchestrator — same system prompt builder, same tool schema,
 * same callChatModel() the chat API route uses (route.ts) — it just skips
 * the DB-backed ChildContext and dispatchAgent() execution, since routing
 * is decided entirely by which tool(s) the model picks in this one call.
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
  expectedAgent: AgentName;
}

interface EvalResult {
  id: string;
  input: string;
  expectedAgent: AgentName;
  actualAgents: string[];
  verdict: 'PASS' | 'FAIL';
  reasoning: string;
  model: string;
}

// Fixture context shared across cases — real findings/plan ids would only
// matter to the agent handling the follow-up, not to the orchestrator's
// choice of which agent to call.
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
};

function isAgentName(name: string): name is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(name);
}

async function routeCase(input: string): Promise<{ agents: string[]; model: string }> {
  const system = buildOrchestratorSystemPrompt(FIXTURE_CONTEXT);
  const turn = await callChatModel('chat_orchestrator', system, [{ role: 'user', content: input }], AGENT_TOOL_DEFINITIONS_FOR_MODEL);
  const agents = (turn.message.toolCalls ?? []).map(c => c.name);
  return { agents, model: turn.model };
}

async function evaluateCase(testCase: TestCase): Promise<EvalResult> {
  const { agents, model } = await routeCase(testCase.input);
  const unknown = agents.filter(a => !isAgentName(a));

  const isPass = agents.length === 1 && agents[0] === testCase.expectedAgent;

  let reasoning: string;
  if (agents.length === 0) {
    reasoning = `Expected '${testCase.expectedAgent}' but the orchestrator called no agent at all.`;
  } else if (unknown.length) {
    reasoning = `Orchestrator called unrecognized tool name(s): ${unknown.join(', ')}.`;
  } else if (isPass) {
    reasoning = `Correctly routed to '${testCase.expectedAgent}'.`;
  } else {
    reasoning = `Expected '${testCase.expectedAgent}', got [${agents.join(', ')}].`;
  }

  return {
    id: testCase.id,
    input: testCase.input,
    expectedAgent: testCase.expectedAgent,
    actualAgents: agents,
    verdict: isPass ? 'PASS' : 'FAIL',
    reasoning,
    model,
  };
}

async function main() {
  const runAt = new Date();
  const datasetPath = join(__dirname, 'dataset.json');
  const dataset: TestCase[] = JSON.parse(readFileSync(datasetPath, 'utf8'));

  console.log('\n' + '='.repeat(65));
  console.log('      RUNNING ORCHESTRATOR ROUTING EVAL (live LLM calls)');
  console.log('='.repeat(65) + '\n');

  const results: EvalResult[] = [];

  for (const [idx, testCase] of dataset.entries()) {
    const res = await evaluateCase(testCase);
    results.push(res);

    const status = res.verdict === 'PASS' ? 'PASS' : 'FAIL';
    console.log(`[${idx + 1}/${dataset.length}] ${status} | ${res.id}`);
    console.log(`    Input:    "${res.input}"`);
    console.log(`    Expected: ${res.expectedAgent}`);
    console.log(`    Actual:   ${res.actualAgents.length ? res.actualAgents.join(', ') : '(none)'}`);
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

  // Timestamped copy under evals/runs/ so past runs stay around for
  // tracking regressions over time; eval_results.json is just the latest.
  const runsDir = join(__dirname, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const runPath = join(runsDir, `eval_results_${formatIST(runAt)}_IST.json`);
  writeFileSync(runPath, JSON.stringify(output, null, 2), 'utf8');

  const latestPath = join(__dirname, 'eval_results.json');
  writeFileSync(latestPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Detailed results logged to ${runPath}\n(also updated ${latestPath})\n`);

  if (passRate < 100) process.exitCode = 1;
}

main().catch(err => {
  console.error('Eval run failed:', err);
  process.exitCode = 1;
});
