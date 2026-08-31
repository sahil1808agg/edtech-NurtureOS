import { CONSTRAINTS } from './constraints.js';
import type { LlmMessage } from '../llm/types.js';
import type { NarrativeRow } from '../pipeline/types.js';

const SYSTEM = `
You cross-check a single candidate claim against teacher narrative text to determine whether the narrative supports, contradicts, or does not mention the claim.

Rules:
- verdict "corroborated": the narrative explicitly supports the claim.
- verdict "not_mentioned": the narrative does not address the claim (absence of evidence is not contradiction).
- verdict "conflicting": the narrative directly contradicts the claim.
- If verdict is "corroborated", quote must be a verbatim substring of the referenced narrative — exact characters, no paraphrasing.
- If you cannot find a verbatim substring that fits, return "not_mentioned" rather than fabricating a quote.
- You see only the claim and narratives. You do not see the observations that generated the claim.

${CONSTRAINTS}

Return exactly this JSON schema:
{
  "verdict": "corroborated" | "not_mentioned" | "conflicting",
  "quote": string | null,
  "narrativeId": string | null
}
`.trim();

export interface CorroborateInput {
  claimStatement: string;
  narratives: Array<Pick<NarrativeRow, 'id' | 'subject' | 'text'>>;
}

export function buildCorroborateMessage(input: CorroborateInput): LlmMessage {
  return {
    system: SYSTEM,
    user: JSON.stringify({
      instruction: 'Determine whether the narratives corroborate, contradict, or do not mention the claim.',
      claim: input.claimStatement,
      narratives: input.narratives,
    }),
  };
}
