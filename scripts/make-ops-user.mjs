/**
 * Creates (or promotes) a reviewer account for the review console.
 *
 *   node scripts/make-ops-user.mjs reviewer@example.com somepassword
 *
 * Dev convenience only — creates a confirmed auth user, a family + profile via
 * create_family_account, then flips is_ops.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: node scripts/make-ops-user.mjs <email> <password>");
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

const { data: profile } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
if (!profile) {
  const { error } = await admin.rpc("create_family_account", { p_user_id: userId, p_full_name: "Reviewer" });
  if (error) throw new Error(`create_family_account: ${error.message}`);
  console.log("Created family + profile");
}

const { error: opsErr } = await admin.from("profiles").update({ is_ops: true }).eq("id", userId);
if (opsErr) throw new Error(`promote to ops: ${opsErr.message}`);

console.log(`PASS  ${email} is now an ops reviewer. Sign in at /signin`);
