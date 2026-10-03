/**
 * The correctness matching rule from LLD §8.
 *
 * Matching is on cited-observation overlap, not statement wording: "Judging
 * statement wording would measure phrasing rather than finding." Two annotators
 * describing the same pattern will word it differently but cite the same cells.
 */

export interface ClaimLike {
  kind: 'strength' | 'growth';
  citedObservationIds: string[];
}

/** LLD §8: overlap of the two cited sets, by Jaccard. */
export function citationOverlap(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;

  let shared = 0;
  for (const id of setA) if (setB.has(id)) shared++;

  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}

export const OVERLAP_THRESHOLD = 0.5;

/** A produced claim matches an expected one when the cited sets overlap ≥50% AND kind agrees. */
export function claimsMatch(produced: ClaimLike, expected: ClaimLike): boolean {
  if (produced.kind !== expected.kind) return false;
  return citationOverlap(produced.citedObservationIds, expected.citedObservationIds) >= OVERLAP_THRESHOLD;
}

export interface MatchResult {
  matched: number;
  precision: number;
  recall: number;
  f1: number;
  unmatchedProduced: number;
  unmatchedExpected: number;
}

/**
 * Greedy one-to-one pairing. An expected claim is consumed once matched, so two
 * produced claims citing the same cells cannot both take credit for it — that
 * would let a model inflate recall by restating one finding several ways.
 */
export function scoreClaims(
  produced: readonly ClaimLike[],
  expected: readonly ClaimLike[],
): MatchResult {
  const taken = new Set<number>();
  let matched = 0;

  for (const p of produced) {
    for (let i = 0; i < expected.length; i++) {
      if (taken.has(i)) continue;
      if (claimsMatch(p, expected[i])) {
        taken.add(i);
        matched++;
        break;
      }
    }
  }

  // No produced claims is precision 1 vacuously; scoring it 0 is the honest
  // reading, since a run that claims nothing has found nothing.
  const precision = produced.length === 0 ? 0 : matched / produced.length;
  const recall = expected.length === 0 ? 0 : matched / expected.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    matched,
    precision,
    recall,
    f1,
    unmatchedProduced: produced.length - matched,
    unmatchedExpected: expected.length - matched,
  };
}
