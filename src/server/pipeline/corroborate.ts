import { z } from 'zod';
import { callModel } from '../llm/client.js';
import { buildCorroborateMessage, type CorroborateInput as PromptInput } from '../prompts/corroborate.js';
import type { StageResult, CorroborationResult, CorroborationVerdict } from './types.js';

const CorroborateOutputSchema = z.object({
  verdict: z.enum(['corroborated', 'not_mentioned', 'conflicting']),
  quote: z.string().nullable(),
  narrativeId: z.string().nullable(),
});

export type CorroborateInput = PromptInput;

export async function runCorroborate(input: CorroborateInput): Promise<StageResult<CorroborationResult>> {
  const msg = buildCorroborateMessage(input);
  const result = await callModel('corroborate', msg, CorroborateOutputSchema);

  if (!result.ok) return result;

  const { verdict, quote, narrativeId } = result.value;

  // Verify the returned quote is a verbatim substring of the referenced narrative.
  // A fabricated quote downgrades to not_mentioned per the LLD contract.
  if (verdict === 'corroborated' && quote && narrativeId) {
    const narrative = input.narratives.find(n => n.id === narrativeId);
    if (!narrative || !narrative.text.includes(quote)) {
      return {
        ok: true,
        value: { verdict: 'not_mentioned' as CorroborationVerdict, quote: null, narrativeId: null },
        meta: result.meta,
      };
    }
  }

  return result as StageResult<CorroborationResult>;
}
