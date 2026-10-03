/**
 * Loads evals/golden/{case-id}/labels.json into golden_reports + golden_labels.
 *
 *   node scripts/load-golden-set.mjs --dry-run
 *   node scripts/load-golden-set.mjs --yes
 *   node scripts/load-golden-set.mjs --yes --freeze
 *
 * golden_labels is unique (golden_report_id, annotator), so two annotators
 * labelling the same case produce two rows, not one. That is the PRD rule
 * ("two annotators label expected findings independently before any model
 * run") enforced by the schema — this script must never collapse them, so it
 * upserts per (case, annotator) pair.
 *
 * --freeze stamps frozen_at. Frozen labels are the ones evals score against;
 * leaving it unset marks a label as still being drafted.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const confirmed = args.includes("--yes");
const freeze = args.includes("--freeze");

if (!dryRun && !confirmed) {
  console.error("Refusing to write without --yes. Use --dry-run to see what would load.");
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

const GOLDEN_DIR = join("evals", "golden");

if (!existsSync(GOLDEN_DIR)) {
  console.error(`FAIL  ${GOLDEN_DIR} does not exist — nothing to load.`);
  process.exit(1);
}

const cases = [];
for (const entry of readdirSync(GOLDEN_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const labelsPath = join(GOLDEN_DIR, entry.name, "labels.json");
  if (!existsSync(labelsPath)) {
    console.log(`SKIP  ${entry.name} — no labels.json`);
    continue;
  }
  const parsed = JSON.parse(readFileSync(labelsPath, "utf8"));
  cases.push({ dir: entry.name, ...parsed, caseId: parsed.caseId ?? entry.name });
}

if (cases.length === 0) {
  console.error("FAIL  no labelled cases found. Nothing to load.");
  process.exit(1);
}

console.log(`found ${cases.length} case(s):`);
for (const c of cases) {
  const findings = c.expectedFindings?.length ?? 0;
  const cells = c.expectedCells?.length ?? 0;
  const corr = c.expectedCorroborations?.length ?? 0;
  console.log(
    `  ${c.caseId}  origin=${c.origin} annotator=${c.annotator} findings=${findings} cells=${cells} corroborations=${corr}`,
  );
}

if (dryRun) {
  console.log("\n(dry run — nothing written)");
  process.exit(0);
}

const now = new Date().toISOString();
let reportsWritten = 0;
let labelsWritten = 0;

for (const c of cases) {
  if (!c.annotator) {
    console.error(`FAIL  ${c.caseId}: labels.json has no "annotator" — cannot satisfy the two-annotator rule.`);
    process.exit(1);
  }

  // storage_path is not null in the schema. Redacted PDFs live in git, so the
  // repo-relative path is the honest value; a real report in the bucket would
  // carry its object key instead.
  const storagePath = existsSync(join(GOLDEN_DIR, c.dir, "report.pdf"))
    ? `${GOLDEN_DIR}/${c.dir}/report.pdf`
    : `${GOLDEN_DIR}/${c.dir}`;

  const { data: existing } = await admin
    .from("golden_reports")
    .select("id")
    .eq("storage_path", storagePath)
    .maybeSingle();

  let goldenReportId = existing?.id;

  if (!goldenReportId) {
    const { data, error } = await admin
      .from("golden_reports")
      .insert({
        origin: c.origin ?? "adversarial",
        case_label: c.caseLabel ?? null,
        storage_path: storagePath,
        notes: c.notes ?? null,
      })
      .select("id")
      .single();
    if (error) {
      console.error(`FAIL  ${c.caseId} golden_reports: ${error.message}`);
      process.exit(1);
    }
    goldenReportId = data.id;
    reportsWritten++;
  }

  const expected = {
    expectedFindings: c.expectedFindings ?? [],
    expectedCells: c.expectedCells ?? [],
    expectedCorroborations: c.expectedCorroborations ?? [],
    reportId: c.reportId ?? null,
  };

  const { error: labelError } = await admin
    .from("golden_labels")
    .upsert(
      {
        golden_report_id: goldenReportId,
        annotator: c.annotator,
        expected_findings: expected,
        frozen_at: freeze ? now : null,
      },
      { onConflict: "golden_report_id,annotator" },
    );

  if (labelError) {
    console.error(`FAIL  ${c.caseId} golden_labels: ${labelError.message}`);
    process.exit(1);
  }
  labelsWritten++;
  console.log(`PASS  ${c.caseId} (annotator ${c.annotator})${freeze ? " frozen" : ""}`);
}

const { count: reportCount } = await admin
  .from("golden_reports")
  .select("*", { count: "exact", head: true });
const { count: labelCount } = await admin
  .from("golden_labels")
  .select("*", { count: "exact", head: true });

console.log(
  `\n${labelsWritten} label(s) written, ${reportsWritten} new golden report(s).`,
);
console.log(`totals — golden_reports: ${reportCount}, golden_labels: ${labelCount}`);

if (!freeze) {
  console.log("\nLabels are NOT frozen. Re-run with --freeze once two annotators have labelled independently.");
}

// exitCode rather than process.exit(): calling exit() right after a Supabase
// query aborts the process on Windows with a libuv assertion and exit 127,
// turning a successful load into an apparent failure.
process.exitCode = 0;
