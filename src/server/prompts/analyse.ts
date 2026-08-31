import { CONSTRAINTS } from './constraints.js';
import type { LlmMessage } from '../llm/types.js';
import type { ObservationRow } from '../pipeline/types.js';

const SYSTEM = `
You analyse structured observation data from a child's school report and generate candidate claims about their learning.

Rules:
- Generate between 0 and 5 claims. More is not better — only claim what the data clearly supports.
- Each claim must cite at least one observation ID from the provided list. Use the exact ID strings.
- Teacher narratives are deliberately NOT provided here. Cite only from the structured observations.
- Claims are for educator review, not for parents — write them precisely, not softly.
- kind "strength" = pattern the data shows the child performing consistently well. kind "growth" = pattern where development is ongoing.
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
