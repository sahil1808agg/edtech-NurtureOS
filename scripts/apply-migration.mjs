/**
 * Applies a single .sql migration file to DATABASE_URL, wrapped in a transaction.
 *
 *   node scripts/apply-migration.mjs supabase/migrations/0004_extraction_whole_report.sql
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/apply-migration.mjs <path-to-sql-file>");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "")]),
);

if (!env.DATABASE_URL) {
  console.error("Missing DATABASE_URL in .env.local");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");
const client = new Client({ connectionString: env.DATABASE_URL });

try {
  await client.connect();
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log(`PASS  applied ${file}`);
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error(`FAIL  ${file}:`, err.message);
  process.exit(1);
} finally {
  await client.end();
}
