# Spec 04 — Grounded vs. general-advice routing, and the chat turn orchestration

Implements Feature 4, and ties together the whole `POST /api/children/:id/chat/messages` request from Spec 01.

## New LLM client surface

```ts
// src/server/llm/types.ts (additions)
export interface ChatTurnMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;       // present on role: 'tool' results
  toolCalls?: { id: string; name: string; args: unknown }[];  // present on role: 'assistant' when the model is calling tools
}

export interface ToolDefinitionForModel {
  name: string;
  description: string;
  parameters: object;        // JSON Schema, derived from the Zod schema via zod-to-json-schema
}

export interface ChatCallResult {
  message: ChatTurnMessage;  // either a text reply, or an assistant message with toolCalls
  inputTokens: number;
  outputTokens: number;
  model: string;
}
```

```ts
// src/server/llm/chat-client.ts
export async function callChatModel(
  stage: 'chat' | 'chatroute',
  system: string,
  history: ChatTurnMessage[],
  tools?: ToolDefinitionForModel[],
): Promise<ChatCallResult>;
```

Provider functions added alongside the existing ones, same file-per-provider layout:
`callAnthropicChat`, `callGeminiChat`, `callOpenAICompatChat` in `src/server/llm/providers/*.ts` — each passes `history` and `tools` through to that SDK's native multi-turn + tool-use API and normalizes the response into `ChatCallResult`.

## Routing prompt (small tier)

```ts
// src/server/prompts/chat-route.ts
export const ChatRouteOutput = z.object({
  classification: z.enum(['grounded', 'general', 'mixed']),
  reasoning: z.string().max(200),   // not shown to the parent — audit/debug only
});

export function buildChatRouteMessage(userTurn: string, recentHistorySummary: string): LlmMessage;
```

Called via the existing single-shot `callModel('chatroute', msg, ChatRouteOutput)` — this step does NOT need multi-turn or tools, so it reuses the unchanged `src/server/llm/client.ts`, not the new chat client. Tier: `small`.

## Response prompt (reasoning tier, chat client, with tools)

```ts
// src/server/prompts/chat.ts
export function buildChatSystemPrompt(classification: 'grounded' | 'general' | 'mixed', childContext: ChildContext): string;

export interface ChildContext {
  childName: string;
  activeFindingsSummary: string;   // non-excluded findings, with ids, for the model to cite/reference/target with tools
  currentPlanSummary: string;      // current plan activities, with ids
}
```

System prompt rules (encode directly, don't leave to model judgement alone):
- If `classification` includes `grounded`: every claim about the child must be traceable to an id in `childContext` — the model is instructed to state "I don't have evidence for that" rather than assert an uncited claim. This mirrors `src/server/gates/citation.ts`'s rule, applied here as a prompt constraint plus a post-hoc check (below), since there is no `finding_citations` row for free-text chat prose.
- If `classification` includes `general`: ordinary parenting/education knowledge is allowed, explicitly not required to cite the child's data.
- Tool use is offered only when `classification` is `grounded` or `mixed` (no reason to offer plan/finding-editing tools on a purely general-advice turn).

## Orchestration (the route handler body)

```ts
// src/app/api/children/[id]/chat/messages/route.ts (pseudocode-level)
async function POST(req, { params }) {
  const child = await verifyOwnership(params.id, user.familyId);
  const conversation = await getOrCreateConversation(child.id, user.familyId);
  const { content } = await req.json();

  const userMessage = await appendMessage({ conversationId: conversation.id, role: 'user', content, familyId: user.familyId });

  const route = await callModel('chatroute', buildChatRouteMessage(content, summarizeRecent(conversation.id)), ChatRouteOutput);
  const childContext = await loadChildContext(child.id);   // active findings + current plan, with ids — read-only queries against existing tables

  const system = buildChatSystemPrompt(route.value.classification, childContext);
  const tools = route.value.classification === 'general' ? undefined : TOOL_DEFINITIONS_FOR_MODEL;

  let turn = await callChatModel('chat', system, loadHistory(conversation.id), tools);

  // Tool-call loop: execute, feed results back, repeat until the model returns text.
  while (turn.message.toolCalls?.length) {
    const results = await Promise.all(turn.message.toolCalls.map(call =>
      dispatchTool(call.name, call.args, { familyId: user.familyId, childId: child.id, conversationId: conversation.id, messageId: userMessage.id, actorProfileId: user.profileId })
    ));
    turn = await callChatModel('chat', system, [...loadHistory(conversation.id), turn.message, ...toToolResultMessages(results)], tools);
  }

  const assistantMessage = await appendMessage({
    conversationId: conversation.id, role: 'assistant', content: turn.message.content,
    familyId: user.familyId, toolResults: /* collected across the loop */, routeClassification: route.value.classification,
    promptVersion: versionTag('chat'), modelDeployment: turn.model,
  });

  return NextResponse.json({ userMessage, assistantMessage });
}
```

## Edge cases

- Routing call fails (provider error) → fall back to `classification: 'general'` with no tools offered, rather than failing the whole turn — a conservative default that can't write data it shouldn't.
- Response claims something about the child with no backing id in `childContext` on a `grounded`/`mixed` turn → this is a prompt-adherence risk, not something code can fully prevent; flag as an eval case (extend `evals/runners/groundedness.eval.ts`, parked on `archive/pipeline-app-and-review`, to cover chat replies once that tooling is cherry-picked back in).
- Tool-call loop exceeds a small max-iteration count (e.g. 4) → break and return whatever text the model has produced, to avoid an unbounded loop on a misbehaving tool sequence.
