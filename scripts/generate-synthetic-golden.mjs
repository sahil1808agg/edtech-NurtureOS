/**
 * Generates a synthetic golden set: 30 children, EYP3 through PYP5.
 *
 *   node scripts/generate-synthetic-golden.mjs --dry-run
 *   node scripts/generate-synthetic-golden.mjs --write            # labels.json only
 *   node scripts/generate-synthetic-golden.mjs --write --seed-db  # + rows in Supabase
 *   node scripts/generate-synthetic-golden.mjs --write --seed-db --seed 42
 *
 * Deterministic by design. Everything derives from a seeded PRNG, including the
 * UUIDs, so re-running with the same --seed reproduces byte-identical labels and
 * the same observation ids the labels cite. No model is called: ground truth
 * that a model wrote is not ground truth, and a golden set that changes when you
 * regenerate it cannot be a regression baseline.
 *
 * How the ground truth is honest: each child is given a PROFILE first (per-domain
 * ability, social and emotional posture, a trajectory shape), and the observations
 * are derived from it. The expected findings are then read back off the profile,
 * not off the observations. So correctness measures "did analyse recover what we
 * planted", which is a real signal even though the reports are invented.
 *
 * What it does NOT give you: evidence that extraction works on genuine school
 * PDF layouts. These cases carry no PDF at all.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const write = args.includes("--write");
const seedDb = args.includes("--seed-db");
const csvOnly = args.includes("--csv-only");
const withPdf = args.includes("--pdf");
const seedArg = args.indexOf("--seed");
const SEED = seedArg !== -1 && args[seedArg + 1] ? Number(args[seedArg + 1]) : 20260904;

const countArg = args.indexOf("--count");
const COUNT = countArg !== -1 && args[countArg + 1] ? Number(args[countArg + 1]) : 30;

// --grade pins every generated child to one grade, for working through a single
// case. Without it the cohort cycles through EYP3..PYP5 evenly.
const gradeArg = args.indexOf("--grade");
const FORCE_GRADE = gradeArg !== -1 ? args[gradeArg + 1] : null;

if (!dryRun && !write && !csvOnly) {
  console.error("Refusing to run without --write or --csv-only. Use --dry-run to preview.");
  process.exit(1);
}

// ---------- CSV ----------

/**
 * RFC 4180 quoting. Narrative text contains commas and apostrophes, and a
 * naive join would silently shift every later column on those rows.
 */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(headers, rows) {
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvCell(r[h])).join(","));
  // Excel and Sheets both need the BOM to read UTF-8 names correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ---------- report card PDF ----------

/**
 * Collapses the flat observation list into one row per label, with a column per
 * term. This is the shape a real report card grid has, and it is also exactly
 * what extraction is expected to return — so the same function feeds both the
 * PDF and the expectedCells ground truth. If they were built separately they
 * could disagree, and the eval would be scoring the generator's bug.
 */
function toGrid(observations) {
  const byLabel = new Map();
  for (const o of observations) {
    if (!byLabel.has(o.rawLabel)) {
      byLabel.set(o.rawLabel, { rawLabel: o.rawLabel, subject: o.band, values: [] });
    }
    byLabel.get(o.rawLabel).values.push({ termIndex: o.termIndex, rawValue: o.rawValue });
  }
  for (const row of byLabel.values()) row.values.sort((a, b) => a.termIndex - b.termIndex);
  return [...byLabel.values()];
}

const SUBJECT_TITLE = {
  LANG: "English", MATH: "Mathematics", ARTS: "The Arts", HINDI: "Hindi",
  UOI: "Unit of Inquiry", social: "Social Development",
  emotional: "Personal and Emotional Development", physical: "Physical Education",
};

