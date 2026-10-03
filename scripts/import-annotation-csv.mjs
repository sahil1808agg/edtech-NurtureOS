/**
 * Turns a filled-in annotation worksheet into labels.{annotator}.json.
 *
 *   node scripts/import-annotation-csv.mjs syn-01-pyp1-aarav sahil
 *   node scripts/import-annotation-csv.mjs syn-01-pyp1-aarav sahil --freeze
 *
 * Reads evals/golden/{case}/annotations/{annotator}/{findings,plan,corroborations}.csv,
 * expands the L-codes in the cites column to real observation ids using
 * report-grid.csv, and writes labels.{annotator}.json beside labels.json.
 *
 * Validates rather than trusts. A finding citing a code that is not in the grid,
 * or a plan activity pointing at a finding_id that does not exist, is a hard
 * error — a bad citation scores zero at eval time and looks like a model
 * failure, so it has to be caught here instead.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [caseId, annotator, ...rest] = process.argv.slice(2);
const freeze = rest.includes("--freeze");

if (!caseId || !annotator) {
  console.error("Usage: node scripts/import-annotation-csv.mjs <case-id> <annotator> [--freeze]");
  process.exit(1);
}

const caseDir = join("evals", "golden", caseId);
const annDir = join(caseDir, "annotations", annotator);

if (!existsSync(annDir)) {
  console.error(`FAIL  ${annDir} not found. Run make-annotation-template.mjs first.`);
  process.exit(1);
}

/** RFC 4180 parser — statements will contain commas and quotes. */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r") { /* skip */ }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  if (rows.length === 0) return [];
  const head = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const read = (name) => {
  const p = join(annDir, name);
  return existsSync(p) ? parseCsv(readFileSync(p, "utf8")) : [];
};

// ---- reference grid ----

const gridRows = read("report-grid.csv");
if (gridRows.length === 0) {
  console.error(`FAIL  report-grid.csv missing or empty in ${annDir}.`);
  process.exit(1);
}

const byRef = new Map();
for (const r of gridRows) {
  byRef.set(r.ref.toUpperCase(), {
    label: r.learning_outcome,
    ids: { T1: r.obs_id_T1, T2: r.obs_id_T2, T3: r.obs_id_T3 },
  });
}

const errors = [];

/** "L03;L07:T3" -> [uuid, uuid, ...] */
function expandCites(cites, where) {
  if (!cites) return [];
  const out = [];
  for (const raw of cites.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
    const [refPart, termPart] = raw.split(":").map((s) => s.trim());
    const entry = byRef.get(refPart.toUpperCase());
    if (!entry) { errors.push(`${where}: unknown reference "${refPart}"`); continue; }

    if (termPart) {
      const id = entry.ids[termPart.toUpperCase()];
      if (!id) errors.push(`${where}: ${refPart} has no ${termPart}`);
      else out.push(id);
    } else {
      for (const id of Object.values(entry.ids)) if (id) out.push(id);
    }
  }
  return [...new Set(out)];
}

// ---- findings ----

const findingRows = read("findings.csv").filter((r) => r.statement);
const findingIds = new Set();
const expectedFindings = [];

for (const r of findingRows) {
  const where = `findings.csv ${r.finding_id || "(no id)"}`;
  if (!r.finding_id) errors.push(`${where}: finding_id is required`);
  if (findingIds.has(r.finding_id)) errors.push(`${where}: duplicate finding_id`);
  findingIds.add(r.finding_id);

  const kind = r.kind.toLowerCase();
  if (kind !== "strength" && kind !== "growth") {
    errors.push(`${where}: kind must be "strength" or "growth", got "${r.kind}"`);
  }

  const cited = expandCites(r.cites, where);
  if (cited.length === 0) errors.push(`${where}: no valid citations — an uncited finding cannot be scored`);

  expectedFindings.push({
    findingId: r.finding_id,
    kind,
    statement: r.statement,
    citedObservationIds: cited,
  });
}

// ---- plan ----

const planRows = read("plan.csv").filter((r) => r.title);
const activities = [];

for (const r of planRows) {
  const where = `plan.csv ${r.activity_id || "(no id)"}`;
  if (r.addresses_finding && !findingIds.has(r.addresses_finding)) {
    errors.push(`${where}: addresses_finding "${r.addresses_finding}" is not a finding_id in findings.csv`);
  }
  activities.push({
    activityId: r.activity_id,
    title: r.title,
    instructions: r.instructions,
    addressesFinding: r.addresses_finding || null,
  });
}

// ---- corroborations ----

const VERDICTS = new Set(["corroborated", "not_mentioned", "conflicting"]);
const expectedCorroborations = [];

for (const r of read("corroborations.csv").filter((v) => v.claim_statement)) {
  const verdict = r.expected_verdict.toLowerCase().trim();
  if (!VERDICTS.has(verdict)) {
    errors.push(`corroborations.csv: verdict must be one of ${[...VERDICTS].join(", ")}, got "${r.expected_verdict}"`);
    continue;
  }
  expectedCorroborations.push({ claimStatement: r.claim_statement, expectedVerdict: verdict });
}

// ---- report ----

if (errors.length) {
  console.error(`FAIL  ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

if (expectedFindings.length === 0 && activities.length === 0) {
  console.error("FAIL  nothing filled in — findings.csv and plan.csv are both empty.");
  process.exit(1);
}

const base = JSON.parse(readFileSync(join(caseDir, "labels.json"), "utf8"));

const out = {
  caseId,
  annotator,
  origin: base.origin,
  caseLabel: base.caseLabel ?? null,
  reportId: base.reportId,
  child: base.child ?? null,
  frozenAt: freeze ? new Date().toISOString() : null,
  expectedFindings,
  expectedPlan: { activities },
  expectedCorroborations,
};

const outPath = join(caseDir, `labels.${annotator}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");

console.log(`PASS  wrote ${outPath}`);
console.log(`  findings:       ${expectedFindings.length}`);
console.log(`  plan activities:${String(activities.length).padStart(2)}`);
console.log(`  corroborations: ${expectedCorroborations.length}`);
console.log(`  citations:      ${expectedFindings.reduce((s, f) => s + f.citedObservationIds.length, 0)} observation ids, all resolved`);
if (!freeze) console.log(`\nNot frozen. Re-run with --freeze when you are done editing.`);
process.exitCode = 0;
