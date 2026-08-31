/**
 * Creates a parent account attached to an EXISTING family, and optionally
 * grants consent for a child. Dev convenience for exercising the parent UI
 * against data the pipeline has already produced.
 *
 *   node scripts/make-parent-user.mjs <email> <password> <familyId> [childId]
 *
 * Omit childId to create a parent with NO consent — useful for checking that
 * the upload route actually refuses.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [email, password, familyId, childId] = process.argv.slice(2);
if (!email || !password || !familyId) {
  console.error("Usage: node scripts/make-parent-user.mjs <email> <password> <familyId> [childId]");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "")]),
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let userId;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email, password, email_confirm: true,
});

if (createErr) {
  const { data: list } = await admin.auth.admin.listUsers();
  const found = list?.users.find((u) => u.email === email);
  if (!found) throw new Error(`createUser: ${createErr.message}`);
  userId = found.id;
  console.log(`User already existed: ${userId}`);
} else {
  userId = created.user.id;
  console.log(`Created auth user: ${userId}`);
}

const { data: existingProfile } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
if (!existingProfile) {
  const { error } = await admin
    .from("profiles")
    .insert({ id: userId, family_id: familyId, full_name: "Parent" });
  if (error) throw new Error(`profile: ${error.message}`);
  console.log(`Attached profile to family ${familyId}`);
}

if (childId) {
  const { data: live } = await admin
    .from("consents")
    .select("id")
    .eq("child_id", childId)
    .is("revoked_at", null)
    .maybeSingle();

  if (live) {
    console.log(`Consent already live for child ${childId}`);
  } else {
    const { data: consentId, error } = await admin.rpc("grant_child_consent", {
      p_child_id: childId,
      p_granted_by: userId,
      p_method: "dev_script",
      p_purposes: ["report_analysis", "plan_generation"],
    });
    if (error) throw new Error(`grant_child_consent: ${error.message}`);
    console.log(`Granted consent ${consentId} for child ${childId}`);
  }
} else {
  console.log("No childId given — this parent has no consent on file (upload should be refused).");
}

console.log(`PASS  ${email} ready. Sign in at /signin`);
