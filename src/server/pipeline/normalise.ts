import { z } from 'zod';
import { callModel } from '../llm/client.js';
import { buildNormaliseMessage, type NormaliseInput as PromptInput } from '../prompts/normalise.js';
import type { StageResult } from './types.js';

export interface NormaliseOutput {
  observations: Array<{
    rawLabel: string;
    skillId: string | null;
    confidence: number;
  }>;
  unmappedLabels: string[];
}

const NormaliseOutputSchema = z.object({
  observations: z.array(
    z.object({
      rawLabel: z.string(),
      skillId: z.string().nullable(),
      confidence: z.number().min(0).max(1),
    })
  ),
  unmappedLabels: z.array(z.string()),
});

export type NormaliseInput = PromptInput;

export async function runNormalise(input: NormaliseInput): Promise<StageResult<NormaliseOutput>> {
  const msg = buildNormaliseMessage(input);
  return callModel('normalise', msg, NormaliseOutputSchema);
}
