/**
 * Consent policy — pure decision logic, no database.
 *
 * India's DPDP Act treats everyone under 18 as a child requiring verifiable
 * parental consent, and restricts profiling of children. The PRD expresses
 * that as: no pipeline job runs without a live consent row. This module is
 * that rule as code.
 *
 * Separated from the fetch so every denial path is testable offline.
 */

export const CONSENT_PURPOSES = [
  "report_analysis",
  "plan_generation",
  "email_communication",
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export interface ConsentRow {
  id: string;
  familyId: string;
  childId: string;
  purposes: string[];
  /** ISO timestamp of when the guardian was verified */
  verifiedAt: string;
  revokedAt: string | null;
}

export type ConsentDenial =
  | "NO_CONSENT"
  | "WRONG_CHILD"
  | "REVOKED"
  | "FAMILY_MISMATCH"
  | "NOT_YET_VERIFIED"
  | "PURPOSE_NOT_GRANTED";

export interface ConsentDecision {
  allowed: boolean;
  reason: ConsentDenial | null;
  consentId: string | null;
}

export interface ConsentContext {
  childId: string;
  /** the family the child actually belongs to, read from the children table */
  childFamilyId: string;
  purpose: ConsentPurpose;
  now?: Date;
}

const allow = (consentId: string): ConsentDecision => ({
  allowed: true,
  reason: null,
  consentId,
});

const deny = (reason: ConsentDenial): ConsentDecision => ({
  allowed: false,
  reason,
  consentId: null,
});

/** Why a single row fails, or null when it is valid. */
function rejectionFor(
  row: ConsentRow,
  ctx: Required<Pick<ConsentContext, "childFamilyId" | "purpose">> & { now: Date },
): ConsentDenial | null {
  if (row.revokedAt !== null) return "REVOKED";
  // A consent row pointing at a different family than the child's own is a
  // data integrity failure, and must never be treated as permission.
  if (row.familyId !== ctx.childFamilyId) return "FAMILY_MISMATCH";
  if (new Date(row.verifiedAt).getTime() > ctx.now.getTime()) return "NOT_YET_VERIFIED";
  if (!row.purposes.includes(ctx.purpose)) return "PURPOSE_NOT_GRANTED";
  return null;
}

/**
 * @param rows every consent row visible for the family — not pre-filtered by
 *             child, so that consent granted for a sibling is caught here
 *             rather than being silently accepted upstream.
 */
export function evaluateConsent(
  rows: readonly ConsentRow[],
  ctx: ConsentContext,
): ConsentDecision {
  const now = ctx.now ?? new Date();
  const forChild = rows.filter((r) => r.childId === ctx.childId);

  if (forChild.length === 0) {
    // Distinguish "this family has consented to nothing" from "they consented
    // for another child". The second is the more dangerous confusion.
    return deny(rows.length > 0 ? "WRONG_CHILD" : "NO_CONSENT");
  }

  const checked = forChild.map((row) => ({
    row,
    rejection: rejectionFor(row, { childFamilyId: ctx.childFamilyId, purpose: ctx.purpose, now }),
  }));

  const valid = checked.find((c) => c.rejection === null);
  if (valid) return allow(valid.row.id);

  // Report the most recently verified row's reason — the one the parent most
  // likely believes is in force.
  const mostRecent = checked.sort(
    (a, b) =>
      new Date(b.row.verifiedAt).getTime() - new Date(a.row.verifiedAt).getTime(),
  )[0];

  return deny(mostRecent.rejection!);
}

export class ConsentError extends Error {
  constructor(
    readonly reason: ConsentDenial,
    readonly childId: string,
  ) {
    super(`Consent denied for child ${childId}: ${reason}`);
    this.name = "ConsentError";
  }
}