async function renderReportPdf(child, outPath) {
  const { default: PDFDocument } = await import("pdfkit");

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const stream = createWriteStream(outPath);
    doc.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);

    const grid = toGrid(child.observations);
    const terms = [...new Set(child.observations.map((o) => o.termIndex))].sort();

    // ----- header -----
    doc.fontSize(16).font("Helvetica-Bold").text(child.school, { align: "center" });
    doc.fontSize(11).font("Helvetica").text("Primary Years Programme — Progress Report", { align: "center" });
    doc.fontSize(9).text(`Academic Year 2025-26`, { align: "center" });
    doc.moveDown(1);

    // ----- child details -----
    const detailTop = doc.y;
    doc.fontSize(9).font("Helvetica-Bold").text("Student", 48, detailTop);
    doc.font("Helvetica").text(child.firstName, 130, detailTop);
    doc.font("Helvetica-Bold").text("Class", 320, detailTop);
    doc.font("Helvetica").text(child.grade, 380, detailTop);

    doc.font("Helvetica-Bold").text("Date of birth", 48, detailTop + 14);
    doc.font("Helvetica").text(`${child.dob}  (age ${child.age})`, 130, detailTop + 14);
    doc.font("Helvetica-Bold").text("Report", 320, detailTop + 14);
    doc.font("Helvetica").text("Term 3", 380, detailTop + 14);

    doc.font("Helvetica-Bold").text("Address", 48, detailTop + 28);
    doc.font("Helvetica").text(
      `${child.address.line1}, ${child.address.area}, ${child.address.city}, ${child.address.state} ${child.address.pincode}`,
      130, detailTop + 28, { width: 400 },
    );

    doc.moveDown(2.5);

    // ----- legend -----
    doc.fontSize(8).font("Helvetica-Oblique").text(
      "Key:  O = Outstanding   P = Proficient   C = Consolidating   E = Emerging   – = not assessed this term",
    );
    doc.moveDown(0.8);

    // ----- grid -----
    const COL_LABEL = 48;
    const COL_TERM = [372, 424, 476];
    const ROW_H = 16;

    const header = (y) => {
      doc.fontSize(9).font("Helvetica-Bold");
      doc.text("Learning outcome", COL_LABEL, y);
      terms.forEach((t, i) => doc.text(`T${t}`, COL_TERM[i], y, { width: 30, align: "center" }));
      doc.moveTo(COL_LABEL, y + 12).lineTo(547, y + 12).stroke();
    };

    let y = doc.y;
    let currentSubject = null;
    header(y);
    y += 20;

    const bySubject = {};
    for (const row of grid) (bySubject[row.subject] ??= []).push(row);

    for (const [subject, rows] of Object.entries(bySubject)) {
      if (y > 720) { doc.addPage(); y = 60; header(y); y += 20; }

      doc.fontSize(9).font("Helvetica-Bold").fillColor("#1a4d7a")
        .text(SUBJECT_TITLE[subject] ?? subject, COL_LABEL, y);
      doc.fillColor("black");
      y += 15;

      for (const row of rows) {
        if (y > 750) { doc.addPage(); y = 60; header(y); y += 20; }

        doc.fontSize(8).font("Helvetica").text(row.rawLabel, COL_LABEL + 8, y, { width: 300 });
        const used = doc.heightOfString(row.rawLabel, { width: 300 });
        terms.forEach((t, i) => {
          const v = row.values.find((x) => x.termIndex === t);
          doc.font("Helvetica-Bold").text(v ? v.rawValue : "", COL_TERM[i], y, { width: 30, align: "center" });
        });
        y += Math.max(ROW_H, used + 4);
      }
      y += 6;
    }

    // ----- narratives -----
    doc.addPage();
    doc.fontSize(12).font("Helvetica-Bold").text("Teacher comments");
    doc.moveDown(0.5);
    for (const n of child.narratives) {
      doc.fontSize(10).font("Helvetica-Bold").text(n.subject);
      doc.fontSize(9).font("Helvetica").text(n.text, { width: 480, align: "left" });
      doc.moveDown(0.8);
    }

    doc.fontSize(7).font("Helvetica-Oblique").fillColor("#666")
      .text(
        `Synthetic report generated for evaluation. Seed ${SEED}. This describes no real child.`,
        48, 760, { width: 480 },
      );

    doc.end();
  });
}

// ---------- deterministic randomness ----------

/** mulberry32 — small, fast, good enough, and reproducible across machines. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

/** UUID v4 shape, drawn from the seeded stream so ids are reproducible. */
function uuid() {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[(Math.floor(rng() * 16) & 0x3) | 0x8];
    else out += hex[Math.floor(rng() * 16)];
  }
  return out;
}

