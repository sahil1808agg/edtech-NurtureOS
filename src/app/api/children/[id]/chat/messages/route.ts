import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../../lib/db/server';
import { getOrCreateConversation } from '../../../../../../server/db/conversations';
import { appendMessage, listMessages } from '../../../../../../server/db/messages';
import { callChatModel } from '../../../../../../server/llm/chat-client';
import { versionTag } from '../../../../../../server/prompts/version';
import { buildOrchestratorSystemPrompt } from '../../../../../../server/prompts/chat-orchestrator';
import { AGENT_TOOL_DEFINITIONS_FOR_MODEL, AgentCallArgs, AGENT_NAMES, type AgentName } from '../../../../../../server/chat/tools';
import { dispatchAgent } from '../../../../../../server/chat/orchestrator-dispatch';
import { loadChildContext } from '../../../../../../server/chat/context';
import { toChatHistory } from '../../../../../../server/chat/history';
import type { ChatTurnMessage } from '../../../../../../server/llm/types';

export const runtime = 'nodejs';

// Agent calls, not direct-apply tool calls — allows the orchestrator to chain
// e.g. report_analysis_agent then planning_agent in one turn. See
// docs/specs/08-orchestrator-chat.md.
const MAX_AGENT_ITERATIONS = 4;

function isAgentName(name: string): name is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(name);
}

/**
 * The full chat turn: build the shared child context -> orchestrator call,
 * looping on agent hand-offs (each a nested callChatModel + tool loop of its
 * own, see orchestrator-dispatch.ts) -> persist and return the reply.
 * Replaces the classify-then-chat flow (docs/specs/04-grounded-general-routing.md)
 * with true sub-agent tool-calling. See docs/specs/08-orchestrator-chat.md.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: childId } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: child } = await db
    .from('children')
    .select('id, family_id')
    .eq('id', childId)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!child) return NextResponse.json({ error: 'Child not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 });

  const conversation = await getOrCreateConversation(childId, child.family_id);
  const priorMessages = await listMessages(conversation.id, {});

  const userMessage = await appendMessage({
    conversationId: conversation.id,
    familyId: child.family_id,
    role: 'user',
    content,
  });

  // Loaded once per turn and threaded to the orchestrator and every agent it
  // calls, not reloaded per agent call.
  const childContext = await loadChildContext(childId);
  const system = buildOrchestratorSystemPrompt(childContext);
  const history: ChatTurnMessage[] = [...toChatHistory(priorMessages), { role: 'user', content }];

  const collectedToolResults: unknown[] = [];
  let turn;
  let iterations = 0;

  try {
    turn = await callChatModel('chat_orchestrator', system, history, AGENT_TOOL_DEFINITIONS_FOR_MODEL, child.family_id);

    while (turn.message.toolCalls?.length && iterations < MAX_AGENT_ITERATIONS) {
      iterations += 1;
      const calls = turn.message.toolCalls;

      const results = await Promise.all(
        calls.map(async call => {
          if (!isAgentName(call.name)) {
            return { text: `Error: unknown agent "${call.name}"`, toolCalls: [] };
          }
          const parsed = AgentCallArgs.safeParse(call.args);
          if (!parsed.success) {
            return { text: `Error: ${parsed.error.message}`, toolCalls: [] };
          }
          return dispatchAgent(call.name, parsed.data.question, {
            familyId: child.family_id,
            childId,
            conversationId: conversation.id,
            messageId: userMessage.id,
            actorProfileId: user.id,
            childContext,
          });
        }),
      );

      collectedToolResults.push(
        ...calls.map((call, i) => ({ agent: call.name, question: (call.args as { question?: string })?.question, result: results[i].text, toolCalls: results[i].toolCalls })),
      );

      history.push(turn.message);
      for (const [i, call] of calls.entries()) {
        history.push({ role: 'tool', toolCallId: call.id, content: results[i].text });
      }

      turn = await callChatModel('chat_orchestrator', system, history, AGENT_TOOL_DEFINITIONS_FOR_MODEL, child.family_id);
    }
  } catch (err) {
    return NextResponse.json(
      { userMessage, error: err instanceof Error ? err.message : 'Chat model call failed' },
      { status: 502 },
    );
  }

  const assistantMessage = await appendMessage({
    conversationId: conversation.id,
    familyId: child.family_id,
    role: 'assistant',
    content: turn.message.content,
    toolResults: collectedToolResults.length ? collectedToolResults : undefined,
    promptVersion: versionTag('chat_orchestrator'),
    modelDeployment: turn.model,
  });

  return NextResponse.json({ userMessage, assistantMessage });
}
