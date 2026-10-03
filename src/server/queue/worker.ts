import '../../test/load-env.js';
import { initLogger } from 'braintrust';
import { getBoss } from './boss.js';
import { createReportExtractQueue, registerReportExtractWorker } from './jobs/report-extract.js';
import { createReportNormaliseQueue, registerReportNormaliseWorker } from './jobs/report-normalise.js';
import { createReportAnalyseQueue, registerReportAnalyseWorker } from './jobs/report-analyse.js';
import { createPlanGenerateQueue, registerPlanGenerateWorker } from './jobs/plan-generate.js';
import { createCheckinProcessQueue, registerCheckinProcessWorker } from './jobs/checkin-process.js';

// Braintrust tracing. The provider SDKs are patched by the braintrust import
// hook the "worker" script launches with; this only names the project the
// spans land in. load-env is imported first so .env.local has already put
// BRAINTRUST_API_KEY on process.env by the time this runs.
//
// No key means no tracing rather than a crash — the worker has to keep running
// for anyone who has not set one up.
if (process.env.BRAINTRUST_API_KEY) {
  // `||`, not `??`: a declared-but-blank BRAINTRUST_PROJECT= must fall through
  // to the default, the same rule the LLM client applies to its own env vars.
  initLogger({ projectName: process.env.BRAINTRUST_PROJECT || 'nurtureos' });
}

async function main() {
  const boss = await getBoss();

  await createReportExtractQueue(boss);
  await registerReportExtractWorker(boss);

  await createReportNormaliseQueue(boss);
  await registerReportNormaliseWorker(boss);

  await createReportAnalyseQueue(boss);
  await registerReportAnalyseWorker(boss);

  await createPlanGenerateQueue(boss);
  await registerPlanGenerateWorker(boss);

  await createCheckinProcessQueue(boss);
  await registerCheckinProcessWorker(boss);

  console.log('Worker running. Registered queues: report.extract, report.normalise, report.analyse, plan.generate, checkin.process');
}

main().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
