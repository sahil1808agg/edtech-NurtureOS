import type { PgBoss } from 'pg-boss';
import { runCheckin } from '../../pipeline/checkin.js';
import { getCheckin, countPlanActivities, saveCheckinDecision } from '../../db/checkins.js';

export const QUEUE = 'checkin.process';

export async function createCheckinProcessQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE, {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 30,
  });
}

export interface CheckinProcessJobData {
  checkinId: string;
}

// Enqueued once a parent has actually responded (checkins.activities_done is
// set) — by whatever endpoint eventually handles the one-click email links.
// That endpoint doesn't exist yet; this job only covers what happens once a
// response row exists.
export async function registerCheckinProcessWorker(boss: PgBoss): Promise<void> {
  await boss.work<CheckinProcessJobData>(QUEUE, { localConcurrency: 4 }, async ([job]) => {
    const { checkinId } = job.data;
    const checkin = await getCheckin(checkinId);
    const totalActivities = await countPlanActivities(checkin.planId);

    const result = await runCheckin({
      activitiesDone: checkin.activitiesDone,
      totalActivities,
      note: checkin.note,
      concernRaised: checkin.concernRaised,
    });

    if (!result.ok) {
      if (result.error.code === 'PROVIDER_ERROR' && result.error.retryable) {
        throw new Error(`provider error ${result.error.status}, retrying`);
      }
      throw new Error(`checkin processing failed for ${checkinId}: ${JSON.stringify(result.error)}`);
    }

    await saveCheckinDecision(checkinId, result.value.decision);
  });
}
