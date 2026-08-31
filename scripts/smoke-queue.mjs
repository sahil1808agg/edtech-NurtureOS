/**
 * Proves pg-boss can connect to DATABASE_URL and round-trip a job before any
 * real pipeline stage is wired to it.
 *
 *   node scripts/smoke-queue.mjs
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "")]),
);

if (!env.DATABASE_URL) {
  console.error("Missing DATABASE_URL in .env.local — get it from Supabase dashboard → Settings → Database → Connection string.");
  process.exit(1);
}

const QUEUE = "smoke.test";
const boss = new PgBoss(env.DATABASE_URL);
boss.on("error", (err) => console.error("pg-boss error:", err));

try {
  console.log("Starting pg-boss (creates its own schema/tables on first run)...");
  await boss.start();
  console.log("PASS  boss.start() connected");

  await boss.createQueue(QUEUE);
  console.log(`PASS  createQueue("${QUEUE}")`);

  const payload = { probe: randomUUID(), sentAt: new Date().toISOString() };
  const jobId = await boss.send(QUEUE, payload);
  if (!jobId) throw new Error("send() returned null — job was not created");
  console.log(`PASS  send() created job ${jobId}`);

  const received = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("worker did not receive the job within 15s")), 15000);
    boss.work(QUEUE, async ([job]) => {
      clearTimeout(timeout);
      resolve(job);
    }).catch(reject);
  });

  const matches = received.id === jobId && received.data.probe === payload.probe;
  console.log(matches
    ? "PASS  worker received the exact job that was sent"
    : `FAIL  worker received a different job (id ${received.id}, probe ${received.data?.probe})`);

  await boss.offWork(QUEUE);
  await boss.deleteQueue(QUEUE);
  console.log("PASS  cleaned up smoke.test queue");

  console.log("\nAll checks passed — pg-boss is connected and round-tripping jobs.");
  process.exit(matches ? 0 : 1);
} catch (err) {
  console.error("FAIL ", err.message);
  process.exit(1);
} finally {
  await boss.stop({ graceful: false }).catch(() => {});
}
