/**
 * Populates process.env from .env.local before anything else loads.
 *
 * Every .eval.ts must import this FIRST. The Supabase clients in
 * src/lib/db/clients.ts and the provider clients in src/server/llm/providers/
 * all read process.env at construction time, so an import ordered after them
 * is too late. This is the same ordering src/server/queue/worker.ts:1 relies on.
 */
import '../../src/test/load-env.js';
