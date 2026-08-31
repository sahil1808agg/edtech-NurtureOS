import type { ZodSchema } from 'zod';
import type { ModelTier, LlmMessage, LlmResponse } from './types.js';
import type { StageResult } from '../pipeline/types.js';
import type { PromptKey } from '../prompts/version.js';
import { versionTag } from '../prompts/version.js';
import { callAnthropic } from './providers/anthropic.js';
import { callGemini } from './providers/gemini.js';
import { callOpenAICompat } from './providers/openai-compat.js';

type CompatProvider = 'openai' | 'grok' | 'kimi';

// Fallback tier per stage — used only when a stage has no LLM_<STAGE>_PROVIDER/_MODEL override.
const STAGE_TIER: Record<PromptKey, ModelTier> = {
  extract: 'vision',
  normalise: 'reasoning',
  analyse: 'reasoning',
  corroborate: 'small',
  plan: 'reasoning',
  checkin: 'small',
};

const TIER_ENV: Record<ModelTier, string> = {
  vision: 'LLM_VISION_PROVIDER',
  reasoning: 'LLM_REASONING_PROVIDER',
  small: 'LLM_SMALL_PROVIDER',
};

const TIER_MODEL_ENV: Record<ModelTier, string> = {
  vision: 'LLM_MODEL_VISION',
  reasoning: 'LLM_MODEL_REASONING',
  small: 'LLM_MODEL_SMALL',
};

const DEFAULT_PROVIDER: Record<ModelTier, string> = {
  vision: 'gemini',
  reasoning: 'gemini',
  small: 'openai',
};

const DEFAULT_MODELS: Record<string, Record<ModelTier, string>> = {
  anthropic: { vision: 'claude-opus-5', reasoning: 'claude-opus-5', small: 'claude-haiku-4-5-20251001' },
  gemini:    { vision: 'gemini-3.5-flash-lite', reasoning: 'gemini-3.5-flash', small: 'gemini-3.5-flash-lite' },
  openai:    { vision: 'gpt-4o',          reasoning: 'gpt-4o',          small: 'gpt-4o-mini' },
  grok:      { vision: 'grok-2-vision-1212', reasoning: 'grok-3',       small: 'grok-3-mini' },
  kimi:      { vision: 'moonshot-v1-128k', reasoning: 'moonshot-v1-128k', small: 'moonshot-v1-8k' },
};

// A declared-but-blank env var (`LLM_MODEL_VISION=`) must fall through like an
// unset one — `??` alone treats "" as present and would resolve to an empty model/provider.
function env(key: string): string | undefined {
  return process.env[key] || undefined;
}

/**
 * Resolution order per stage: LLM_<STAGE>_PROVIDER/_MODEL overrides the
 * shared tier default (LLM_<TIER>_PROVIDER/_MODEL), which overrides the
 * hardcoded per-provider default. This lets every prompt pick its own
 * model, while still allowing one env var to set a sane default across a tier.
 */
function resolveProvider(stage: PromptKey): string {
  const tier = STAGE_TIER[stage];
  return (
    env(`LLM_${stage.toUpperCase()}_PROVIDER`) ??
    env(TIER_ENV[tier]) ??
    DEFAULT_PROVIDER[tier]
  );
}

function resolveModel(stage: PromptKey, provider: string): string {
  const tier = STAGE_TIER[stage];
  return (
    env(`LLM_MODEL_${stage.toUpperCase()}`) ??
    env(TIER_MODEL_ENV[tier]) ??
    DEFAULT_MODELS[provider]?.[tier] ??
    'gpt-4o'
  );
}

// Per-stage only (e.g. LLM_THINKING_PLAN=high) — currently a Gemini-specific knob
// (thinkingConfig.thinkingLevel); left unset, the model's own default applies.
function resolveThinkingLevel(stage: PromptKey): string | undefined {
  return env(`LLM_THINKING_${stage.toUpperCase()}`);
}

async function dispatch(stage: PromptKey, msg: LlmMessage): Promise<LlmResponse> {
  const provider = resolveProvider(stage);
  const model = resolveModel(stage, provider);
  if (provider === 'anthropic') return callAnthropic(model, msg);
  if (provider === 'gemini') return callGemini(model, msg, resolveThinkingLevel(stage));
  return callOpenAICompat(provider as CompatProvider, model, msg);
}

export async function callModel<T>(
  stage: PromptKey,
  msg: LlmMessage,
  schema: ZodSchema<T>,
): Promise<StageResult<T>> {
  const started = Date.now();
  let response: LlmResponse;

  try {
    response = await dispatch(stage, msg);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    return {
      ok: false,
      error: { code: 'PROVIDER_ERROR', status, retryable: status === 429 || status >= 500 },
    };
  }

  const meta = {
    promptVersion: versionTag(stage),
    modelDeployment: response.model,
    latencyMs: Date.now() - started,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.content);
  } catch {
    return { ok: false, error: { code: 'SCHEMA_INVALID', detail: 'Response was not valid JSON' }, meta };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: { code: 'SCHEMA_INVALID', detail: result.error.message }, meta };
  }

  return { ok: true, value: result.data, meta };
}
