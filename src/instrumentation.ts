/**
 * Braintrust tracing for the Next.js app. Next calls register() once per
 * runtime as the server starts.
 *
 * The worker is a separate process and does not go through this file — it
 * initialises tracing in src/server/queue/worker.ts and is launched with the
 * braintrust import hook (see the "worker" script in package.json).
 *
 * No-ops without BRAINTRUST_API_KEY, so a checkout with no key still runs.
 */
import { initLogger } from 'braintrust';

export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' && process.env.NEXT_RUNTIME !== 'edge') return;
  if (!process.env.BRAINTRUST_API_KEY) return;

  // `||`, not `??`: a declared-but-blank BRAINTRUST_PROJECT= must fall through
  // to the default. Next puts blank vars on process.env as "", which `??` keeps.
  initLogger({ projectName: process.env.BRAINTRUST_PROJECT || 'nurtureos' });
}
