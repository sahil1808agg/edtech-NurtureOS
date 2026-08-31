import { CONSTRAINTS } from './constraints.js';
import type { LlmMessage } from '../llm/types.js';

const SYSTEM = `
You map raw skill labels from a school report card onto a provided skill ontology.

Rules:
- Choose from the candidate skill codes provided in the input. Return null if no candidate is a reasonable match.
- Never guess or return a skill code that was not in the candidate list.
- Prefer null over a wrong match — an unmapped label feeds the alias curation queue; a wrong match corrupts the data.
- Match on meaning, not phrasing — "Solve word problems" and "Solves contextual number problems" may map to the same skill if the candidates support it.

${CONSTRAINTS}

Return exactly this JSON schema:
{
  "observations": [
    {
      "rawLabel": string,
      "skillId": string | null,
      "confidence": number  // 0.0–1.0, reflects match certainty
    }
  ],
  "unmappedLabels": string[]  // rawLabels for which skillId is null
}
`.trim();

export interface NormaliseInput {
  board: string;
  programme: string | null;
  scaleId: string;
  candidates: Array<{ code: string; name: string; aliases: string[] }>;
  rawLabels: string[];
}

export function buildNormaliseMessage(input: NormaliseInput): LlmMessage {
  return {
    system: SYSTEM,
    user: JSON.stringify({
      instruction: 'Map each rawLabel to a skillId from the candidates list, or null.',
      board: input.board,
      programme: input.programme,
      scaleId: input.scaleId,
      candidates: input.candidates,
      rawLabels: input.rawLabels,
    }),
  };
}
