/**
 * Verifies the Supabase project matches docs/specs/supabase-schema.sql.
 * Uses the service role key, which bypasses RLS — so a failure here is a real
 * missing table, not a policy blocking us.
 *
 *   node scripts/verify-schema.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "")]),
);

function roleOf(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString()).role;
  } catch {
    return jwt?.startsWith("sb_secret_") ? "service_role (new format)" : "unknown";
  }
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const role = roleOf(key);
console.log("service key role :", role);
if (!String(role).startsWith("service_role")) {
  console.error("\n!! SUPABASE_SERVICE_ROLE_KEY is not a service_role key. Stopping.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const TABLES = [
  "families", "profiles", "schools", "children", "consents", "family_constraints",
  "scales", "scale_values", "skills", "skill_aliases",
  "report_templates", "reports", "report_pages", "extractions",
  "observations", "narratives",
  "finding_sets", "findings", "finding_citations", "parent_finding_responses",
  "curriculum_topics", "resources",
  "plans", "plan_activities", "checkins",
  "review_queue", "golden_reports", "golden_labels", "eval_runs", "audit_log",
];

const missing = [];
const present = [];

for (const t of TABLES) {
  const { error } = await db.from(t).select("*", { count: "exact", head: true });
  if (error) missing.push([t, error.message]);
  else present.push(t);
}

console.log(`\ntables present   : ${present.length}/${TABLES.length}`);
if (missing.length) {
  console.log("\nMISSING OR UNREADABLE:");
  for (const [t, msg] of missing) console.log(`  ${t.padEnd(26)} ${msg}`);
}

// Seed data — the IB four-point scale must be mapped, or normalisation is blind.
const { data: scales } = await db.from("scales").select("id");
const { data: values } = await db
  .from("scale_values")
  .select("raw_value, normalised")
  .eq("scale_id", "IB_OPCE")
  .order("normalised", { ascending: false });

console.log("\nscales seeded    :", (scales ?? []).map((s) => s.id).join(", ") || "none");
console.log("IB_OPCE values   :",
  (values ?? []).map((v) => `${v.raw_value}=${v.normalised}`).join(" ") || "none");

const ok = missing.length === 0 && (values ?? []).length === 4;
console.log("\n" + (ok ? "SCHEMA OK" : "SCHEMA INCOMPLETE"));
process.exit(ok ? 0 : 1);
