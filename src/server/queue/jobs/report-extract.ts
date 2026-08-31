import type { PgBoss } from 'pg-boss';
import { runExtract } from '../../pipeline/extract.js';
import { getReport, updateReportStatus } from '../../db/reports.js';
import { downloadReportFile } from '../../storage/reports.js';
import { saveExtraction } from '../../db/extractions.js';
import { getBoss } from '../boss.js';
import { QUEUE as NORMALISE_QUEUE } from './report-normalise.js';

export const QUEUE = 'report.extract';

// Matches docs/engineering/low-level-design.md §3 Jobs: retries 3, 10s exponential
// backoff, concurrency 2, timeout 300s (bumped from the old per-page 180s now that
// one call covers the whole multi-page document).
export async function createReportExtractQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE, {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
  });
}

export interface ReportExtractJobData {
  reportId: string;
}

export async function registerReportExtractWorker(boss: PgBoss): Promise<void> {
  await boss.work<ReportExtractJobData>(
    QUEUE,
    { localConcurrency: 2 },
    async ([job]) => {
      const { reportId } = job.data;
      const report = await getReport(reportId);

      const pdfBuffer = await downloadReportFile(report.storagePath);
      const result = await runExtract({ reportId, pdfBuffer });

      if (!result.ok) {
        // Retry rules per LLD §3: PROVIDER_ERROR retries only when retryable;
        // everything else (LOW_CONFIDENCE, SEN_DETECTED, non-retryable
        // PROVIDER_ERROR, SCHEMA_INVALID) is terminal here rather than retried —
        // SCHEMA_INVALID's documented "retry once with the validation error
        // appended to the prompt" is not yet implemented, so it fails straight
        // to `failed` rather than getting that one enriched retry.
        if (result.error.code === 'PROVIDER_ERROR' && result.error.retryable) {
          throw new Error(`provider error ${result.error.status}, retrying`);
        }

        await updateReportStatus(reportId, 'failed', JSON.stringify(result.error));
        return;
      }

      await saveExtraction(reportId, report.familyId, result.value, result.meta);
      await updateReportStatus(reportId, 'extracted');

      // Advance the pipeline. Enqueued after the write commits, so a normalise
      // that starts immediately always sees this extraction.
      await (await getBoss()).send(NORMALISE_QUEUE, { reportId });
    },
  );
}
