/**
 * Sufficiency gate — PRD hard gate "manufactured insight on thin input: 0".
 *
 * When a report is too thin to support a finding, the honesty path fires and
 * no model runs. The output is static text plus three fixed teacher questions.
 *
 * Thresholds are configuration, not constants, because the right value should
 * be tuned against the thin-report adversarial case rather than guessed.
 */

import type { ObservationRow } from "../pipeline/types";

export interface SufficiencyThresholds {
  minObservations: number;
  minSolidRatio: number;
  minNarrativeChars: number;
}

export const DEFAULT_SUFFICIENCY: SufficiencyThresholds = {
  minObservations: 25,
  minSolidRatio: 0.5,
  minNarrativeChars: 200,
};

export type SufficiencyFailure =
  | "TOO_FEW_OBSERVATIONS"
  | "TOO_MANY_AMBIGUOUS"
  | "NARRATIVE_TOO_SHORT";

export interface SufficiencyResult {
  pass: boolean;
  failures: SufficiencyFailure[];
  total: number;
  solid: number;
  solidRatio: number;
  narrativeChars: number;
}

export function sufficiencyGate(
  observations: readonly ObservationRow[],
  narrativeChars: number,
  thresholds: SufficiencyThresholds = DEFAULT_SUFFICIENCY,
): SufficiencyResult {
  const total = observations.length;
  const solid = observations.filter(
    (o) => !o.isAmbiguous && o.normalised !== null,
  ).length;
  const solidRatio = total === 0 ? 0 : solid / total;

  const failures: SufficiencyFailure[] = [];
  if (total < thresholds.minObservations) failures.push("TOO_FEW_OBSERVATIONS");
  if (solidRatio < thresholds.minSolidRatio) failures.push("TOO_MANY_AMBIGUOUS");
  if (narrativeChars < thresholds.minNarrativeChars)
    failures.push("NARRATIVE_TOO_SHORT");

  return {
    pass: failures.length === 0,
    failures,
    total,
    solid,
    solidRatio,
    narrativeChars,
  };
}

/**
 * The honesty path output. Static by design at MVP — the segment-C reports we
 * serve rarely trigger it, so a generated version would be built for a branch
 * that does not execute. See PRD Week 2, C8.
 */
export const HONESTY_PATH = {
  statement:
    "This report does not contain enough detail for us to draw a reliable conclusion about your child. Rather than guess, here are three questions worth asking at the next parent-teacher meeting.",
  questions: [
    "Which specific skills has my child made the most progress on this term, and what did you see that showed it?",
    "Is there anything my child finds harder when the work is described in words rather than numbers or pictures?",
    "What is one thing we could do at home over the next few weeks that would genuinely help?",
  ],
} as const;
