import { PgBoss } from 'pg-boss';

let _boss: PgBoss | null = null;

/** Lazily-started singleton. Call once per process (worker or, later, the API server). */
export async function getBoss(): Promise<PgBoss> {
  if (_boss) return _boss;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Missing DATABASE_URL');

  const boss = new PgBoss(connectionString);
  boss.on('error', (err) => console.error('[pg-boss]', err));

  await boss.start();
  _boss = boss;
  return boss;
}
