import type { PgBoss } from 'pg-boss';
import { runAnalyse } from '../../pipeline/analyse.js';
import { runCorroborate } from '../../pipeline/corroborate.js';
import { citationGate } from '../../gates/citation.js';
import { sufficiencyGate, type SufficiencyThresholds, DEFAULT_SUFFICIENCY } from '../../gates/sufficiency.js';
import { getReport, updateReportStatus } from '../../db/reports.js';
import { getObservations, getNarratives, createFindingSet, saveFinding } from '../../db/findings.js';
import { enqueueForReview } from '../../db/review.js';

export const QUEUE = 'report.analyse';

export async function createReportAnalyseQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE, {
    retryLimit: 2,
    retryDelay: 15,
    expireInSeconds: 120,
  });
}

export interface ReportAnalyseJobData {
  reportId: string;
}

function sufficiencyThresholdsFromEnv(): SufficiencyThresholds {
  return {
    minObservations: Number(process.env.SUFFICIENCY_MIN_OBSERVATIONS) || DEFAULT_SUFFICIENCY.minObservations,
    minSolidRatio: Number(process.env.SUFFICIENCY_MIN_SOLID_RATIO) || DEFAULT_SUFFICIENCY.minSolidRatio,
    minNarrativeChars: Number(process.env.SUFFICIENCY_MIN_NARRATIVE_CHARS) || DEFAULT_SUFFICIENCY.minNarrativeChars,
  };
}

// Analyse, Corroborate and the deterministic gate are combined into one job.
// findings.corroboration_status is NOT NULL, so a finding cannot be written
// until it has been corroborated — the LLD's "claim.corroborate, per candidate,
// parallel" fan-out (with a completion counter enqueueing report.gate) would
// need a new counter column that doesn't exist yet. This does the same three
// steps in sequence within one job instead: simpler, correct, not parallel.
export async function registerReportAnalyseWorker(boss: PgBoss): Promise<void> {
  await boss.work<ReportAnalyseJobData>(QUEUE, { localConcurrency: 2 }, async ([job]) => {
    const { reportId } = job.data;
    const report = await getReport(reportId);
    const observations = await getObservations(reportId);
    const narratives = await getNarratives(reportId);
    const narrativeChars = narratives.reduce((sum, n) => sum + n.text.length, 0);

    const sufficiency = sufficiencyGate(observations, narrativeChars, sufficiencyThresholdsFromEnv());

    if (!sufficiency.pass) {
      const honestySetId = await createFindingSet({
        familyId: report.familyId,
        childId: report.childId,
        reportId,
        honestyPath: true,
        modelDeployment: 'none — deterministic honesty path',
        promptVersion: 'none',
      });
      // The honesty path is still parent-facing text, so it is reviewed too.
      await enqueueForReview('finding_set', honestySetId);
      await updateReportStatus(reportId, 'in_review');
      return;
    }

    const result = await runAnalyse({ childId: report.childId, reportId, observations });

    if (!result.ok) {
      if (result.error.code === 'PROVIDER_ERROR' && result.error.retryable) {
        throw new Error(`provider error ${result.error.status}, retrying`);
      }
      await updateReportStatus(reportId, 'failed', JSON.stringify(result.error));
      return;
    }

    await updateReportStatus(reportId, 'analysed');

    const validObservationIds = new Set(observations.map(o => o.id));
    const { kept } = citationGate(result.value.claims, validObservationIds);

    const findingSetId = await createFindingSet({
      familyId: report.familyId,
      childId: report.childId,
      reportId,
      honestyPath: result.value.insufficientEvidence || kept.length === 0,
      modelDeployment: result.meta.modelDeployment,
      promptVersion: result.meta.promptVersion,
    });

    for (const [index, claim] of kept.entries()) {
      const corroboration = await runCorroborate({
        claimStatement: claim.statement,
        narratives: narratives.map(n => ({ id: n.id, subject: n.subject, text: n.text })),
      });

      if (!corroboration.ok) {
        // A single claim failing to corroborate should not lose every other
        // claim in the set — drop just this one and continue.
        continue;
      }

      await saveFinding({
        findingSetId,
        familyId: report.familyId,
        position: index + 1,
        claim,
        corroboration: corroboration.value,
      });
    }

    // Gates passed, but nothing reaches a parent until a human approves it:
    // the set stays 'draft' and the report sits at 'in_review' until the
    // review console publishes it. REVIEW_REQUIRED is not read here — MVP has
    // no path that skips review at all.
    await enqueueForReview('finding_set', findingSetId);
    await updateReportStatus(reportId, 'in_review');
  });
}
