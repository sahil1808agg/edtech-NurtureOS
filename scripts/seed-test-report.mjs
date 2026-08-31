/**
 * Creates one family/child/report row, uploads a real PDF to the "reports"
 * bucket, and enqueues a report.extract job for it — for exercising the
 * worker end to end without an upload UI.
 *
 *   node scripts/seed-test-report.mjs "C:\path\to\report.pdf"
 *
 * Note: this does not create a consent row. report.extract itself does not
 * check consent (that belongs to whatever will eventually enqueue jobs from
 * a real upload) — this script only exercises the extract job in isolation.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { PgBoss } from "pg-boss";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: node scripts/seed-test-report.mjs <path-to-pdf>");
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

const { data: family, error: famErr } = await admin.from("families").insert({}).select("id").single();
if (famErr) throw new Error(`family: ${famErr.message}`);

const { data: child, error: childErr } = await admin
  .from("children")
  .insert({ family_id: family.id, first_name: "Reyansh", dob: "2020-04-15", grade: "EYP3" })
  .select("id")
  .single();
if (childErr) throw new Error(`child: ${childErr.message}`);

const { data: report, error: reportErr } = await admin
  .from("reports")
  .insert({
    family_id: family.id,
    child_id: child.id,
    term_label: "T3",
    term_index: 3,
    academic_year: "2025-26",
    source_type: "pdf",
    storage_path: "pending", // placeholder, updated once we know the report id
  })
  .select("id")
  .single();
if (reportErr) throw new Error(`report: ${reportErr.message}`);

const storagePath = `${report.id}.pdf`;
const pdfBytes = readFileSync(pdfPath);
const { error: uploadErr } = await admin.storage.from("reports").upload(storagePath, pdfBytes, {
  contentType: "application/pdf",
});
if (uploadErr) throw new Error(`upload: ${uploadErr.message}`);

const { error: pathErr } = await admin.from("reports").update({ storage_path: storagePath }).eq("id", report.id);
if (pathErr) throw new Error(`storage_path update: ${pathErr.message}`);

console.log(`PASS  created report ${report.id} (family ${family.id}, child ${child.id})`);
console.log(`PASS  uploaded ${pdfPath} -> reports/${storagePath}`);

const boss = new PgBoss(env.DATABASE_URL);
boss.on("error", (err) => console.error("pg-boss error:", err));
await boss.start();
await boss.createQueue("report.extract");
const jobId = await boss.send("report.extract", { reportId: report.id });
console.log(`PASS  enqueued report.extract job ${jobId} for report ${report.id}`);
await boss.stop({ graceful: false });

console.log(`\nWatch it process with: npm run worker`);
console.log(`Then check status with: node scripts/check-report-status.mjs ${report.id}`);
