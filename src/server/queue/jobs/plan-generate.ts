import type { PgBoss, JobWithMetadata } from 'pg-boss';
import { runPlan } from '../../pipeline/plan.js';
import { resolveLocalActivities } from '../../pipeline/resolve-local-activities.js';
import {
  getChild,
  ageMonthsFromDob,
  getFamilyConstraints,
  getTargetFindings,
  getResourceCandidates,
  getRemovedActivities,
  createPlan,
  savePlanActivities,
  approvePlanDirectly,
  setPlanError,
  hasPlanCreatedSince,
} from '../../db/plans.js';
import { getConversationByChild } from '../../db/conversations.js';
import { createScheduleForPlan } from '../../db/schedule.js';
import { appendMessage } from '../../db/messages.js';
import { buildPlanSummaryForChat } from '../../chat/summarize.js';

export const QUEUE = 'plan.generate';

// A plan call alone has been observed at 128–227s, so the old 120s limit
// expired attempts that were still running: pg-boss retried while the first
// attempt finished anyway, producing duplicate plans and chat messages.
const QUEUE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 15,
  expireInSeconds: 600,
};

export async function createPlanGenerateQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE, QUEUE_OPTIONS);
  // createQueue is a no-op for a queue that already exists, so options
  // changed here would never reach an existing database without this.
  await boss.updateQueue(QUEUE, QUEUE_OPTIONS);
}

export interface PlanGenerateJobData {
  childId: string;
  topicContext?: string | null;
  requestId?: string;
}

// Triggered per child, not per report — there's no review console / publish
// flow yet, so this reads findings from the child's most recent finding_set
// directly rather than waiting for a "published" one. priorFailures is every
// activity the parent has removed for this child (removed_activities,
// migration 0019), not check-in outcomes — nothing records those yet.
export async function registerPlanGenerateWorker(boss: PgBoss): Promise<void> {
  await boss.work(QUEUE, { localConcurrency: 2, includeMetadata: true }, async ([job]: JobWithMetadata<PlanGenerateJobData>[]) => {
    try {
      await generatePlan(job.data);
    } catch (err) {
      // Only the attempt pg-boss won't retry tells the parent — earlier ones
      // may still succeed, and telling them each time would post duplicates.
      if (job.retryCount >= job.retryLimit) await reportPlanFailure(job.data.childId, job.createdOn);
      throw err;
    }
  });
}

/**
 * Without this, a failed job (e.g. the model provider returning 402) was
 * invisible: the Today card had already said "updating the plan" and nothing
 * ever contradicted it. Records the failure where the child page reads it
 * (children.plan_error, cleared by the next approved plan) and says so in
 * chat. The parent's current plan is untouched by a failure, so that's the
 * reassurance to give — not the provider's error, which they can't act on.
 */
const PLAN_FAILURE_MESSAGE =
  'We couldn’t build an updated plan just now. Your current plan hasn’t changed — try again in a little while.';

async function reportPlanFailure(childId: string, requestedAt: Date): Promise<void> {
  try {
    // An earlier attempt of this same job (or an overlapping request) may
    // already have landed a plan — then this request was answered, and a
    // "couldn't build" message would contradict the plan on screen.
    if (await hasPlanCreatedSince(childId, requestedAt)) return;

    await setPlanError(childId, PLAN_FAILURE_MESSAGE);
    const conversation = await getConversationByChild(childId);
    if (conversation) {
      const child = await getChild(childId);
      await appendMessage({
        conversationId: conversation.id,
        familyId: child.familyId,
        role: 'assistant',
        content: PLAN_FAILURE_MESSAGE,
        status: 'complete',
      });
    }
  } catch (err) {
    // Reporting must never mask the job's own error.
    console.error(`[plan.generate] could not report failure for child ${childId}:`, err);
  }
}

async function generatePlan(data: PlanGenerateJobData): Promise<void> {
  const { childId, topicContext = null, requestId } = data;

  const child = await getChild(childId);
  const targetFindings = await getTargetFindings(childId);

  if (targetFindings.length === 0) {
    throw new Error(`no usable findings for child ${childId} — nothing to plan against`);
  }

  const constraints = await getFamilyConstraints(child.familyId);
  const resourceCandidates = await getResourceCandidates();
  const hasLocation = (child.lat != null && child.lng != null) || !!(child.city || child.pincode);
  const priorFailures = await getRemovedActivities(childId);

  const result = await runPlan({
    childAgeMonths: ageMonthsFromDob(child.dob),
    targetFindings,
    constraints,
    topicContext,
    resourceCandidates,
    priorFailures,
    hasLocation,
  }, child.familyId, requestId);

  if (!result.ok) {
    if (result.error.code === 'PROVIDER_ERROR' && result.error.retryable) {
      throw new Error(`provider error ${result.error.status}, retrying`);
    }
    throw new Error(`plan generation failed for child ${childId}: ${JSON.stringify(result.error)}`);
  }

  const activities = await resolveLocalActivities(result.value.activities, child);

  const { id: planId } = await createPlan({
    familyId: child.familyId,
    childId,
    topicContext,
    modelDeployment: result.meta.modelDeployment,
    promptVersion: result.meta.promptVersion,
  });

  await savePlanActivities(planId, activities);
  // Today's list comes from this schedule; written before approval so the
  // plan never appears without one.
  await createScheduleForPlan(planId, requestId);

  // No review gate: approves immediately, same as chat's regenerate_plan
  // (dispatch.ts) already does for the direct-apply path.
  await approvePlanDirectly(planId);

  // This job is only ever queued from the legacy RequestPlan.tsx flow —
  // chat's regenerate_plan tool runs inline, not through this queue (see
  // src/server/chat/dispatch.ts). Posts only if the child has ever opened
  // chat; does nothing otherwise. See docs/specs/05-pipeline-live-updates.md.
  const conversation = await getConversationByChild(childId);
  if (conversation) {
    await appendMessage({
      conversationId: conversation.id,
      familyId: child.familyId,
      role: 'assistant',
      content: buildPlanSummaryForChat(activities, new Map(resourceCandidates.map(r => [r.id, r.title]))),
      status: 'complete',
    });
  }
}