// ---------- vocabulary ----------

const GRADES = ["EYP3", "PYP1", "PYP2", "PYP3", "PYP4", "PYP5"];
const AGE_FOR_GRADE = { EYP3: 4, PYP1: 6, PYP2: 7, PYP3: 8, PYP4: 9, PYP5: 10 };

/**
 * Invented addresses. Street numbers are drawn from the seeded stream and the
 * localities are real, so these read as plausible without belonging to anyone —
 * no child in this set corresponds to a real person.
 */
const ADDRESSES = [
  { area: "Indiranagar", city: "Bengaluru", state: "Karnataka", pincode: "560038", streets: ["12th Main Road", "100 Feet Road", "Chinmaya Mission Hospital Road"] },
  { area: "Bandra West", city: "Mumbai", state: "Maharashtra", pincode: "400050", streets: ["Hill Road", "Turner Road", "Perry Cross Road"] },
  { area: "Vasant Kunj", city: "New Delhi", state: "Delhi", pincode: "110070", streets: ["Sector C Marg", "Nelson Mandela Road", "Poorvi Marg"] },
  { area: "Banjara Hills", city: "Hyderabad", state: "Telangana", pincode: "500034", streets: ["Road No. 12", "Road No. 3", "Journalist Colony Road"] },
  { area: "Adyar", city: "Chennai", state: "Tamil Nadu", pincode: "600020", streets: ["Sardar Patel Road", "Gandhi Nagar 1st Main Road", "Kasturba Nagar 3rd Cross"] },
  { area: "Koregaon Park", city: "Pune", state: "Maharashtra", pincode: "411001", streets: ["North Main Road", "Lane 5", "Bund Garden Road"] },
  { area: "Salt Lake Sector V", city: "Kolkata", state: "West Bengal", pincode: "700091", streets: ["Block EP", "Major Arterial Road", "College More"] },
  { area: "DLF Phase 3", city: "Gurugram", state: "Haryana", pincode: "122010", streets: ["Cyber City Road", "Golf Course Road", "U Block"] },
  { area: "Sector 62", city: "Noida", state: "Uttar Pradesh", pincode: "201309", streets: ["Institutional Area Road", "C Block", "Fortis Road"] },
  { area: "Satellite", city: "Ahmedabad", state: "Gujarat", pincode: "380015", streets: ["Jodhpur Cross Road", "Prahlad Nagar Road", "Shyamal Cross Road"] },
];

const SCHOOLS = [
  "Oakridge International School", "Greenwood High", "Indus International School",
  "Ekya School", "The Shri Ram School", "Vidyashilp Academy",
];

const NAMES = [
  "Aarav", "Diya", "Vihaan", "Ananya", "Reyansh", "Ishani", "Kabir", "Meera",
  "Arjun", "Saanvi", "Advait", "Kiara", "Rohan", "Anika", "Neel", "Tara",
  "Vivaan", "Myra", "Aditya", "Navya", "Ayaan", "Riya", "Krish", "Sara",
  "Dhruv", "Aisha", "Ved", "Zara", "Ishaan", "Nitara",
];

/**
 * Social-emotional labels are hardcoded because the seeded ontology has no PSPE
 * domain — 57 skills across LANG, MATH, ARTS, HINDI and UOI, and nothing for
 * self-management or social development. These are written as observations with
 * skill_id null, exactly as an unmapped label appears on a real report.
 */
const SOCIAL_LABELS = [
  "Works cooperatively in small group activities",
  "Takes turns and shares materials with peers",
  "Begins to speak appropriately in small and large group interactions",
  "Resolves minor disagreements with growing independence",
  "Contributes ideas during class discussions",
  "Builds and maintains friendships across the class",
];

const EMOTIONAL_LABELS = [
  "Identifies their feelings and emotions and explains possible causes",
  "Identifies and explores strategies that help them cope with change",
  "Willingly approaches and perseveres with new situations",
  "Describes how they have grown and changed",
  "Recognises and responds to the feelings of others",
  "Manages transitions between activities with growing independence",
];

const PHYSICAL_LABELS = [
  "Develops physical balance and coordination",
  "Demonstrates control in gross motor movement",
  "Uses fine motor skills with increasing precision",
];

