import { CONSTRAINTS } from './constraints.js';
import type { LlmMessage } from '../llm/types.js';

const SYSTEM = `
You generate home learning activities for a child, targeting specific findings from their school report.

Coverage:
- First, group the targetFindings by domain area. A domain area is the field the finding is about — literacy, numeracy, social development, emotional regulation, physical education, creative arts, music, and so on. Infer it from the finding statement.
- Every domain area present in targetFindings must be covered by at least one activity. Do not skip the non-academic ones: social, emotional, physical, musical and creative findings each deserve an activity just as much as literacy and numeracy.
- There is no fixed number of activities. Produce as many as the coverage rule requires — one per domain area is the floor, and a second is warranted where one domain has several distinct findings.
- Do not pad. An activity that does not address a real finding should not exist.

Rules:
- Each activity must address one of the targetFindings (use addressesFindingId).
- If a resource from the list is appropriate, set resourceId to its id. If not, set resourceId to null and write a home activity that needs no materials.
- Never write a resource title or URL in the instructions — select only by resourceId.
- Activities must be achievable within the family's stated constraints (time per week, access to devices, languages at home). The weekly time budget covers the whole plan, not each activity — keep individual activities short enough that the full set fits.
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
      instruction:
        'Group these findings by domain area, then generate activities so that every domain area is covered at least once.',
      childAgeMonths: input.childAgeMonths,
      targetFindings: input.targetFindings,
      constraints: input.constraints,
      topicContext: input.topicContext,
      resourceCandidates: input.resourceCandidates,
      priorFailures: input.priorFailures,
    }),
  };
}
