import { z } from 'zod';
import { callModel } from '../llm/client.js';
import { buildAnalyseMessage, type AnalyseInput as PromptInput } from '../prompts/analyse.js';
import type { StageResult, CandidateClaim } from './types.js';

export interface AnalyseOutput {
  claims: CandidateClaim[];
  insufficientEvidence: boolean;
}

const AnalyseOutputSchema = z.object({
  claims: z.array(
    z.object({
      kind: z.enum(['strength', 'growth']),
      statement: z.string(),
      citedObservationIds: z.array(z.string()),
      reasoning: z.string(),
    })
  ),
  // No upper bound: the claim count follows the domain areas the observations
  // support, the same way the plan's activity count follows the findings.
  // A ceiling here would not trim — safeParse rejects the whole response, so an
  // over-long answer would cost every claim in it rather than the last one.
  insufficientEvidence: z.boolean(),
});

export type AnalyseInput = PromptInput;

export async function runAnalyse(input: AnalyseInput): Promise<StageResult<AnalyseOutput>> {
  const msg = buildAnalyseMessage(input);
  return callModel('analyse', msg, AnalyseOutputSchema);
}
