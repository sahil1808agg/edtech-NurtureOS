/**
 * Enqueue side of the queue, for the web process.
 *
 * The worker owns getBoss() in boss.ts and registers handlers; the web app only
 * ever sends. Kept separate so importing this from a route handler never pulls
 * in a job handler (and through it, the whole pipeline and its SDKs).
 */

import { PgBoss } from 'pg-boss';

// Held on globalThis, not in a module-scoped variable. Next's dev server
// re-evaluates modules on hot reload, and a fresh PgBoss each time opens a
// fresh pool while the old one keeps its connections — which exhausted the
// Supabase session pooler (max 15) and made enqueue fail with EMAXCONNSESSION.
const globalForBoss = globalThis as unknown as { _enqueueBoss?: Promise<PgBoss> };

function sender(): Promise<PgBoss> {
  if (globalForBoss._enqueueBoss) return globalForBoss._enqueueBoss;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Missing DATABASE_URL');

  globalForBoss._enqueueBoss = (async () => {
    // supervise/schedule off: this instance only sends, and leaving maintenance
    // to the worker avoids two processes competing to run the same upkeep.
    // max is small on purpose — sending is a brief write, and the pooler's
    // budget has to cover the worker too.
    const boss = new PgBoss({
      connectionString,
      max: 2,
      supervise: false,
      schedule: false,
      application_name: 'nurtureos-web',
    });
    boss.on('error', (err) => console.error('[pg-boss:send]', err));
    await boss.start();
    return boss;
  })();

  // Do not cache a failed start, or every later send inherits the failure.
  globalForBoss._enqueueBoss.catch(() => {
    globalForBoss._enqueueBoss = undefined;
  });

  return globalForBoss._enqueueBoss;
}

/**
 * `singletonKey` collapses duplicate work at the queue rather than in a
 * pre-check. Guarding by "does a row already exist" loses the race between
 * enqueue and the worker creating that row, so two quick clicks produce two
 * jobs; pg-boss refuses the second outright and returns null.
 */
export async function enqueue(
  queue: string,
  data: object,
  options?: { singletonKey?: string },
): Promise<string | null> {
  return (await sender()).send(queue, data, options ?? {});
}
