import '../../test/load-env.js';
import { getBoss } from './boss.js';
import { createReportExtractQueue, registerReportExtractWorker } from './jobs/report-extract.js';
import { createReportNormaliseQueue, registerReportNormaliseWorker } from './jobs/report-normalise.js';
import { createReportAnalyseQueue, registerReportAnalyseWorker } from './jobs/report-analyse.js';
import { createPlanGenerateQueue, registerPlanGenerateWorker } from './jobs/plan-generate.js';
import { createCheckinProcessQueue, registerCheckinProcessWorker } from './jobs/checkin-process.js';
import { createDailyDigestQueue, registerDailyDigestWorker, QUEUE as DAILY_DIGEST_QUEUE } from './jobs/daily-digest.js';

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

  await createDailyDigestQueue(boss);
  await registerDailyDigestWorker(boss);
  // This worker's boss instance is the one maintenance-capable instance in
  // the app (see boss.ts vs. enqueue.ts, which explicitly disables
  // schedule/supervise) — scheduling the digest here, not from the web
  // process, keeps a single owner for all cron-shaped work.
  await boss.schedule(DAILY_DIGEST_QUEUE, '0 8 * * *', {}, { tz: 'Asia/Kolkata' });

  console.log('Worker running. Registered queues: report.extract, report.normalise, report.analyse, plan.generate, checkin.process, plan.daily-digest');
}

main().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
