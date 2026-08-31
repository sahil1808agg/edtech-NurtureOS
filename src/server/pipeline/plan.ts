import { z } from 'zod';
import { callModel } from '../llm/client.js';
import { buildPlanMessage, type PlanInput as PromptInput } from '../prompts/plan.js';
import type { StageResult } from './types.js';

export interface PlanActivity {
  kind: 'home' | 'resource';
  title: string;
  instructions: string;
  addressesFindingId: string;
  resourceId: string | null;
}

export interface PlanOutput {
  activities: PlanActivity[];  // exactly 3, enforced by Zod .length(3)
}

const ActivitySchema = z.object({
  kind: z.enum(['home', 'resource']),
  title: z.string(),
  instructions: z.string(),
  addressesFindingId: z.string(),
  resourceId: z.string().nullable(),
});

const PlanOutputSchema = z.object({
  activities: z.array(ActivitySchema).length(3),
});

export type PlanInput = PromptInput;

export async function runPlan(input: PlanInput): Promise<StageResult<PlanOutput>> {
  const msg = buildPlanMessage(input);
  return callModel('plan', msg, PlanOutputSchema);
}
