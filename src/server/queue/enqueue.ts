/**
 * Enqueue side of the queue, for the web process.
 *
 * The worker owns getBoss() in boss.ts and registers handlers; the web app only
 * ever sends. Kept separate so importing this from a route handler never pulls
 * in a job handler (and through it, the whole pipeline and its SDKs).
 */

import { PgBoss } from 'pg-boss';

let _boss: PgBoss | null = null;

async function sender(): Promise<PgBoss> {
  if (_boss) return _boss;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Missing DATABASE_URL');

  // supervise:false — this instance only sends. Leaving maintenance to the
  // worker avoids two processes competing to run the same upkeep.
  const boss = new PgBoss({ connectionString, supervise: false, schedule: false });
  boss.on('error', (err) => console.error('[pg-boss:send]', err));

  await boss.start();
  _boss = boss;
  return boss;
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
