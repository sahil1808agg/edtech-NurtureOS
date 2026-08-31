/**
 * Inserts a reviewed skill-ontology proposal into skills + skill_aliases.
 * Idempotent: an existing skill code or alias is skipped, not duplicated.
 *
 *   node scripts/apply-skill-ontology-proposal.mjs [proposal-file] [--include-attendance] [--dry-run]
 *
 * ATTENDANCE is excluded by default: "Present" / "Overall presence" are
 * attendance records, not teachable skills, and mapping an observation to one
 * would put a non-pedagogical row into the ontology the whole record joins on.
 * Pass --include-attendance to override.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const file = process.argv[2]?.startsWith("--") ? "skill-ontology-proposal.json" : (process.argv[2] || "skill-ontology-proposal.json");
const includeAttendance = process.argv.includes("--include-attendance");
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

const BOARD = "IB";
const PROGRAMME = null;

const { proposals } = JSON.parse(readFileSync(file, "utf8"));

const skipped = proposals.filter((p) => !includeAttendance && p.domain === "ATTENDANCE");
const toApply = proposals.filter((p) => includeAttendance || p.domain !== "ATTENDANCE");

if (skipped.length) {
  console.log(`Excluding ${skipped.length} ATTENDANCE proposal(s) — not teachable skills. Use --include-attendance to override.`);
  for (const s of skipped) console.log(`  skipped: ${s.code} (${s.rawLabels.length} label(s))`);
  console.log();
}

let skillsInserted = 0, skillsExisting = 0, aliasesInserted = 0, aliasesExisting = 0;

for (const p of toApply) {
  // 'LANG.LISTENING.COMPREHENSION' -> sub_domain 'LISTENING'
  const subDomain = p.code.split(".")[1] ?? null;

  let skillId;
  const { data: existing } = await admin.from("skills").select("id").eq("code", p.code).maybeSingle();

  if (existing) {
    skillId = existing.id;
    skillsExisting++;
  } else if (dryRun) {
    console.log(`[dry-run] would insert skill ${p.code}`);
    continue;
  } else {
    const { data, error } = await admin
      .from("skills")
      .insert({ code: p.code, name: p.name, domain: p.domain, sub_domain: subDomain })
      .select("id")
      .single();
    if (error) throw new Error(`skill ${p.code}: ${error.message}`);
    skillId = data.id;
    skillsInserted++;
  }

  for (const rawLabel of p.rawLabels) {
    const { data: existingAlias } = await admin
      .from("skill_aliases")
      .select("id")
      .eq("board", BOARD)
      .eq("raw_label", rawLabel)
      .maybeSingle();

    if (existingAlias) { aliasesExisting++; continue; }
    if (dryRun) { console.log(`[dry-run] would insert alias "${rawLabel.slice(0, 60)}..."`); continue; }

    const { error } = await admin.from("skill_aliases").insert({
      skill_id: skillId,
      board: BOARD,
      programme: PROGRAMME,
      raw_label: rawLabel,
      confidence: 1.0,
    });
    if (error) throw new Error(`alias for ${p.code}: ${error.message}`);
    aliasesInserted++;
  }
}

console.log(`\nskills:  ${skillsInserted} inserted, ${skillsExisting} already existed`);
console.log(`aliases: ${aliasesInserted} inserted, ${aliasesExisting} already existed`);
if (dryRun) console.log("\n(dry run — nothing was written)");
