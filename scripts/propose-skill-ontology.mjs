/**
 * Curation tool, NOT part of the live pipeline. Clusters real unmapped raw
 * labels (observations.skill_id is null) into a proposed skill ontology using
 * an LLM, and writes the proposal to a file for human review. Nothing is
 * inserted into skills/skill_aliases automatically — see
 * scripts/apply-skill-ontology-proposal.mjs for that, once you've reviewed.
 *
 *   node scripts/propose-skill-ontology.mjs [report-id] [output-file]
 *
 * With no report-id, pulls unmapped labels across every report.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

const reportId = process.argv[2] || null;
const outputFile = process.argv[3] || "skill-ontology-proposal.json";

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

let obsQuery = admin.from("observations").select("report_id, raw_label").is("skill_id", null);
if (reportId) obsQuery = obsQuery.eq("report_id", reportId);
const { data: unmapped, error: obsErr } = await obsQuery;
if (obsErr) throw new Error(obsErr.message);

const uniqueLabels = [...new Set((unmapped ?? []).map((o) => o.raw_label))];
if (uniqueLabels.length === 0) {
  console.log("No unmapped labels found — nothing to propose.");
  process.exit(0);
}

// Pull subject/section context for these labels from the extraction raw_json,
// since the DB observations row alone doesn't carry it.
const reportIds = [...new Set((unmapped ?? []).map((o) => o.report_id))];
const { data: extractions } = await admin.from("extractions").select("raw_json").in("report_id", reportIds);

const contextByLabel = new Map();
for (const ext of extractions ?? []) {
  for (const cell of ext.raw_json.cells ?? []) {
    if (!contextByLabel.has(cell.rawLabel)) {
      contextByLabel.set(cell.rawLabel, { subject: cell.subject, section: cell.section });
    }
  }
}

const items = uniqueLabels.map((label) => ({
  rawLabel: label,
  subject: contextByLabel.get(label)?.subject ?? null,
  section: contextByLabel.get(label)?.section ?? null,
}));

console.log(`Clustering ${items.length} unmapped raw labels into a proposed skill ontology...`);

const SYSTEM = `
You help curate a cross-board educational skill ontology from real school report card language.

You are given raw skill-standard descriptions (each with the subject/section it appeared under).
Group semantically-equivalent descriptions under ONE proposed skill. Distinct concepts get
distinct entries. Prefer more, narrower skills over fewer, vaguer ones — a skill this granular
should map cleanly onto one teachable, assessable classroom concept.

Rules:
- code: dot-notation, ALL CAPS, e.g. "MATH.NUMBER.PLACE_VALUE". Top-level segment is the domain.
- domain: a short uppercase category (e.g. MATH, LANG, UOI, HINDI, ARTS, PSPE) — infer from subject.
- name: a short human-readable phrase, not a restatement of one rawLabel verbatim.
- Every input rawLabel must be assigned to exactly one proposed skill.
- Do not invent skills unrelated to the input — every proposed skill must be grounded in at least one given rawLabel.

Return exactly this JSON schema:
{
  "proposals": [
    {
      "code": string,
      "name": string,
      "domain": string,
      "rawLabels": string[]
    }
  ]
}
`.trim();

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
const response = await ai.models.generateContent({
  model: "gemini-3.7-flash",
  contents: [{ text: JSON.stringify({ instruction: "Cluster these into a proposed skill ontology.", items }) }],
  config: { systemInstruction: SYSTEM, responseMimeType: "application/json" },
});

const proposal = JSON.parse(response.text);
writeFileSync(outputFile, JSON.stringify(proposal, null, 2));

console.log(`\nProposed ${proposal.proposals.length} skills, covering ${items.length} raw labels.`);
console.log(`Written to ${outputFile} — review before running apply-skill-ontology-proposal.mjs.\n`);
for (const p of proposal.proposals) {
  console.log(`  ${p.code} (${p.domain}) — ${p.name}`);
  console.log(`    ${p.rawLabels.length} label(s): ${p.rawLabels.slice(0, 2).join(" | ")}${p.rawLabels.length > 2 ? " | ..." : ""}`);
}
