/**
 * The consent gate the pipeline calls before enqueuing any job.
 *
 * Thin by design: it fetches, then hands off to the pure policy. All the
 * decision rules live in policy.ts where they are testable offline.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateConsent,
  ConsentError,
  type ConsentDecision,
  type ConsentPurpose,
  type ConsentRow,
} from "./policy";

export async function checkConsent(
  db: SupabaseClient,
  childId: string,
  purpose: ConsentPurpose,
  now: Date = new Date(),
): Promise<ConsentDecision> {
  const { data: child, error: childErr } = await db
    .from("children")
    .select("id, family_id")
    .eq("id", childId)
    .maybeSingle();

  if (childErr) throw new Error(`consent: reading child failed — ${childErr.message}`);
  if (!child) return { allowed: false, reason: "NO_CONSENT", consentId: null };

  // Fetch by family, not by child, so consent granted for a sibling is seen by
  // the policy and rejected explicitly rather than never appearing.
  const { data, error } = await db
    .from("consents")
    .select("id, family_id, child_id, purposes, verified_at, revoked_at")
    .eq("family_id", child.family_id);

  if (error) throw new Error(`consent: reading consents failed — ${error.message}`);

  const rows: ConsentRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    familyId: r.family_id as string,
    childId: r.child_id as string,
    purposes: (r.purposes ?? []) as string[],
    verifiedAt: r.verified_at as string,
    revokedAt: (r.revoked_at ?? null) as string | null,
  }));

  return evaluateConsent(rows, {
    childId,
    childFamilyId: child.family_id as string,
    purpose,
    now,
  });
}

/** Throws unless consent is live. Every pipeline entry point calls this. */
export async function assertConsent(
  db: SupabaseClient,
  childId: string,
  purpose: ConsentPurpose,
  now: Date = new Date(),
): Promise<string> {
  const decision = await checkConsent(db, childId, purpose, now);
  if (!decision.allowed) throw new ConsentError(decision.reason!, childId);
  return decision.consentId!;
}
