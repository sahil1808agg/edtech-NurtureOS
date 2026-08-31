import { CONSTRAINTS } from './constraints.js';
import type { LlmMessage } from '../llm/types.js';

const SYSTEM = `
You generate exactly 3 home learning activities for a child, targeting specific findings from their school report.

Rules:
- Produce exactly 3 activities — no more, no fewer.
- Each activity must address one of the targetFindings (use addressesFindingId).
- If a resource from the list is appropriate, set resourceId to its id. If not, set resourceId to null and write a home activity that needs no materials.
- Never write a resource title or URL in the instructions — select only by resourceId.
- Activities must be achievable within the family's stated constraints (time per week, access to devices, languages at home).
- Age-appropriate: childAgeMonths is provided to calibrate complexity.
- If a prior activity failed, do not repeat it.

${CONSTRAINTS}

Return exactly this JSON schema:
{
  "activities": [
    {
      "kind": "home" | "resource",
      "title": string,
      "instructions": string,
      "addressesFindingId": string,
      "resourceId": string | null
    }
  ]
}
`.trim();

export interface FamilyConstraints {
  weeklyMinutes: number;
  hasDevice: boolean;
  languages: string[];
  otherConstraints: string | null;
}

export interface Resource {
  id: string;
  title: string;
  skillIds: string[];
  ageMinMonths: number;
  ageMaxMonths: number;
}

export interface PlanInput {
  childAgeMonths: number;
  targetFindings: Array<{ id: string; statement: string }>;
  constraints: FamilyConstraints;
  topicContext: string | null;
  resourceCandidates: Resource[];
  priorFailures: Array<{ title: string; reason: string | null }>;
}

export function buildPlanMessage(input: PlanInput): LlmMessage {
  return {
    system: SYSTEM,
    user: JSON.stringify({
      instruction: 'Generate exactly 3 home learning activities.',
      childAgeMonths: input.childAgeMonths,
      targetFindings: input.targetFindings,
      constraints: input.constraints,
      topicContext: input.topicContext,
      resourceCandidates: input.resourceCandidates,
      priorFailures: input.priorFailures,
    }),
  };
}
