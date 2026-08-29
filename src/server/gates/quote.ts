/**
 * Quote verification for Corroborate.
 *
 * The model returns a verdict and a supporting quote. We do not trust that the
 * quote is real. If it is not a verbatim substring of the referenced narrative,
 * the verdict is downgraded to "not_mentioned" and the call is logged as a
 * quote violation. Checked in code, not asked of the model. See LLD §1.
 */

import type {
  CorroborationResult,
  CorroborationVerdict,
  NarrativeRow,
} from "../pipeline/types";

export interface QuoteCheckResult {
  verdict: CorroborationVerdict;
  quote: string | null;
  narrativeId: string | null;
  violation: "QUOTE_NOT_FOUND" | "NARRATIVE_NOT_FOUND" | null;
}

/** Collapse whitespace so formatting differences do not fail a real quote. */
function canonical(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function verifyQuote(
  result: CorroborationResult,
  narratives: readonly NarrativeRow[],
): QuoteCheckResult {
  // "not_mentioned" carries no claim about the text, so there is nothing to verify.
  if (result.verdict === "not_mentioned") {
    return {
      verdict: "not_mentioned",
      quote: null,
      narrativeId: null,
      violation: null,
    };
  }

  const downgrade = (
    violation: QuoteCheckResult["violation"],
  ): QuoteCheckResult => ({
    verdict: "not_mentioned",
    quote: null,
    narrativeId: null,
    violation,
  });

  if (!result.quote || !result.narrativeId) return downgrade("QUOTE_NOT_FOUND");

  const narrative = narratives.find((n) => n.id === result.narrativeId);
  if (!narrative) return downgrade("NARRATIVE_NOT_FOUND");

  if (!canonical(narrative.text).includes(canonical(result.quote))) {
    return downgrade("QUOTE_NOT_FOUND");
  }

  return {
    verdict: result.verdict,
    quote: result.quote,
    narrativeId: result.narrativeId,
    violation: null,
  };
}