// ---------- profiles ----------

const ACADEMIC = ["strong", "mixed", "emerging"];
const SOCIAL = ["confident", "developing", "reserved"];
const EMOTIONAL = ["regulated", "developing", "needs_support"];

/** Mean normalised value a posture should produce, on the IB_OPCE 0.25–1.0 scale. */
const LEVEL = {
  strong: 0.9, mixed: 0.65, emerging: 0.45,
  confident: 0.9, developing: 0.65, reserved: 0.5,
  regulated: 0.9, needs_support: 0.45,
};

const RAW_FOR = (n) => (n >= 0.875 ? "O" : n >= 0.625 ? "P" : n >= 0.375 ? "C" : "E");
const NORM_FOR = { O: 1.0, P: 0.75, C: 0.5, E: 0.25 };

/**
 * Six adversarial shapes from the PRD, distributed through the cohort so the
 * set exercises the gates rather than only the happy path.
 */
const ADVERSARIAL = {
  thin_report: "Too few observations — sufficiency gate must fire (O3)",
  trailing_dash: "Assessment stopped in T3 — must not be read as a fall (O6)",
  interior_gap: "O, -, P — uninterpretable, not reportable (O5)",
  conflicting_narrative: "Teacher contradicts the grid (O4)",
  all_ambiguous: "Mostly dashes — solid ratio below threshold (O3)",
  single_term: "One term only — no trajectory can be built",
};

// ---------- generation ----------

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

const { data: skillRows, error: skillErr } = await admin
  .from("skills")
  .select("id, code, name, domain, sub_domain")
  .order("code");
if (skillErr) {
  console.error(`FAIL  reading skills: ${skillErr.message}`);
  process.exit(1);
}
if (!skillRows?.length) {
  console.error("FAIL  no skills in the ontology. Run the ontology seed first.");
  process.exit(1);
}

const skillsByDomain = {};
for (const s of skillRows) (skillsByDomain[s.domain] ??= []).push(s);

/** Older children are assessed against more of the ontology. */
function skillCountForGrade(grade) {
  return { EYP3: 10, PYP1: 14, PYP2: 16, PYP3: 18, PYP4: 20, PYP5: 22 }[grade];
}

