/**
 * Clears pipeline output so a flow can be walked from scratch.
 *
 *   node scripts/reset-pipeline-data.mjs --dry-run
 *   node scripts/reset-pipeline-data.mjs --yes
 *   node scripts/reset-pipeline-data.mjs --yes --family <uuid>
 *
 * Removes reports and plans, everything the database cascades from them
 * (extractions, observations, narratives, finding sets, findings, citations,
 * parent responses, plan activities, check-ins), the uploaded files, and the
 * review_queue rows that would otherwise be left pointing at nothing —
 * review_queue.artifact_id has no foreign key, so nothing cleans it up.
 *
 * Accounts, children and consents are kept: this resets what the pipeline
 * produced, not who the family is.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const confirmed = args.includes("--yes");
const familyId = args[args.indexOf("--family") + 1];
const scopedToFamily = args.includes("--family") && familyId && !familyId.startsWith("--");

if (!dryRun && !confirmed) {
  console.error("Refusing to delete without --yes. Use --dry-run to see what would go.");
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

const scope = (q) => (scopedToFamily ? q.eq("family_id", familyId) : q.neq("id", "00000000-0000-0000-0000-000000000000"));

const { data: reports } = await scope(admin.from("reports").select("id, storage_path"));
const { data: plans } = await scope(admin.from("plans").select("id"));
const { data: sets } = await scope(admin.from("finding_sets").select("id"));

console.log(`reports: ${reports?.length ?? 0}`);
console.log(`plans:   ${plans?.length ?? 0}`);
console.log(`files:   ${(reports ?? []).filter((r) => r.storage_path && r.storage_path !== "pending").length}`);
console.log(`review_queue rows to clear: ${(sets?.length ?? 0) + (plans?.length ?? 0)}`);

if (dryRun) {
  console.log("\n(dry run — nothing deleted)");
  process.exit(0);
}

// review_queue first: it has no FK, so deleting the artifacts would strand it.
const artifactIds = [...(sets ?? []).map((s) => s.id), ...(plans ?? []).map((p) => p.id)];
if (artifactIds.length) {
  const { error } = await admin.from("review_queue").delete().in("artifact_id", artifactIds);
  if (error) throw new Error(`review_queue: ${error.message}`);
}

const paths = (reports ?? [])
  .map((r) => r.storage_path)
  .filter((p) => p && p !== "pending");
if (paths.length) {
  const { error } = await admin.storage.from("reports").remove(paths);
  if (error) console.warn(`storage: ${error.message}`);
}

// Plans before reports: plan_activities.addresses_finding_id references
// findings without a cascade, so the findings cannot go while a plan holds them.
for (const p of plans ?? []) {
  const { error } = await admin.from("plans").delete().eq("id", p.id);
  if (error) throw new Error(`plan ${p.id}: ${error.message}`);
}

for (const r of reports ?? []) {
  const { error } = await admin.from("reports").delete().eq("id", r.id);
  if (error) throw new Error(`report ${r.id}: ${error.message}`);
}

const { count: reportsLeft } = await admin.from("reports").select("*", { count: "exact", head: true });
const { count: plansLeft } = await admin.from("plans").select("*", { count: "exact", head: true });
const { count: findingsLeft } = await admin.from("findings").select("*", { count: "exact", head: true });
const { count: obsLeft } = await admin.from("observations").select("*", { count: "exact", head: true });
const { data: filesLeft } = await admin.storage.from("reports").list();

console.log(`\nremaining — reports: ${reportsLeft}, plans: ${plansLeft}, findings: ${findingsLeft}, observations: ${obsLeft}, files: ${filesLeft?.length ?? 0}`);
console.log("accounts, children and consents were left alone.");
