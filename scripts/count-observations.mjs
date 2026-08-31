/**
 *   node scripts/count-observations.mjs <report-id>
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const reportId = process.argv[2];
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

const { count } = await admin
  .from("observations")
  .select("*", { count: "exact", head: true })
  .eq("report_id", reportId);

const { data: mapped } = await admin
  .from("observations")
  .select("skill_id")
  .eq("report_id", reportId)
  .not("skill_id", "is", null);

console.log(`observations: ${count} | mapped to a skill: ${mapped?.length ?? 0}`);
