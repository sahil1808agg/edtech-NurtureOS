/**
 * Consent gate against the real database.
 *
 * Proves the rule the PRD states as "no pipeline job runs without a live
 * consent row" actually holds end to end, including the sibling case that a
 * casual implementation lets through.
 *
 *   npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertConsent, checkConsent } from "./assert";
import { ConsentError } from "./policy";

let db: SupabaseClient;
let userId: string;
let familyId: string;
let childId: string;
let siblingId: string;

beforeAll(async () => {
  db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const email = `consent-${randomUUID().slice(0, 8)}@nurtureos.test`;
  const { data: u, error: uErr } = await db.auth.admin.createUser({
    email, password: randomUUID(), email_confirm: true,
  });
  if (uErr) throw uErr;
  userId = u.user.id;

  const { data: fam, error: fErr } = await db.rpc("create_family_account", {
    p_user_id: userId, p_full_name: "Consent Test",
  });
  if (fErr) throw fErr;
  familyId = fam as string;

  const mk = async (name: string) => {
    const { data, error } = await db.from("children")
      .insert({ family_id: familyId, first_name: name, dob: "2020-05-01", grade: "EYP3" })
      .select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  childId = await mk("Subject");
  siblingId = await mk("Sibling");
}, 60_000);

afterAll(async () => {
  if (!db) return;
  await db.from("consents").delete().eq("family_id", familyId);
  await db.from("children").delete().eq("family_id", familyId);
  await db.from("family_constraints").delete().eq("family_id", familyId);
  await db.from("profiles").delete().eq("id", userId);
  await db.from("families").delete().eq("id", familyId);
  await db.auth.admin.deleteUser(userId);
});

describe("consent gate (live)", () => {
  it("account creation is atomic — family, profile and constraints all exist", async () => {
    const [{ data: p }, { data: c }] = await Promise.all([
      db.from("profiles").select("family_id").eq("id", userId).single(),
      db.from("family_constraints").select("family_id").eq("family_id", familyId).single(),
    ]);
    expect(p?.family_id).toBe(familyId);
    expect(c?.family_id).toBe(familyId);
  });

  it("refuses processing when no consent exists", async () => {
    const d = await checkConsent(db, childId, "report_analysis");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("NO_CONSENT");
    await expect(assertConsent(db, childId, "report_analysis")).rejects.toThrow(ConsentError);
  });

  it("refuses an unknown child rather than throwing", async () => {
    const d = await checkConsent(db, randomUUID(), "report_analysis");
    expect(d.allowed).toBe(false);
  });

  it("allows once consent is granted for that child and purpose", async () => {
    const { error } = await db.rpc("grant_child_consent", {
      p_child_id: childId, p_granted_by: userId,
      p_method: "test", p_purposes: ["report_analysis"],
    });
    expect(error).toBeNull();

    const d = await checkConsent(db, childId, "report_analysis");
    expect(d.allowed).toBe(true);
    await expect(assertConsent(db, childId, "report_analysis")).resolves.toBeTruthy();
  });

  it("does not extend that consent to another purpose", async () => {
    const d = await checkConsent(db, childId, "plan_generation");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("PURPOSE_NOT_GRANTED");
  });

  it("does not extend that consent to a sibling", async () => {
    const d = await checkConsent(db, siblingId, "report_analysis");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("WRONG_CHILD");
  });

  it("refuses once consent is revoked", async () => {
    const { data: rows } = await db.from("consents").select("id").eq("child_id", childId);
    for (const r of rows ?? []) {
      await db.rpc("revoke_child_consent", { p_consent_id: r.id });
    }
    const d = await checkConsent(db, childId, "report_analysis");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("REVOKED");
  });

  it("rejects a consent granted by someone outside the family", async () => {
    const other = `outsider-${randomUUID().slice(0, 8)}@nurtureos.test`;
    const { data: o, error: oErr } = await db.auth.admin.createUser({
      email: other, password: randomUUID(), email_confirm: true,
    });
    if (oErr || !o?.user) throw oErr ?? new Error("outsider user was not created");
    const outsiderId = o.user.id;

    const { data: otherFam } = await db.rpc("create_family_account", {
      p_user_id: outsiderId, p_full_name: "Outsider",
    });

    const { error } = await db.rpc("grant_child_consent", {
      p_child_id: childId, p_granted_by: outsiderId,
      p_method: "test", p_purposes: ["report_analysis"],
    });
    expect(error).not.toBeNull();

    await db.from("family_constraints").delete().eq("family_id", otherFam as string);
    await db.from("profiles").delete().eq("id", outsiderId);
    await db.from("families").delete().eq("id", otherFam as string);
    await db.auth.admin.deleteUser(outsiderId);
  });
});
