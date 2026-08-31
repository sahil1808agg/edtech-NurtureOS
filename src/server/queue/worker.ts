import '../../test/load-env.js';
import { getBoss } from './boss.js';
import { createReportExtractQueue, registerReportExtractWorker } from './jobs/report-extract.js';
import { createReportNormaliseQueue, registerReportNormaliseWorker } from './jobs/report-normalise.js';
import { createReportAnalyseQueue, registerReportAnalyseWorker } from './jobs/report-analyse.js';
import { createPlanGenerateQueue, registerPlanGenerateWorker } from './jobs/plan-generate.js';
import { createCheckinProcessQueue, registerCheckinProcessWorker } from './jobs/checkin-process.js';

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
