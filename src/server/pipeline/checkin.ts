import { z } from 'zod';
import { callModel } from '../llm/client.js';
import { buildCheckinMessage, type CheckinInput as PromptInput } from '../prompts/checkin.js';
import type { StageResult } from './types.js';

export type CheckinDecision = 'hold' | 'adjust' | 'escalate' | 'advance';

export interface CheckinVerdict {
  decision: CheckinDecision;
  reasoning: string;
}

const CheckinVerdictSchema = z.object({
  decision: z.enum(['hold', 'adjust', 'escalate', 'advance']),
  reasoning: z.string(),
});

export type CheckinInput = PromptInput;

export async function runCheckin(input: CheckinInput): Promise<StageResult<CheckinVerdict>> {
  const msg = buildCheckinMessage(input);
  return callModel('checkin', msg, CheckinVerdictSchema);
}
