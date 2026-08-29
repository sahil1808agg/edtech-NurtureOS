import { describe, it, expect } from "vitest";
import { evaluateConsent, type ConsentRow } from "./policy";

const NOW = new Date("2026-08-29T12:00:00Z");
const FAMILY = "fam-1";
const CHILD = "child-1";
const SIBLING = "child-2";

function row(over: Partial<ConsentRow> = {}): ConsentRow {
  return {
    id: "consent-1",
    familyId: FAMILY,
    childId: CHILD,
    purposes: ["report_analysis", "plan_generation"],
    verifiedAt: "2026-08-01T00:00:00Z",
    revokedAt: null,
    ...over,
  };
}

const ctx = {
  childId: CHILD,
  childFamilyId: FAMILY,
  purpose: "report_analysis" as const,
  now: NOW,
};

describe("consent policy", () => {
  it("allows a live consent covering the purpose", () => {
    const d = evaluateConsent([row()], ctx);
    expect(d.allowed).toBe(true);
    expect(d.consentId).toBe("consent-1");
  });

  it("denies when no consent exists at all", () => {
    const d = evaluateConsent([], ctx);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("NO_CONSENT");
  });

  it("denies when consent was granted for a sibling, not this child", () => {
    const d = evaluateConsent([row({ childId: SIBLING })], ctx);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("WRONG_CHILD");
  });

  it("denies revoked consent", () => {
    const d = evaluateConsent([row({ revokedAt: "2026-08-20T00:00:00Z" })], ctx);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("REVOKED");
  });

  it("denies a consent row belonging to another family", () => {
    const d = evaluateConsent([row({ familyId: "fam-other" })], ctx);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("FAMILY_MISMATCH");
  });

  it("denies consent verified in the future", () => {
    const d = evaluateConsent([row({ verifiedAt: "2026-09-01T00:00:00Z" })], ctx);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("NOT_YET_VERIFIED");
  });

  it("denies when the purpose was not granted", () => {
    const d = evaluateConsent([row({ purposes: ["email_communication"] })], ctx);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("PURPOSE_NOT_GRANTED");
  });

  it("allows when one of several rows is valid", () => {
    const d = evaluateConsent(
      [
        row({ id: "old", revokedAt: "2026-07-01T00:00:00Z" }),
        row({ id: "current", verifiedAt: "2026-08-15T00:00:00Z" }),
      ],
      ctx,
    );
    expect(d.allowed).toBe(true);
    expect(d.consentId).toBe("current");
  });

  it("reports the most recent row's reason when all are invalid", () => {
    const d = evaluateConsent(
      [
        row({ id: "older", verifiedAt: "2026-07-01T00:00:00Z", purposes: [] }),
        row({ id: "newer", verifiedAt: "2026-08-15T00:00:00Z", revokedAt: "2026-08-20T00:00:00Z" }),
      ],
      ctx,
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("REVOKED");
  });

  it("does not let a sibling's live consent authorise this child", () => {
    // The dangerous case: the family has consented, just not for this child.
    const d = evaluateConsent(
      [row({ id: "sib", childId: SIBLING, purposes: ["report_analysis"] })],
      ctx,
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("WRONG_CHILD");
  });

  it("distinguishes purposes — plan generation is not report analysis", () => {
    const rows = [row({ purposes: ["plan_generation"] })];
    expect(evaluateConsent(rows, ctx).allowed).toBe(false);
    expect(
      evaluateConsent(rows, { ...ctx, purpose: "plan_generation" }).allowed,
    ).toBe(true);
  });
});
