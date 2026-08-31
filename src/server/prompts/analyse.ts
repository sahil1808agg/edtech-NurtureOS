import { CONSTRAINTS } from './constraints.js';
import type { LlmMessage } from '../llm/types.js';
import type { ObservationRow } from '../pipeline/types.js';

const SYSTEM = `
You analyse structured observation data from a child's school report and generate candidate claims about the child's development across all areas — academic, social, emotional, creative, and physical.

Rules:
- Generate 2–3 claims per domain area that has sufficient evidence. Aim for breadth across areas rather than depth in one. There is no cap on the total — it follows from how many domain areas the data supports.
- Only claim what the data clearly supports. More is not better: a domain with thin evidence should produce one claim, or none.
- Each claim must cite at least one observation ID from the provided list. Use the exact ID strings.
- Teacher narratives are deliberately NOT provided here. Cite only from the structured observations.
- Claims are for educator review, not for parents — write them precisely, not softly.
- Before generating claims, mentally scan all distinct rawLabel groups (subjects and development areas) present in the observations. Do not skip a domain just because it is non-academic — social development, emotional regulation, physical education, creative arts, music, and extra-curricular areas are all valid sources of findings if the data supports them.
- kind "strength" = a consistent pattern of strong performance or positive development in any area. kind "growth" = a pattern where development is ongoing across any area.
- reasoning is your internal working — explain which observations drove the claim and why. It is never shown to parents.

${CONSTRAINTS}

Return exactly this JSON schema:
{
  "claims": [
    {
      "kind": "strength" | "growth",
      "statement": string,
      "citedObservationIds": string[],
      "reasoning": string
    }
  ],
  "insufficientEvidence": boolean  // true when the data is too thin to produce any reliable claim
}
`.trim();

export interface AnalyseInput {
  childId: string;
  reportId: string;
  observations: ObservationRow[];
}

export function buildAnalyseMessage(input: AnalyseInput): LlmMessage {
  return {
    system: SYSTEM,
    user: JSON.stringify({
      instruction: 'Analyse the observations and return candidate claims.',
      childId: input.childId,
      reportId: input.reportId,
      observations: input.observations.map(o => ({
        id: o.id,
        skillId: o.skillId,
        rawLabel: o.rawLabel,
        scaleId: o.scaleId,
        termIndex: o.termIndex,
        normalised: o.normalised,
        isAmbiguous: o.isAmbiguous,
        confidence: o.confidence,
      })),
    }),
  };
}
