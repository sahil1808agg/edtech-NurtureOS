/**
 * Builds a human annotation worksheet for one golden case, as CSVs.
 *
 *   node scripts/make-annotation-template.mjs syn-01-pyp1-aarav sahil
 *
 * Writes four files into evals/golden/{case}/annotations/{annotator}/ :
 *
 *   report-grid.csv     REFERENCE, do not edit — every learning outcome with a
 *                       short code (L01..), its marks, and the observation ids
 *   findings.csv        you fill in
 *   plan.csv            you fill in
 *   corroborations.csv  you fill in (optional)
 *
 * You cite evidence by the short code, not by UUID: write "L03;L07" in the
 * cites column. The importer expands a code to that outcome's observation ids.
 * "L03:T3" narrows it to one term. Pasting UUIDs into a spreadsheet is how
 * citations get mistyped, and a mistyped id scores zero however good the
 * finding is.
 *
 * Then: node scripts/import-annotation-csv.mjs syn-01-pyp1-aarav sahil
 *
 * Write these BEFORE running the pipeline on this child. Reading the app's
 * answer first turns ground truth into agreement.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [caseId, annotator] = process.argv.slice(2);
if (!caseId || !annotator) {
  console.error("Usage: node scripts/make-annotation-template.mjs <case-id> <annotator>");
  process.exit(1);
}

const caseDir = join("evals", "golden", caseId);
if (!existsSync(join(caseDir, "labels.json"))) {
  console.error(`FAIL  ${join(caseDir, "labels.json")} not found.`);
  process.exit(1);
}

const outDir = join(caseDir, "annotations", annotator);
mkdirSync(outDir, { recursive: true });

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (headers, rows) =>
  "﻿" +
  [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\r\n") +
  "\r\n";

// ---- read the observations the generator wrote ----

const obsCsv = join("evals", "datasets", "observations.csv");
if (!existsSync(obsCsv)) {
  console.error(`FAIL  ${obsCsv} not found. Re-run the generator with --csv-only.`);
  process.exit(1);
}

const text = readFileSync(obsCsv, "utf8").replace(/^﻿/, "");
const [head, ...lines] = text.trim().split(/\r?\n/);
const cols = head.split(",");
const at = (f, n) => f[cols.indexOf(n)];

const grid = new Map();
for (const line of lines) {
  const f = line.split(",");
  if (at(f, "case_id") !== caseId) continue;
  const label = at(f, "raw_label");
  if (!grid.has(label)) grid.set(label, { band: at(f, "band"), marks: {}, ids: {} });
  const t = `T${at(f, "term_index")}`;
  grid.get(label).marks[t] = at(f, "raw_value");
  grid.get(label).ids[t] = at(f, "observation_id");
}

if (grid.size === 0) {
  console.error(`FAIL  no observations found for ${caseId} in ${obsCsv}.`);
  process.exit(1);
}

// ---- 1. reference grid ----

const gridRows = [...grid.entries()].map(([label, v], i) => ({
  ref: `L${String(i + 1).padStart(2, "0")}`,
  learning_outcome: label,
  area: v.band,
  T1: v.marks.T1 ?? "",
  T2: v.marks.T2 ?? "",
  T3: v.marks.T3 ?? "",
  obs_id_T1: v.ids.T1 ?? "",
  obs_id_T2: v.ids.T2 ?? "",
  obs_id_T3: v.ids.T3 ?? "",
}));

writeFileSync(
  join(outDir, "report-grid.csv"),
  csv(["ref", "learning_outcome", "area", "T1", "T2", "T3", "obs_id_T1", "obs_id_T2", "obs_id_T3"], gridRows),
);

// ---- 2. findings ----

writeFileSync(
  join(outDir, "findings.csv"),
  csv(
    ["finding_id", "kind", "statement", "cites", "note"],
    [
      {
        finding_id: "F1",
        kind: "strength",
        statement: "",
        cites: "",
        note: "kind is strength or growth. cites: L03;L07 or L03:T3. Delete this row and write your own.",
      },
      { finding_id: "F2", kind: "", statement: "", cites: "", note: "" },
      { finding_id: "F3", kind: "", statement: "", cites: "", note: "" },
      { finding_id: "F4", kind: "", statement: "", cites: "", note: "" },
      { finding_id: "F5", kind: "", statement: "", cites: "", note: "" },
    ],
  ),
);

// ---- 3. plan ----

writeFileSync(
  join(outDir, "plan.csv"),
  csv(
    ["activity_id", "title", "instructions", "addresses_finding", "note"],
    [
      {
        activity_id: "A1",
        title: "",
        instructions: "",
        addresses_finding: "F1",
        note: "addresses_finding must be a finding_id from findings.csv.",
      },
      { activity_id: "A2", title: "", instructions: "", addresses_finding: "", note: "" },
      { activity_id: "A3", title: "", instructions: "", addresses_finding: "", note: "" },
    ],
  ),
);

// ---- 4. corroborations ----

writeFileSync(
  join(outDir, "corroborations.csv"),
  csv(
    ["claim_statement", "expected_verdict", "note"],
    [
      {
        claim_statement: "",
        expected_verdict: "",
        note: "corroborated | not_mentioned | conflicting — does page 2 of the PDF support the claim? Optional.",
      },
    ],
  ),
);

console.log(`PASS  wrote annotation CSVs to ${outDir}/`);
console.log(`  report-grid.csv     ${gridRows.length} outcomes (reference — do not edit)`);
console.log(`  findings.csv        fill in`);
console.log(`  plan.csv            fill in`);
console.log(`  corroborations.csv  fill in (optional)`);
console.log(`\nRead ${join(caseDir, "report.pdf")} alongside report-grid.csv.`);
console.log(`When done: node scripts/import-annotation-csv.mjs ${caseId} ${annotator}`);
process.exitCode = 0;
