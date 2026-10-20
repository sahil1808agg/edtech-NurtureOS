import { z } from 'zod';
import { callModel } from '../llm/client.js';
import { buildPlanMessage, type PlanInput as PromptInput } from '../prompts/plan.js';
import type { StageResult } from './types.js';

export interface PlanActivity {
  kind: 'home' | 'resource' | 'local';
  title: string;
  /** One or two sentences: what this activity is and why — the step-by-step "how" lives in `steps`, not here. */
  instructions: string;
  /** Ordered, actionable steps a parent follows in sequence. */
  steps: string[];
  /** What to gather before starting. Empty array, not omitted, when nothing beyond what's on hand is needed. */
  materials: string[];
  estimatedMinutes: number;
  addressesFindingId: string;
  resourceId: string | null;
  /** Only for kind 'local' — what to search for nearby; resolved to a real place before saving (see resolve-local-activities.ts). */
  localQuery: string | null;
}

export interface PlanOutput {
  activities: PlanActivity[];  // one per domain area the findings cover — no fixed count
}

const ActivitySchema = z.object({
  kind: z.enum(['home', 'resource', 'local']),
  title: z.string(),
  instructions: z.string(),
  steps: z.array(z.string().min(1)).min(2),
  materials: z.array(z.string().min(1)),
  estimatedMinutes: z.number().int().positive(),
  addressesFindingId: z.string(),
  resourceId: z.string().nullable(),
  localQuery: z.string().nullable(),
});

// No upper bound for now. The plan is meant to reach every domain area the
// findings touch, so the count follows the findings rather than a fixed number.
// .min(1) only rejects an empty plan, which is never a useful answer.
const PlanOutputSchema = z.object({
  activities: z.array(ActivitySchema).min(1),
});

export type PlanInput = PromptInput;

export async function runPlan(input: PlanInput, familyId?: string, requestId?: string): Promise<StageResult<PlanOutput>> {
  const msg = buildPlanMessage(input);
  return callModel('plan', msg, PlanOutputSchema, familyId, requestId);
}
