import { callChatModel } from '../llm/chat-client.js';
import { dispatchTool, type ToolDispatchContext, type ToolDispatchResult } from './dispatch.js';
import { loadReportAgentContext } from './report-status.js';
import { buildReportAgentSystemPrompt } from '../prompts/chat-report-agent.js';
import { buildPlanningAgentSystemPrompt } from '../prompts/chat-planning-agent.js';
import { buildGenericAgentSystemPrompt } from '../prompts/chat-generic-agent.js';
import { REPORT_AGENT_TOOL_DEFINITIONS_FOR_MODEL, PLANNING_AGENT_TOOL_DEFINITIONS_FOR_MODEL, type AgentName } from './tools.js';
import type { ChildContext } from '../prompts/chat-orchestrator.js';
import type { ChatTurnMessage, ChatToolCall, ToolDefinitionForModel } from '../llm/types.js';

/**
 * Runs the agent the orchestrator just called — its own callChatModel()
 * turn (own system prompt, own tool list), looping on tool calls via the
 * *existing* dispatchTool() exactly like today's direct-apply loop, just one
 * level deeper. The agent's result (final text + which tools it ran) comes
 * back to the orchestrator as a single role: 'tool' message. See
 * docs/specs/08-orchestrator-chat.md.
 */

const MAX_AGENT_TOOL_ITERATIONS = 4;

export interface AgentDispatchContext {
  familyId: string;
  childId: string;
  conversationId: string;
  messageId: string;
  actorProfileId: string;
  childContext: ChildContext;
}

export interface AgentDispatchResult {
  /** Text handed back to the orchestrator as the tool-call result. */
  text: string;
  /** Every direct-apply tool call this agent made, for the top-level audit/collected-results list. */
  toolCalls: { call: ChatToolCall; result: ToolDispatchResult }[];
}

export async function dispatchAgent(agentName: AgentName, question: string, ctx: AgentDispatchContext): Promise<AgentDispatchResult> {
  switch (agentName) {
    case 'report_analysis_agent':
      return runReportAgent(question, ctx);
    case 'planning_agent':
      return runPlanningAgent(question, ctx);
    case 'generic_agent':
      return runGenericAgent(question, ctx);
  }
}

async function runGenericAgent(question: string, ctx: AgentDispatchContext): Promise<AgentDispatchResult> {
  const system = buildGenericAgentSystemPrompt(ctx.childContext);
  const turn = await callChatModel('chat_generic_agent', system, [{ role: 'user', content: question }], undefined, ctx.familyId);
  return { text: turn.message.content, toolCalls: [] };
}

async function runReportAgent(question: string, ctx: AgentDispatchContext): Promise<AgentDispatchResult> {
  const reportCtx = await loadReportAgentContext(ctx.childId, ctx.conversationId);

  const toolCalls: { call: ChatToolCall; result: ToolDispatchResult }[] = [];
  if (reportCtx.reanalysisRequestedForReportId) {
    const result = await dispatchTool(
      'request_report_reanalysis',
      { reportId: reportCtx.reanalysisRequestedForReportId },
      { ...toolDispatchContext(ctx), agentName: 'report_agent' },
    );
    toolCalls.push({ call: { id: 'auto-reanalyse', name: 'request_report_reanalysis', args: { reportId: reportCtx.reanalysisRequestedForReportId } }, result });
  }

  const system = buildReportAgentSystemPrompt(ctx.childContext, reportCtx.statusNote);
  const { text, toolCalls: loopToolCalls } = await runAgentToolLoop(
    'chat_report_agent',
    system,
    question,
    REPORT_AGENT_TOOL_DEFINITIONS_FOR_MODEL,
    { ...toolDispatchContext(ctx), agentName: 'report_agent' },
    ctx.familyId,
  );

  return { text, toolCalls: [...toolCalls, ...loopToolCalls] };
}

async function runPlanningAgent(question: string, ctx: AgentDispatchContext): Promise<AgentDispatchResult> {
  const system = buildPlanningAgentSystemPrompt(ctx.childContext);
  const { text, toolCalls } = await runAgentToolLoop(
    'chat_planning_agent',
    system,
    question,
    PLANNING_AGENT_TOOL_DEFINITIONS_FOR_MODEL,
    { ...toolDispatchContext(ctx), agentName: 'planning_agent' },
    ctx.familyId,
  );
  return { text, toolCalls };
}

function toolDispatchContext(ctx: AgentDispatchContext): Omit<ToolDispatchContext, 'agentName'> {
  return {
    familyId: ctx.familyId,
    childId: ctx.childId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    actorProfileId: ctx.actorProfileId,
  };
}

async function runAgentToolLoop(
  stage: 'chat_report_agent' | 'chat_planning_agent',
  system: string,
  question: string,
  tools: ToolDefinitionForModel[],
  dispatchCtx: ToolDispatchContext,
  familyId: string,
): Promise<{ text: string; toolCalls: { call: ChatToolCall; result: ToolDispatchResult }[] }> {
  const history: ChatTurnMessage[] = [{ role: 'user', content: question }];
  const toolCalls: { call: ChatToolCall; result: ToolDispatchResult }[] = [];

  let turn = await callChatModel(stage, system, history, tools, familyId);
  let iterations = 0;

  while (turn.message.toolCalls?.length && iterations < MAX_AGENT_TOOL_ITERATIONS) {
    iterations += 1;
    const calls = turn.message.toolCalls;
    const results = await Promise.all(calls.map(call => dispatchTool(call.name, call.args, dispatchCtx)));
    toolCalls.push(...calls.map((call, i) => ({ call, result: results[i] })));

    history.push(turn.message);
    for (const [i, call] of calls.entries()) {
      const result = results[i];
      history.push({
        role: 'tool',
        toolCallId: call.id,
        content: result.ok ? result.summary : `Error: ${result.error?.message ?? 'tool failed'}`,
      });
    }

    turn = await callChatModel(stage, system, history, tools, familyId);
  }

  return { text: turn.message.content, toolCalls };
}
