import type { PgBoss } from 'pg-boss';
import { runPlan } from '../../pipeline/plan.js';
import {
  getChild,
  ageMonthsFromDob,
  getFamilyConstraints,
  getTargetFindings,
  getResourceCandidates,
  getNextCycleNo,
  createPlan,
  savePlanActivities,
} from '../../db/plans.js';
import { enqueueForReview } from '../../db/review.js';

export const QUEUE = 'plan.generate';

export async function createPlanGenerateQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE, {
    retryLimit: 2,
    retryDelay: 15,
    expireInSeconds: 120,
  });
}

export interface PlanGenerateJobData {
  childId: string;
  topicContext?: string | null;
}

// Triggered per child, not per report — there's no review console / publish
// flow yet, so this reads findings from the child's most recent finding_set
// directly rather than waiting for a "published" one. priorFailures is always
// [] here since nothing yet records check-in outcomes back onto plan_activities.
export async function registerPlanGenerateWorker(boss: PgBoss): Promise<void> {
  await boss.work<PlanGenerateJobData>(QUEUE, { localConcurrency: 2 }, async ([job]) => {
    const { childId, topicContext = null } = job.data;

    const child = await getChild(childId);
    const targetFindings = await getTargetFindings(childId);

    if (targetFindings.length === 0) {
      throw new Error(`no usable findings for child ${childId} — nothing to plan against`);
    }

    const constraints = await getFamilyConstraints(child.familyId);
    const resourceCandidates = await getResourceCandidates();
    const cycleNo = await getNextCycleNo(childId);

    const result = await runPlan({
      childAgeMonths: ageMonthsFromDob(child.dob),
      targetFindings,
      constraints,
      topicContext,
      resourceCandidates,
      priorFailures: [],
    });

    if (!result.ok) {
      if (result.error.code === 'PROVIDER_ERROR' && result.error.retryable) {
        throw new Error(`provider error ${result.error.status}, retrying`);
      }
      throw new Error(`plan generation failed for child ${childId}: ${JSON.stringify(result.error)}`);
    }

    const planId = await createPlan({
      familyId: child.familyId,
      childId,
      cycleNo,
      topicContext,
      modelDeployment: result.meta.modelDeployment,
      promptVersion: result.meta.promptVersion,
    });

    await savePlanActivities(planId, result.value.activities);

    // A plan is parent-facing text naming a child, so it goes through the same
    // human gate as findings. It stays 'draft' until a reviewer approves it.
    await enqueueForReview('plan', planId);
  });
}
