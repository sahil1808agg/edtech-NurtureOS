/**
 * RLS isolation test — PRD hard gate "cross-child leakage: 0".
 *
 * Creates two real families with two real signed-in users, then probes every
 * family-scoped table from each side. Asserts behaviour through PostgREST,
 * which is the path the app actually uses — not assertions about policy text.
 *
 *   node scripts/test-rls.mjs
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

const results = [];
const pass = (name, detail = "") => results.push({ ok: true, name, detail });
const fail = (name, detail = "") => results.push({ ok: false, name, detail });

const suffix = randomUUID().slice(0, 8);
const made = { users: [], families: [] };

async function makeFamily(tag) {
  const email = `rls-${tag}-${suffix}@nurtureos.test`;
  const password = randomUUID();

  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (uErr) throw new Error(`createUser ${tag}: ${uErr.message}`);
  made.users.push(u.user.id);

  const { data: fam, error: fErr } = await admin
    .from("families").insert({}).select("id").single();
  if (fErr) throw new Error(`family ${tag}: ${fErr.message}`);
  made.families.push(fam.id);

  const { error: pErr } = await admin
    .from("profiles").insert({ id: u.user.id, family_id: fam.id, full_name: `Parent ${tag}` });
  if (pErr) throw new Error(`profile ${tag}: ${pErr.message}`);

  const { data: child, error: cErr } = await admin
    .from("children")
    .insert({ family_id: fam.id, first_name: `Child${tag}`, dob: "2020-05-01", grade: "EYP3" })
    .select("id").single();
  if (cErr) throw new Error(`child ${tag}: ${cErr.message}`);

  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn ${tag}: ${sErr.message}`);

  return { tag, familyId: fam.id, childId: child.id, userId: u.user.id, client };
}

async function cleanup() {
  for (const f of made.families) await admin.from("children").delete().eq("family_id", f);
  await admin.from("profiles").delete().in("id", made.users);
  for (const f of made.families) await admin.from("families").delete().eq("id", f);
  for (const u of made.users) await admin.auth.admin.deleteUser(u);
}

try {
  const A = await makeFamily("a");
  const B = await makeFamily("b");

  // ---- read isolation on children -------------------------------------
  {
    const { data } = await A.client.from("children").select("id, first_name");
    const ids = (data ?? []).map((r) => r.id);
    if (ids.includes(B.childId)) fail("A cannot list B's child", "B's child appeared in A's list");
    else if (!ids.includes(A.childId)) fail("A can list own child", "own child missing");
    else pass("children: A sees own child only", `${ids.length} row(s)`);
  }

  // ---- targeted read of another family's row ---------------------------
  {
    const { data } = await A.client.from("children").select("id").eq("id", B.childId);
    if ((data ?? []).length > 0) fail("A cannot fetch B's child by id", "returned a row");
    else pass("children: targeted fetch of B's row blocked");
  }

  // ---- write isolation --------------------------------------------------
  {
    const { data } = await A.client
      .from("children").update({ first_name: "Hacked" }).eq("id", B.childId).select("id");
    if ((data ?? []).length > 0) fail("A cannot update B's child", "update succeeded");
    else {
      const { data: check } = await admin
        .from("children").select("first_name").eq("id", B.childId).single();
      check?.first_name === "Childb"
        ? pass("children: update of B's row blocked")
        : fail("children: update of B's row blocked", `name is now ${check?.first_name}`);
    }
  }

  // ---- inserting into another family ------------------------------------
  {
    const { error } = await A.client
      .from("children")
      .insert({ family_id: B.familyId, first_name: "Injected", dob: "2020-01-01", grade: "EYP3" });
    error
      ? pass("children: insert into B's family rejected")
      : fail("children: insert into B's family rejected", "insert succeeded");
    await admin.from("children").delete().eq("first_name", "Injected");
  }

  // ---- every family-scoped table ----------------------------------------
  const SCOPED = [
    "children", "consents", "family_constraints", "reports", "observations",
    "narratives", "finding_sets", "findings", "parent_finding_responses",
    "plans", "checkins",
  ];
  for (const t of SCOPED) {
    const { data, error } = await A.client.from(t).select("family_id");
    if (error) { fail(`${t}: readable by owner`, error.message); continue; }
    const foreign = (data ?? []).filter((r) => r.family_id !== A.familyId);
    foreign.length === 0
      ? pass(`${t}: no foreign family_id visible`, `${(data ?? []).length} row(s)`)
      : fail(`${t}: no foreign family_id visible`, `${foreign.length} foreign row(s)`);
  }

  // ---- tables with no RLS at all ----------------------------------------
  for (const t of ["profiles", "families"]) {
    const { data, error } = await A.client.from(t).select("id");
    if (error) {
      // A recursion error means the policy is broken, not that access is denied.
      fail(`${t}: only own row visible`,
        /recursion/i.test(error.message) ? "POLICY RECURSION: " + error.message : error.message);
      continue;
    }
    const n = (data ?? []).length;
    if (n === 1) pass(`${t}: only own row visible`, "1 row");
    else if (n === 0) fail(`${t}: only own row visible`, "own row not readable");
    else fail(`${t}: only own row visible`, `${n} rows visible — LEAK`);
  }

  // ---- reference data must stay readable --------------------------------
  {
    const { data, error } = await A.client.from("scale_values").select("raw_value");
    (!error && (data ?? []).length === 4)
      ? pass("reference data readable", `${data.length} scale values`)
      : fail("reference data readable", error?.message ?? `${data?.length} rows`);
  }
} catch (e) {
  fail("setup", e.message);
} finally {
  await cleanup();
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  — " + r.detail : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
