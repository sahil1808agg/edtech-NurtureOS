import { PgBoss } from 'pg-boss';

let _boss: PgBoss | null = null;

/** Lazily-started singleton. Call once per process (worker or, later, the API server). */
export async function getBoss(): Promise<PgBoss> {
  if (_boss) return _boss;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Missing DATABASE_URL');

  // The Supabase session pooler caps the project at 15 client connections,
  // shared with the web app's sender and any script. Session mode holds a
  // connection for the life of the client, so a killed process keeps its slot
  // until the socket times out — during development, with frequent restarts,
  // that accumulates and surfaces far away as EMAXCONNSESSION on an unrelated
  // request. Three is enough for a queue whose busiest stage runs two at a time.
  const boss = new PgBoss({
    connectionString,
    max: 3,
    application_name: 'nurtureos-worker',
  });
  boss.on('error', (err) => console.error('[pg-boss]', err));

  await boss.start();
  _boss = boss;
  return boss;
}