function buildChild(index) {
  const grade = FORCE_GRADE ?? GRADES[index % GRADES.length];
  const age = AGE_FOR_GRADE[grade];
  const addr = pick(ADDRESSES);
  const address = {
    line1: `${int(1, 240)}, ${pick(addr.streets)}`,
    area: addr.area,
    city: addr.city,
    state: addr.state,
    pincode: addr.pincode,
  };
  const city = address.city;
  const pincode = address.pincode;
  const school = pick(SCHOOLS);
  const firstName = NAMES[index];

  const profile = {
    academic: pick(ACADEMIC),
    social: pick(SOCIAL),
    emotional: pick(EMOTIONAL),
  };

  // Six of thirty carry an adversarial shape; the rest are ordinary.
  const advKeys = Object.keys(ADVERSARIAL);
  const adversarial = index % 5 === 4 ? advKeys[Math.floor(index / 5) % advKeys.length] : null;

  const birthYear = 2026 - age;
  const dob = `${birthYear}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;

  const familyId = uuid();
  const childId = uuid();
  const reportId = uuid();

  // Pick the skills this child is assessed on, biased toward their grade band.
  const wanted = skillCountForGrade(grade);
  const pool = [...skillRows];
  const chosen = [];
  while (chosen.length < wanted && pool.length) {
    chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }

  // Non-academic labels carry no skill_id — the ontology has no PSPE domain.
  const extras = [
    ...SOCIAL_LABELS.slice(0, grade === "EYP3" ? 3 : 4).map((l) => ({ label: l, band: "social" })),
    ...EMOTIONAL_LABELS.slice(0, grade === "EYP3" ? 3 : 4).map((l) => ({ label: l, band: "emotional" })),
    ...PHYSICAL_LABELS.map((l) => ({ label: l, band: "physical" })),
  ];

  const terms = adversarial === "single_term" ? [1] : [1, 2, 3];
  const observations = [];

  const emit = (rawLabel, skillId, band) => {
    const base =
      band === "social" ? LEVEL[profile.social]
      : band === "emotional" ? LEVEL[profile.emotional]
      : band === "physical" ? 0.75
      : LEVEL[profile.academic];

    for (const termIndex of terms) {
      // Gentle upward drift across terms, plus noise, so trajectories vary.
      let n = base + (termIndex - 2) * 0.06 + (rng() - 0.5) * 0.18;
      n = Math.max(0.25, Math.min(1.0, n));
      let raw = RAW_FOR(n);

      if (adversarial === "trailing_dash" && termIndex === 3) raw = "-";
      if (adversarial === "interior_gap" && termIndex === 2) raw = "-";
      if (adversarial === "all_ambiguous" && rng() < 0.7) raw = "-";

      const ambiguous = raw === "-";
      observations.push({
        id: uuid(),
        rawLabel,
        skillId,
        band,
        termIndex,
        rawValue: raw,
        normalised: ambiguous ? null : NORM_FOR[raw],
        isAmbiguous: ambiguous,
      });
    }
  };

  const academicSkills = adversarial === "thin_report" ? chosen.slice(0, 3) : chosen;
  for (const s of academicSkills) emit(s.name, s.id, s.domain);
  if (adversarial !== "thin_report") for (const e of extras) emit(e.label, null, e.band);

  // ----- narratives -----
  const narratives = [];
  const strongWord = profile.academic === "strong" ? "confidently" : profile.academic === "mixed" ? "steadily" : "with support";
  narratives.push({
    id: uuid(),
    subject: "English",
    text:
      `${firstName} reads and writes ${strongWord} this year. ` +
      `They enjoy shared reading sessions and are beginning to use punctuation more consistently in independent writing. ` +
      `Encouraging daily reading at home would continue to build fluency.`,
  });
  narratives.push({
    id: uuid(),
    subject: "Homeroom",
    text:
      profile.social === "confident"
        ? `${firstName} works happily alongside peers and often takes the lead in group tasks. They settle quickly after transitions and are a warm presence in the classroom.`
        : profile.social === "reserved"
          ? `${firstName} prefers to work quietly and is building confidence in speaking to the whole group. One-to-one they share ideas readily.`
          : `${firstName} is growing in confidence with peers and joins group work willingly when the task is familiar.`,
  });

  if (adversarial === "conflicting_narrative") {
    // The grid says the child is doing well; the teacher says otherwise. O4.
    narratives.push({
      id: uuid(),
      subject: "Mathematics",
      text: `${firstName} continues to find number work difficult and needs considerable adult support to complete tasks independently. Progress this term has been slower than the recorded marks suggest.`,
    });
  }

  // ----- expected findings, read off the PROFILE, not the observations -----
  const expectedFindings = [];
  const byBand = {};
  for (const o of observations) (byBand[o.band] ??= []).push(o);

  const solidIds = (band) =>
    (byBand[band] ?? []).filter((o) => !o.isAmbiguous).map((o) => o.id);

  if (!adversarial || adversarial === "conflicting_narrative") {
    for (const [band, posture] of [
      ["social", profile.social],
      ["emotional", profile.emotional],
    ]) {
      const ids = solidIds(band);
      if (ids.length < 3) continue;
      const strong = posture === "confident" || posture === "regulated";
      expectedFindings.push({
        kind: strong ? "strength" : "growth",
        statement: strong
          ? `Shows consistent ${band} development across the year.`
          : `Continues to develop ${band} skills with support.`,
        citedObservationIds: ids.slice(0, 4),
      });
    }
    for (const domain of ["LANG", "MATH"]) {
      const ids = solidIds(domain);
      if (ids.length < 3) continue;
      expectedFindings.push({
        kind: profile.academic === "strong" ? "strength" : "growth",
        statement:
          profile.academic === "strong"
            ? `Demonstrates secure ${domain === "LANG" ? "literacy" : "numeracy"} skills.`
            : `Is developing ${domain === "LANG" ? "literacy" : "numeracy"} skills across the year.`,
        citedObservationIds: ids.slice(0, 4),
      });
    }
  }

  return {
    caseId: `syn-${String(index + 1).padStart(2, "0")}-${grade.toLowerCase()}-${firstName.toLowerCase()}`,
    familyId, childId, reportId,
    firstName, dob, grade, city, pincode, age,
    address, school,
    profile, adversarial,
    observations, narratives, expectedFindings,
  };
}

const cohort = Array.from({ length: COUNT }, (_, i) => buildChild(i));

// ---------- report ----------

console.log(`seed=${SEED}  children=${cohort.length}`);
console.log(
  `${"case".padEnd(30)} ${"grade".padEnd(6)} ${"age".padEnd(4)} ${"city".padEnd(11)} ${"acad".padEnd(9)} ${"social".padEnd(11)} ${"emotional".padEnd(13)} obs  narr  exp  adversarial`,
);
for (const c of cohort) {
  console.log(
    `${c.caseId.padEnd(30)} ${c.grade.padEnd(6)} ${String(c.age).padEnd(4)} ${c.city.padEnd(11)} ${c.profile.academic.padEnd(9)} ${c.profile.social.padEnd(11)} ${c.profile.emotional.padEnd(13)} ${String(c.observations.length).padStart(3)}  ${String(c.narratives.length).padStart(4)}  ${String(c.expectedFindings.length).padStart(3)}  ${c.adversarial ?? ""}`,
  );
}

const totals = {
  observations: cohort.reduce((s, c) => s + c.observations.length, 0),
  narratives: cohort.reduce((s, c) => s + c.narratives.length, 0),
  expected: cohort.reduce((s, c) => s + c.expectedFindings.length, 0),
  adversarial: cohort.filter((c) => c.adversarial).length,
};
console.log(
  `\ntotals — observations ${totals.observations}, narratives ${totals.narratives}, expected findings ${totals.expected}, adversarial cases ${totals.adversarial}`,
);

// Wrapped so the early exits can `return` instead of calling process.exit().
// process.exit() straight after a Supabase query aborts the process on Windows
// with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" and an exit code
// of 127 — the work completes, then the process dies reporting failure.
await (async () => {
if (dryRun) {
  console.log("\n(dry run — nothing written)");
  return;
}

// ---------- CSV export ----------

const CSV_DIR = join("evals", "datasets");
if (!existsSync(CSV_DIR)) mkdirSync(CSV_DIR, { recursive: true });

// 1. Roster — one row per child, for reading and for filtering in Braintrust.
writeFileSync(
  join(CSV_DIR, "children.csv"),
  csv(
    ["case_id", "child_id", "report_id", "first_name", "grade", "age", "dob", "city", "pincode",
     "academic", "social", "emotional", "adversarial", "observations", "narratives", "expected_findings"],
    cohort.map((c) => ({
      case_id: c.caseId, child_id: c.childId, report_id: c.reportId,
      first_name: c.firstName, grade: c.grade, age: c.age, dob: c.dob,
      city: c.city, pincode: c.pincode,
      academic: c.profile.academic, social: c.profile.social, emotional: c.profile.emotional,
      adversarial: c.adversarial ?? "",
      observations: c.observations.length, narratives: c.narratives.length,
      expected_findings: c.expectedFindings.length,
    })),
  ),
);

// 2. Every observation, flat. This is the grid a report would show.
writeFileSync(
  join(CSV_DIR, "observations.csv"),
  csv(
    ["case_id", "report_id", "observation_id", "raw_label", "band", "skill_id",
     "term_index", "raw_value", "normalised", "is_ambiguous"],
    cohort.flatMap((c) =>
      c.observations.map((o) => ({
        case_id: c.caseId, report_id: c.reportId, observation_id: o.id,
        raw_label: o.rawLabel, band: o.band, skill_id: o.skillId ?? "",
        term_index: o.termIndex, raw_value: o.rawValue,
        normalised: o.normalised ?? "", is_ambiguous: o.isAmbiguous,
      })),
    ),
  ),
);

// 3. Teacher narratives.
writeFileSync(
  join(CSV_DIR, "narratives.csv"),
  csv(
    ["case_id", "report_id", "narrative_id", "subject", "text"],
    cohort.flatMap((c) =>
      c.narratives.map((n) => ({
        case_id: c.caseId, report_id: c.reportId, narrative_id: n.id,
        subject: n.subject, text: n.text,
      })),
    ),
  ),
);

// 4. Braintrust dataset: correctness. One row per child. The input/expected/
//    metadata columns are JSON so they map straight onto Braintrust's dataset
//    fields on upload — no column mapping needed beyond picking the three.
const correctnessRows = cohort
      .filter((c) => c.expectedFindings.length > 0)
      .map((c) => ({
        // Braintrust deduplicates on `id`, so re-uploading replaces a row
        // instead of adding a second copy of the same case.
        id: c.caseId,
        input: {
          caseId: c.caseId,
          reportId: c.reportId,
          childId: c.childId,
          grade: c.grade,
          ageMonths: c.age * 12,
          observations: c.observations.map((o) => ({
            id: o.id, rawLabel: o.rawLabel, termIndex: o.termIndex,
            rawValue: o.rawValue, normalised: o.normalised, isAmbiguous: o.isAmbiguous,
          })),
          narratives: c.narratives.map((n) => ({ id: n.id, subject: n.subject, text: n.text })),
        },
        expected: c.expectedFindings,
        metadata: {
          caseId: c.caseId, grade: c.grade, age: c.age, city: c.city,
          academic: c.profile.academic, social: c.profile.social, emotional: c.profile.emotional,
          adversarial: c.adversarial ?? null, origin: c.adversarial ? "adversarial" : "synthetic",
        },
        tags: [c.grade, c.profile.academic, c.adversarial ?? "ordinary"].join(" "),
      }));

writeFileSync(
  join(CSV_DIR, "braintrust-correctness.csv"),
  csv(["id", "input", "expected", "metadata", "tags"], correctnessRows),
);

// 5. Braintrust dataset: corroboration. One row per claim/verdict pair.
const corroborationRows = cohort.flatMap((c) => {
  const rows = [];
  if (c.adversarial === "conflicting_narrative") {
    rows.push({ claim: "Demonstrates secure numeracy skills.", verdict: "conflicting" });
  }
  // Every child's English narrative supports a literacy claim, and none of them
  // mentions numeracy — so each case yields one corroborated and one
  // not_mentioned pair, which stops the set being all one verdict.
  rows.push({ claim: `Reads and writes with growing independence.`, verdict: "corroborated" });
  rows.push({ claim: `Shows strong spatial reasoning in geometry tasks.`, verdict: "not_mentioned" });
  return rows.map((r, i) => ({
    id: `${c.caseId}-corr-${i + 1}`,
    input: {
      caseId: c.caseId,
      reportId: c.reportId,
      claimStatement: r.claim,
      narratives: c.narratives.map((n) => ({ id: n.id, subject: n.subject, text: n.text })),
    },
    expected: r.verdict,
    metadata: { caseId: c.caseId, grade: c.grade, adversarial: c.adversarial ?? null },
    tags: `${c.grade} ${r.verdict}`,
  }));
});

writeFileSync(
  join(CSV_DIR, "braintrust-corroboration.csv"),
  csv(["id", "input", "expected", "metadata", "tags"], corroborationRows),
);

// 6. Same two datasets as JSONL.
//
// The CSV files above carry `input` and `metadata` as JSON text in one cell.
// Braintrust's docs do not say whether CSV cells are parsed as JSON or kept as
// strings, and if they are kept as strings then `input` arrives as a blob of
// text rather than an object with observations you can score against. JSONL is
// unambiguous — nested objects stay objects — so upload these if the CSV
// preview shows input as a string.
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
writeFileSync(join(CSV_DIR, "braintrust-correctness.jsonl"), jsonl(correctnessRows));
writeFileSync(join(CSV_DIR, "braintrust-corroboration.jsonl"), jsonl(corroborationRows));

console.log(`\nPASS  wrote datasets to ${CSV_DIR}/`);
console.log(`  children.csv                     ${cohort.length} rows`);
console.log(`  observations.csv                 ${totals.observations} rows`);
console.log(`  narratives.csv                   ${totals.narratives} rows`);
console.log(`  braintrust-correctness.csv/.jsonl   ${correctnessRows.length} rows`);
console.log(`  braintrust-corroboration.csv/.jsonl ${corroborationRows.length} rows`);

if (csvOnly) return;

// ---------- write labels.json ----------

let written = 0;
for (const c of cohort) {
  const dir = join("evals", "golden", c.caseId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const labels = {
    caseId: c.caseId,
    // "synthetic", never "real". golden_reports.origin is free text, and the
    // PRD's 26-case target is 20 REAL cohort reports plus 6 adversarial ones —
    // labelling generated data "real" would quietly make that count look met.
    origin: c.adversarial ? "adversarial" : "synthetic",
    caseLabel: c.adversarial ?? null,
    annotator: "synthetic-generator",
    notes:
      `Synthetic. seed=${SEED}. ${c.grade}, age ${c.age}, ${c.city}. ` +
      `profile: academic=${c.profile.academic} social=${c.profile.social} emotional=${c.profile.emotional}.` +
      (c.adversarial ? ` Adversarial: ${ADVERSARIAL[c.adversarial]}` : ""),
    reportId: c.reportId,
    child: {
      firstName: c.firstName,
      age: c.age,
      dob: c.dob,
      grade: c.grade,
      school: c.school,
      address: c.address,
    },
    expectedFindings: c.expectedFindings,
    // Only meaningful when a report.pdf exists beside this file — extraction
    // has nothing to read otherwise. Built from the same toGrid() the PDF is
    // rendered from, so the two cannot disagree.
    expectedCells: withPdf ? toGrid(c.observations) : [],
    expectedCorroborations: c.adversarial === "conflicting_narrative"
      ? [{ claimStatement: "Demonstrates secure numeracy skills.", expectedVerdict: "conflicting" }]
      : [],
  };

  writeFileSync(join(dir, "labels.json"), JSON.stringify(labels, null, 2) + "\n");
  if (withPdf) await renderReportPdf(c, join(dir, "report.pdf"));
  written++;
}
console.log(`\nPASS  wrote ${written} labels.json${withPdf ? " + report.pdf" : ""} under evals/golden/`);

if (!seedDb) {
  console.log("Pass --seed-db to also insert families, children, reports, observations and narratives.");
  return;
}

// ---------- seed Supabase ----------

for (const c of cohort) {
  const fail = (what, e) => {
    console.error(`FAIL  ${c.caseId} ${what}: ${e.message}`);
    process.exit(1);
  };

  let r = await admin.from("families").insert({ id: c.familyId }).select("id").single();
  if (r.error) fail("families", r.error);

  r = await admin.from("children").insert({
    id: c.childId, family_id: c.familyId, first_name: c.firstName,
    dob: c.dob, grade: c.grade, city: c.city, pincode: c.pincode,
  });
  if (r.error) fail("children", r.error);

  r = await admin.from("reports").insert({
    id: c.reportId, family_id: c.familyId, child_id: c.childId,
    term_label: "T3", term_index: 3, academic_year: "2025-26",
    source_type: "pdf", storage_path: `synthetic/${c.caseId}`,
    status: "normalised",
  });
  if (r.error) fail("reports", r.error);

  const obsRows = c.observations.map((o) => ({
    id: o.id, family_id: c.familyId, child_id: c.childId, report_id: c.reportId,
    skill_id: o.skillId, raw_label: o.rawLabel, scale_id: "IB_OPCE",
    term_index: o.termIndex, raw_value: o.rawValue, normalised: o.normalised,
    is_ambiguous: o.isAmbiguous, confidence: 1.0, source_ref: { page: 1 },
  }));
  for (let i = 0; i < obsRows.length; i += 500) {
    r = await admin.from("observations").insert(obsRows.slice(i, i + 500));
    if (r.error) fail("observations", r.error);
  }

  r = await admin.from("narratives").insert(
    c.narratives.map((n) => ({
      id: n.id, family_id: c.familyId, report_id: c.reportId,
      subject: n.subject, text: n.text, source_ref: { page: 2 },
    })),
  );
  if (r.error) fail("narratives", r.error);

  console.log(`PASS  seeded ${c.caseId} (${c.observations.length} obs, ${c.narratives.length} narratives)`);
}

console.log(`\nPASS  seeded ${cohort.length} synthetic children.`);
console.log("Next: node scripts/load-golden-set.mjs --yes    then    npm run eval");
})();

process.exitCode = 0;
