/**
 * Inserts a reviewed resources proposal into the resources table.
 * Idempotent: an existing URL is skipped, not duplicated.
 *
 *   node scripts/apply-resources-proposal.mjs [proposal-file] [--dry-run]
 *
 * Only entries with verified:true are inserted — anything that failed direct
 * verification stays out of the table a parent-facing plan will link to.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const file = process.argv[2]?.startsWith("--") ? "resources-proposal.json" : (process.argv[2] || "resources-proposal.json");
const dryRun = process.argv.includes("--dry-run");

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

const { resources } = JSON.parse(readFileSync(file, "utf8"));

let inserted = 0, existing = 0, unverified = 0;

for (const r of resources) {
  if (!r.verified) {
    console.log(`SKIP  unverified: ${r.title}`);
    unverified++;
    continue;
  }

  const { data: found } = await admin.from("resources").select("id").eq("url", r.url).maybeSingle();
  if (found) {
    console.log(`SKIP  already present: ${r.title}`);
    existing++;
    continue;
  }

  if (dryRun) {
    console.log(`[dry-run] would insert: ${r.title}`);
    continue;
  }

  const { error } = await admin.from("resources").insert({
    title: r.title,
    kind: r.kind,
    url: r.url,
    age_min: r.age_min,
    age_max: r.age_max,
    language: r.language,
    skill_codes: r.skill_codes,
    // Set because each URL was fetched and confirmed during this session; the
    // PRD requires links be re-validated before a parent ever sees one.
    last_validated_at: new Date().toISOString(),
    is_active: true,
  });
  if (error) throw new Error(`resource "${r.title}": ${error.message}`);

  console.log(`PASS  inserted: ${r.title}`);
  inserted++;
}

console.log(`\n${inserted} inserted, ${existing} already present, ${unverified} skipped as unverified`);
if (dryRun) console.log("(dry run — nothing was written)");
