/**
 * Citation gate — PRD hard gate "fabricated citations: 0".
 *
 * A claim survives only if every observation it cites exists in the record for
 * this report. This is a set membership test, not a model call. See LLD §2.
 *
 * Pure by design: the caller supplies the valid id set, so this is testable
 * without a database and cannot silently widen its own scope.
 */

import type { CandidateClaim } from "../pipeline/types";

export type DropReason = "UNRESOLVED_CITATION" | "NO_CITATION";

export interface DroppedClaim {
  claim: CandidateClaim;
  reason: DropReason;
  unresolved: string[];
}

export interface CitationGateResult {
  kept: CandidateClaim[];
  dropped: DroppedClaim[];
}

export function citationGate(
  claims: readonly CandidateClaim[],
  validObservationIds: ReadonlySet<string>,
): CitationGateResult {
  const kept: CandidateClaim[] = [];
  const dropped: DroppedClaim[] = [];

  for (const claim of claims) {
    const cited = claim.citedObservationIds ?? [];

    // A claim with no citation is as ungrounded as one with a bad citation.
    if (cited.length === 0) {
      dropped.push({ claim, reason: "NO_CITATION", unresolved: [] });
      continue;
    }

    const unresolved = cited.filter((id) => !validObservationIds.has(id));
    if (unresolved.length > 0) {
      dropped.push({ claim, reason: "UNRESOLVED_CITATION", unresolved });
      continue;
    }

    kept.push(claim);
  }

  return { kept, dropped };
}
