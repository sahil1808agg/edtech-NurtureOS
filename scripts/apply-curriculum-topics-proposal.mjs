/**
 * Inserts a reviewed curriculum-topics proposal into curriculum_topics.
 * Requires migration 0005_curriculum_phases.sql (phase/strand/stage columns,
 * nullable month/grade).
 *
 *   node scripts/apply-curriculum-topics-proposal.mjs [proposal-file] [--dry-run]
 *
 * Each learning outcome becomes one row. month and grade stay NULL: this source
 * is phase-based and carries no calendar information — see the BLOCKER section
 * of curriculum-topics-proposal.json.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const file = process.argv[2]?.startsWith("--") ? "curriculum-topics-proposal.json" : (process.argv[2] || "curriculum-topics-proposal.json");
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

const proposal = JSON.parse(readFileSync(file, "utf8"));
const sourceLabel = `${proposal.source.title} (${proposal.source.publisher}, ${proposal.source.last_updated})`;

const STAGES = [
  "conceptual_understandings",
  "constructing_meaning",
  "transferring_meaning_into_symbols",
  "applying_with_understanding",
];

const rows = [];
for (const t of proposal.topics) {
  for (const stage of STAGES) {
    for (const topic of t[stage] ?? []) {
      rows.push({
        board: t.board,
        programme: t.programme,
        grade: null,
        month: null,
        phase: t.phase,
        strand: t.strand,
        stage,
        topic,
        unit_title: t.strand,
        source: sourceLabel,
      });
    }
  }
}

console.log(`Flattened ${proposal.topics.length} strand/phase entries into ${rows.length} outcome rows.`);

if (dryRun) {
  for (const r of rows.slice(0, 5)) console.log(`  [${r.strand} P${r.phase} ${r.stage}] ${r.topic.slice(0, 70)}...`);
  console.log(`  ... and ${rows.length - 5} more`);
  console.log("\n(dry run — nothing was written)");
  process.exit(0);
}

// The unique index covers the full shape, so re-running replaces nothing and
// duplicates nothing.
const { error } = await admin.from("curriculum_topics").upsert(rows, {
  onConflict: "board,programme,grade,month,phase,strand,stage,topic",
  ignoreDuplicates: true,
});

if (error) {
  // Expression-based unique indexes cannot be named in onConflict; fall back to
  // per-row existence checks.
  console.log(`Bulk upsert unavailable (${error.message}) — falling back to per-row inserts.`);
  let inserted = 0, existing = 0;
  for (const r of rows) {
    const { data: found } = await admin
      .from("curriculum_topics")
      .select("id")
      .eq("board", r.board)
      .eq("phase", r.phase)
      .eq("strand", r.strand)
      .eq("stage", r.stage)
      .eq("topic", r.topic)
      .maybeSingle();
    if (found) { existing++; continue; }
    const { error: insErr } = await admin.from("curriculum_topics").insert(r);
    if (insErr) throw new Error(`topic "${r.topic.slice(0, 40)}": ${insErr.message}`);
    inserted++;
  }
  console.log(`\n${inserted} inserted, ${existing} already present`);
} else {
  console.log(`\n${rows.length} rows upserted.`);
}
