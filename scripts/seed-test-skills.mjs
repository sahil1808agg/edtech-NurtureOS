/**
 * Seeds a SMALL, illustrative set of skills for local testing — NOT the real
 * curated ontology (that's a product content asset, per PRD "the moat", and
 * isn't something to invent wholesale here). Only run against a dev project.
 *
 *   node scripts/seed-test-skills.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

const SKILLS = [
  { code: "LANG.LISTENING.COMPREHENSION", name: "Listening comprehension of varied texts", domain: "LANG" },
  { code: "LANG.LISTENING.DIRECTIONS", name: "Follows classroom directions and routines", domain: "LANG" },
  { code: "LANG.LISTENING.RESPONSE", name: "Responds to texts with enjoyment and understanding", domain: "LANG" },
  { code: "LANG.READING.FLUENCY", name: "Reading fluency and sight word recognition", domain: "LANG" },
  { code: "MATH.NUMBER.COUNTING", name: "One-to-one correspondence counting", domain: "MATH" },
  { code: "UOI.LIVING_THINGS.CHARACTERISTICS", name: "Characteristics of living and non-living things", domain: "UOI" },
  { code: "HINDI.SPEAKING.PARTICIPATION", name: "Participation and enthusiasm in Hindi class", domain: "HINDI" },
];

for (const s of SKILLS) {
  const { data: existing } = await admin.from("skills").select("id").eq("code", s.code).maybeSingle();
  if (existing) {
    console.log(`SKIP  ${s.code} already exists`);
    continue;
  }
  const { error } = await admin.from("skills").insert(s);
  if (error) throw new Error(`skill ${s.code}: ${error.message}`);
  console.log(`PASS  inserted ${s.code}`);
}
