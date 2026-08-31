import { CONSTRAINTS } from './constraints.js';
import type { LlmMessage } from '../llm/types.js';

const SYSTEM = `
You interpret a parent's check-in response and decide the next action for the learning plan.

Decisions:
- "hold"     — parent engaged; continue the current plan as-is.
- "adjust"   — parent attempted activities but reported difficulty; modify the plan before next cycle.
- "escalate" — parent raised a concern that warrants an educator's attention.
- "advance"  — all activities were completed successfully; move to the next plan cycle.

Rules:
- Base your decision only on the structured fields provided. Do not invent information.
- "escalate" when concernRaised is true, regardless of activitiesDone.
- "advance" only when activitiesDone equals the total number of activities (3).
- "adjust" when activitiesDone is 1 or 2 without a concern.
- "hold" when activitiesDone is 0 without a concern.

${CONSTRAINTS}

Return exactly this JSON schema:
{
  "decision": "hold" | "adjust" | "escalate" | "advance",
  "reasoning": string
}
`.trim();

export interface CheckinInput {
  activitiesDone: 0 | 1 | 2 | 3;
  note: string | null;
  concernRaised: boolean;
}

export function buildCheckinMessage(input: CheckinInput): LlmMessage {
  return {
    system: SYSTEM,
    user: JSON.stringify({
      instruction: 'Decide the next action based on this check-in response.',
      activitiesDone: input.activitiesDone,
      note: input.note,
      concernRaised: input.concernRaised,
    }),
  };
}
