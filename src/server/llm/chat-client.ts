import type { ChatTurnMessage, ToolDefinitionForModel, ChatCallResult } from './types.js';
import { callAnthropicChat } from './providers/anthropic.js';
import { callGeminiChat } from './providers/gemini.js';
import { callOpenAICompatChat } from './providers/openai-compat.js';
import { logLlmRequest } from '../db/llm-request-log.js';
import { versionTag } from '../prompts/version.js';

type CompatProvider = 'openai' | 'grok' | 'kimi';

/**
 * The four conversational stages, each its own reasoning-tier model call —
 * the orchestrator and the three agents it can hand a turn to. Replaces
 * 'chatroute'/'chat'. See docs/specs/08-orchestrator-chat.md.
 */
export type ChatStage = 'chat_orchestrator' | 'chat_report_agent' | 'chat_planning_agent' | 'chat_generic_agent';

// None of these stages go through callModel()/STAGE_TIER in client.ts — they
// are multi-turn, tool-capable calls, routed through this file instead. Only
// the routing/classification step used to be the exception (chatroute, now
// retired); every stage here always goes through callChatModel().
const DEFAULT_PROVIDER = 'openai';

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-opus-5',
  gemini: 'gemini-3.5-flash',
  openai: 'gpt-4o',
  grok: 'grok-3',
  kimi: 'moonshot-v1-128k',
};

function env(key: string): string | undefined {
  return process.env[key] || undefined;
}

/**
 * Resolution order per stage: LLM_<STAGE>_PROVIDER/_MODEL overrides the
 * shared LLM_CHAT_PROVIDER/_MODEL default (today's single chat-wide knob,
 * kept as the fallback layer), which overrides the hardcoded default. Same
 * convention as callModel()'s per-stage/tier/hardcoded resolution in
 * client.ts.
 */
function resolveProvider(stage: ChatStage): string {
  return env(`LLM_${stage.toUpperCase()}_PROVIDER`) ?? env('LLM_CHAT_PROVIDER') ?? DEFAULT_PROVIDER;
}

function resolveModel(stage: ChatStage, provider: string): string {
  return env(`LLM_MODEL_${stage.toUpperCase()}`) ?? env('LLM_MODEL_CHAT') ?? DEFAULT_MODELS[provider] ?? 'gpt-4o';
}

/**
 * Multi-turn chat with tool use. Distinct from callModel() in client.ts,
 * which stays single-shot for the pipeline stages. See
 * docs/engineering/engineering-doc.md §2-§3 for why this call is made inline
 * from an API route rather than from the worker.
 */
export async function callChatModel(
  stage: ChatStage,
  system: string,
  history: ChatTurnMessage[],
  tools?: ToolDefinitionForModel[],
  familyId?: string,
): Promise<ChatCallResult> {
  const provider = resolveProvider(stage);
  const model = resolveModel(stage, provider);
  const started = Date.now();
  // The full history, not just the newest turn: the tool-call loop (orchestrator
  // and each agent's own loop) calls this repeatedly with the history growing each
  // time, so this is genuinely what was sent to the model for THIS call.
  const requestText = JSON.stringify({ system, history, tools: tools?.map(t => t.name) });

  try {
    const result = provider === 'anthropic'
      ? await callAnthropicChat(model, system, history, tools)
      : provider === 'gemini'
        ? await callGeminiChat(model, system, history, tools)
        : await callOpenAICompatChat(provider as CompatProvider, model, system, history, tools);

    await logLlmRequest({
      stage, provider, model: result.model, promptVersion: versionTag(stage), familyId,
      status: 'ok', inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      latencyMs: Date.now() - started,
      requestText, responseText: JSON.stringify({ content: result.message.content, toolCalls: result.message.toolCalls }),
    });
    return result;
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    await logLlmRequest({
      stage, provider, model, promptVersion: versionTag(stage), familyId,
      status: 'error', errorCode: status ? `PROVIDER_ERROR_${status}` : 'PROVIDER_ERROR',
      latencyMs: Date.now() - started,
      requestText, responseText: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
