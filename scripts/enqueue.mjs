/**
 * Enqueues one pipeline job.
 *
 *   node scripts/enqueue.mjs report.extract   '{"reportId":"..."}'
 *   node scripts/enqueue.mjs report.normalise '{"reportId":"..."}'
 *   node scripts/enqueue.mjs plan.generate    '{"childId":"..."}'
 */
import { readFileSync } from "node:fs";
import { PgBoss } from "pg-boss";

const [queue, payload] = process.argv.slice(2);
if (!queue) {
  console.error("Usage: node scripts/enqueue.mjs <queue> '<json-payload>'");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "")]),
);

// Small pool: this sends one job and exits, and the session pooler's budget is
// shared with the worker and the web app.
const boss = new PgBoss({
  connectionString: env.DATABASE_URL,
  max: 1,
  supervise: false,
  schedule: false,
  application_name: "nurtureos-script",
});
boss.on("error", (e) => console.error("pg-boss:", e.message));
await boss.start();
const id = await boss.send(queue, payload ? JSON.parse(payload) : {});
console.log(`enqueued ${queue}: ${id}`);
await boss.stop({ graceful: false });
