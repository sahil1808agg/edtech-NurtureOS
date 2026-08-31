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
  activities: PlanActivity[];  // one per domain area the findings cover — no fixed count
}

const ActivitySchema = z.object({
  kind: z.enum(['home', 'resource']),
  title: z.string(),
  instructions: z.string(),
  addressesFindingId: z.string(),
  resourceId: z.string().nullable(),
});

// No upper bound for now. The plan is meant to reach every domain area the
// findings touch, so the count follows the findings rather than a fixed number.
// .min(1) only rejects an empty plan, which is never a useful answer.
const PlanOutputSchema = z.object({
  activities: z.array(ActivitySchema).min(1),
});

export type PlanInput = PromptInput;

export async function runPlan(input: PlanInput): Promise<StageResult<PlanOutput>> {
  const msg = buildPlanMessage(input);
  return callModel('plan', msg, PlanOutputSchema);
}
