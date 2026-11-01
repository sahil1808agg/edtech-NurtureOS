import type { PgBoss, Job } from 'pg-boss';
import { createScheduleForPlan } from '../../db/schedule.js';

export const QUEUE = 'plan.schedule';

// Queued by plan.generate once a plan is approved, so the parent sees the
// plan (and its chat summary) without waiting on this second model call.
// createScheduleForPlan replaces the plan's rows rather than appending, so a
// retry never leaves two schedules behind.
const QUEUE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 15,
  expireInSeconds: 300,
};

export async function createPlanScheduleQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE, QUEUE_OPTIONS);
  // See plan-generate.ts — createQueue alone won't update an existing queue.
  await boss.updateQueue(QUEUE, QUEUE_OPTIONS);
}

export interface PlanScheduleJobData {
  planId: string;
  /** The day the plan was approved — the schedule starts here even if this job runs after midnight. */
  startDate: string;
  requestId?: string;
}

export async function registerPlanScheduleWorker(boss: PgBoss): Promise<void> {
  await boss.work(QUEUE, { localConcurrency: 2 }, async ([job]: Job<PlanScheduleJobData>[]) => {
    const { planId, startDate, requestId } = job.data;
    const source = await createScheduleForPlan(planId, requestId, startDate);
    console.log(`[plan.schedule] plan ${planId} scheduled from ${startDate} (${source})`);
  });
}
