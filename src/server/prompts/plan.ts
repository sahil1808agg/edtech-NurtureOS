import { CONSTRAINTS } from './constraints.js';
import type { LlmMessage } from '../llm/types.js';

const SYSTEM = `
You generate home learning activities for a child, targeting specific findings from their school report.

Coverage:
- First, group the targetFindings by domain area. A domain area is the field the finding is about — literacy, numeracy, social development, emotional regulation, physical education, creative arts, music, and so on. Infer it from the finding statement.
- Every domain area present in targetFindings must be covered by at least one activity. Do not skip the non-academic ones: social, emotional, physical, musical and creative findings each deserve an activity just as much as literacy and numeracy.
- There is no fixed number of activities. Produce as many as the coverage rule requires — one per domain area is the floor, and a second is warranted where one domain has several distinct findings.
- Do not pad. An activity that does not address a real finding should not exist.

Home vs. outside:
- Every plan should mix two kinds of activity: "home" (and "resource", which is also done at home) for things the family can do with no materials or a specific resource, and "local" for a real-world place or class worth visiting — a library storytime for literacy, a park or sports class for physical development, a museum or craft class for creative findings, and so on.
- Use kind "local" only when hasLocation is true. If hasLocation is false, there is nowhere to look up — use "home" or "resource" for every activity instead.
- For a "local" activity, set localQuery to a short, generic search phrase for what to look for nearby (e.g. "children's library storytime", "kids swimming class", "public park") — never a specific place name, address, or claim that one exists. The real place is resolved afterward from this query; if nothing nearby matches, the activity is swapped for a home activity automatically, so write the instructions so they still make sense generically (what to do there and why), without naming a venue.
- When hasLocation is true, aim for 2-3 "local" activities across the plan — spread across different domain areas where a real-world venue genuinely adds something a home activity can't (e.g. a library storytime for literacy, a park or sports class for physical development, a museum or craft class for creative findings). Only use fewer than 2 if the plan has too few domain areas to support it.

Rules:
- Each activity must address one of the targetFindings (use addressesFindingId).
- If a resource from the list is appropriate, set resourceId to its id. If not, set resourceId to null and write a home activity that needs no materials.
- Never write a resource title or URL in the instructions — select only by resourceId.
- resourceId and localQuery are mutually exclusive with each other and with being unset: set resourceId for kind "resource", localQuery for kind "local", and leave both null for kind "home".
- Activities must be achievable within the family's stated constraints (time per week, access to devices, languages at home). The weekly time budget covers the whole plan, not each activity — keep individual activities short enough that the full set fits.
- Age-appropriate: childAgeMonths is provided to calibrate complexity.
- If a prior activity failed, do not repeat it.

${CONSTRAINTS}

Return exactly this JSON schema:
{
  "activities": [
    {
      "kind": "home" | "resource" | "local",
      "title": string,
      "instructions": string,
      "addressesFindingId": string,
      "resourceId": string | null,
      "localQuery": string | null
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
  /** Whether the child has a location on file to search near — gates kind "local" (see SYSTEM). */
  hasLocation: boolean;
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
      hasLocation: input.hasLocation,
    }),
  };
}
