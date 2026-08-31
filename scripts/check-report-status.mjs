/**
 *   node scripts/check-report-status.mjs <report-id>
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const reportId = process.argv[2];
if (!reportId) {
  console.error("Usage: node scripts/check-report-status.mjs <report-id>");
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

const { data: report } = await admin.from("reports").select("*").eq("id", reportId).single();
console.log("report:", report);

const { data: extraction } = await admin.from("extractions").select("*").eq("report_id", reportId).maybeSingle();
console.log("\nextraction:", extraction ? {
  ...extraction,
  raw_json: `<${JSON.stringify(extraction.raw_json).length} chars — cells: ${extraction.raw_json.cells?.length}, narratives: ${extraction.raw_json.narratives?.length}>`,
} : null);

const { data: narratives } = await admin.from("narratives").select("id, subject, text").eq("report_id", reportId);
console.log(`\nnarratives (${narratives?.length ?? 0}):`);
for (const n of narratives ?? []) {
  console.log(`  [${n.subject}] ${n.text.slice(0, 100)}...`);
}
