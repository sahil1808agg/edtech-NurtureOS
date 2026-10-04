/**
 * Static $/token pricing, used to compute llm_request_log.cost_usd at the
 * moment a call is logged. Hand-maintained deliberately (see
 * docs/specs/07-observability-dashboard.md) rather than a DB table — but
 * that means it goes stale. Re-check every rate below against the
 * provider's current published pricing page before trusting a cost total
 * for a real spend decision; this file does not auto-update.
 *
 * Keyed to match exactly the provider/model strings callModel()/
 * callChatModel() actually resolve — see DEFAULT_MODELS in
 * src/server/llm/client.ts and src/server/llm/chat-client.ts.
 */

export interface TokenPricing {
  /** $ per 1,000,000 input tokens */
  input: number;
  /** $ per 1,000,000 output tokens */
  output: number;
}

const PRICING: Record<string, Record<string, TokenPricing>> = {
  anthropic: {
    'claude-opus-5': { input: 5, output: 25 },
    'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  },
  gemini: {
    'gemini-3.5-flash': { input: 0.3, output: 2.5 },
    'gemini-3.5-flash-lite': { input: 0.1, output: 0.4 },
  },
  openai: {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
  },
  grok: {
    'grok-2-vision-1212': { input: 2, output: 10 },
    'grok-3': { input: 3, output: 15 },
    'grok-3-mini': { input: 0.3, output: 0.5 },
  },
  kimi: {
    'moonshot-v1-128k': { input: 2, output: 2 },
    'moonshot-v1-8k': { input: 0.2, output: 0.2 },
  },
};

/**
 * Returns null — never throws, never guesses — when either token count is
 * unknown (a failed call) or the provider/model pair isn't in the table
 * above (an env override pointing at an unpriced model). A null cost_usd
 * shows as "—" on the dashboard rather than a wrong number.
 */

// OpenAI resolves an alias like "gpt-4o" to a dated snapshot in its
// response (e.g. "gpt-4o-2024-08-06") — confirmed against a real call while
// smoke-testing this dashboard. Pricing is keyed on the alias, so strip a
// trailing -YYYY-MM-DD before giving up on a match.
function withoutDateSuffix(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

export function costUsd(
  provider: string,
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number | null {
  if (inputTokens == null || outputTokens == null) return null;
  const rate = PRICING[provider]?.[model] ?? PRICING[provider]?.[withoutDateSuffix(model)];
  if (!rate) return null;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}
