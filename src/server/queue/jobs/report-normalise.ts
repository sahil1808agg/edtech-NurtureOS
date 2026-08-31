import type { PgBoss } from 'pg-boss';
import { runNormalise } from '../../pipeline/normalise.js';
import { normaliseValue } from '../../../lib/ontology/scales.js';
import { getReport, updateReportStatus } from '../../db/reports.js';
import { getBoss } from '../boss.js';
import { QUEUE as ANALYSE_QUEUE } from './report-analyse.js';
import {
  getExtractionOutput,
  getScaleBoard,
  getSkillCandidates,
  getSkillIdsByCode,
  saveObservations,
  type ObservationInsert,
} from '../../db/observations.js';

export const QUEUE = 'report.normalise';

export async function createReportNormaliseQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE, {
    retryLimit: 2,
    retryDelay: 10,
    expireInSeconds: 90,
  });
}

export interface ReportNormaliseJobData {
  reportId: string;
}

export async function registerReportNormaliseWorker(boss: PgBoss): Promise<void> {
  await boss.work<ReportNormaliseJobData>(QUEUE, { localConcurrency: 2 }, async ([job]) => {
    const { reportId } = job.data;
    const report = await getReport(reportId);
    const extraction = await getExtractionOutput(reportId);

    const scaleId = extraction.scaleHint;
    if (!scaleId) {
      await updateReportStatus(reportId, 'failed', 'UNKNOWN_SCALE: extraction produced no scaleHint');
      return;
    }

    const board = await getScaleBoard(scaleId);
    if (!board) {
      await updateReportStatus(reportId, 'failed', `UNKNOWN_SCALE: no scales row for "${scaleId}"`);
      return;
    }

    const candidates = await getSkillCandidates(board);
    const rawLabels = [...new Set(extraction.cells.map(c => c.rawLabel))];

    const result = await runNormalise({ board, programme: null, scaleId, candidates, rawLabels });

    if (!result.ok) {
      if (result.error.code === 'PROVIDER_ERROR' && result.error.retryable) {
        throw new Error(`provider error ${result.error.status}, retrying`);
      }
      await updateReportStatus(reportId, 'failed', JSON.stringify(result.error));
      return;
    }

    const skillIdByCode = await getSkillIdsByCode(
      result.value.observations.map(o => o.skillId).filter((s): s is string => s !== null),
    );
    const skillIdByLabel = new Map(
      result.value.observations.map(o => [o.rawLabel, { skillId: o.skillId, confidence: o.confidence }]),
    );

    // Normalise (the LLM call) only maps rawLabel -> skillId. The actual raw ->
    // 0..1 conversion is deterministic (normaliseValue), not a model judgment —
    // this is where per-term ObservationRow rows actually get assembled.
    const observations: ObservationInsert[] = [];
    for (const cell of extraction.cells) {
      const mapping = skillIdByLabel.get(cell.rawLabel);
      const skillUuid = mapping?.skillId ? skillIdByCode.get(mapping.skillId) ?? null : null;

      for (const v of cell.values) {
        const { normalised, isAmbiguous } = normaliseValue(scaleId, v.rawValue);
        observations.push({
          id: crypto.randomUUID(),
          familyId: report.familyId,
          childId: report.childId,
          reportId,
          skillId: skillUuid,
          rawLabel: cell.rawLabel,
          scaleId,
          termIndex: v.termIndex,
          rawValue: v.rawValue,
          normalised,
          isAmbiguous,
          confidence: mapping?.confidence ?? cell.confidence,
          sourceRef: cell.sourceRef,
        });
      }
    }

    await saveObservations(reportId, observations);
    await updateReportStatus(reportId, 'normalised');

    // Analyse is the last automatic stage: it ends at 'in_review', where a
    // human takes over. Nothing downstream of that is ever auto-enqueued.
    await (await getBoss()).send(ANALYSE_QUEUE, { reportId });
  });
}
