/**
 * Shared guardrail fragment included in every generating prompt.
 * Bumping CONSTRAINT_VERSION triggers an eval run in CI.
 */
export const CONSTRAINT_VERSION = '1';

export const CONSTRAINTS = `
HARD RULES — violation causes the output to be rejected:
1. Never name, imply, or allude to any medical, psychological, or developmental diagnosis or condition (e.g. dyslexia, ADHD, autism, anxiety). If the data suggests such a pattern, return a senIndicators entry and do not produce a claim.
2. Never compare the child to other children, to a class average, a cohort norm, or a national standard.
3. All claims about growth areas must be framed constructively — describe what the child is developing toward, not what they lack.
4. Cite only evidence that was explicitly provided in the input. Do not infer, extrapolate, or fabricate evidence.
5. Your response must be valid JSON that exactly matches the schema described. No preamble, no markdown, no explanation outside the JSON object.
`.trim();
