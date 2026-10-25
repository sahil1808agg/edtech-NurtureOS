import { serviceClient } from '../../lib/db/clients.js';
import type { FamilyConstraints, Resource } from '../prompts/plan.js';
import type { PlanActivity } from '../pipeline/plan.js';

export interface ChildRow {
  id: string;
  familyId: string;
  dob: string;
  firstName: string;
  /**
   * For the planning agent's find_nearby_resources tool
   * (docs/specs/08-orchestrator-chat.md). lat/lng come from the autocomplete
   * pin and are preferred; city/pincode are the legacy text fallback. All
   * may be unset.
   */
  lat: number | null;
  lng: number | null;
  city: string | null;
  pincode: string | null;
}

export async function getChild(childId: string): Promise<ChildRow> {
  const { data, error } = await serviceClient().from('children').select('id, family_id, dob, first_name, lat, lng, city, pincode').eq('id', childId).single();
  if (error || !data) throw new Error(`child ${childId} not found: ${error?.message ?? 'no row'}`);
  return {
    id: data.id,
    familyId: data.family_id,
    dob: data.dob,
    firstName: data.first_name,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    city: data.city ?? null,
    pincode: data.pincode ?? null,
  };
}

export function ageMonthsFromDob(dob: string): number {
  const birth = new Date(dob);
  const now = new Date();
  return (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
}

// family_constraints has no hasDevice/languages columns yet — MVP default until
// that capture flow exists. weeklyMinutes is real, from the DB. interests is
// how a preference the parent states in chat (via update_family_interests,
// see dispatch.ts) survives into every future plan regeneration, not just
// the one right after they said it — folded into otherConstraints here so
// the plan prompt sees it the same way it'd see any other family constraint.
export async function getFamilyConstraints(familyId: string): Promise<FamilyConstraints> {
  const { data } = await serviceClient()
    .from('family_constraints')
    .select('weekly_minutes, materials, interests')
    .eq('family_id', familyId)
    .maybeSingle();

  const interests: string[] = Array.isArray(data?.interests) ? data.interests : [];
  const materials: string[] = Array.isArray(data?.materials) ? data.materials : [];
  const otherConstraints = [
    interests.length ? `The family has said they want: ${interests.join(', ')}.` : null,
    materials.length ? `Materials on hand: ${materials.join(', ')}.` : null,
  ]
    .filter(Boolean)
    .join(' ') || null;

  return {
    weeklyMinutes: data?.weekly_minutes ?? 60,
    hasDevice: true,
    languages: ['English'],
    otherConstraints,
  };
}

/**
 * Replaces the family's standing interests outright, so getFamilyConstraints()
 * surfaces the result on every future plan regeneration — not just the one
 * immediately following. Takes the FULL consolidated list rather than
 * appending one — merging an overlapping new preference into the existing
 * ones (so "swimming in the society" + "swimming, tennis, gymnastics"
 * becomes one clean entry instead of two near-duplicates) is a language
 * task, so it's the model's job: it already sees the current list via
 * STANDING PREFERENCES in its own prompt before deciding what to send here.
 * This layer only guards against exact repeats within the list itself. See
 * dispatch.ts's update_family_interests tool.
 */
export async function setFamilyInterests(familyId: string, interests: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const cleaned = interests
    .map(i => i.trim())
    .filter(i => {
      if (!i || seen.has(i.toLowerCase())) return false;
      seen.add(i.toLowerCase());
      return true;
    });

  const { error } = await serviceClient()
    .from('family_constraints')
    .update({ interests: cleaned, updated_at: new Date().toISOString() })
    .eq('family_id', familyId);
  if (error) throw new Error(`saving family interests for ${familyId}: ${error.message}`);
  return cleaned;
}

export interface TargetFinding {
  id: string;
  statement: string;
}

/**
 * Findings from the child's most recent PUBLISHED finding set, excluding
 * actively-contradicted claims.
 *
 * Published, not merely most recent: a draft has not been through review, and a
 * superseded one was replaced. Planning against either would justify an
 * activity with a claim the parent has never been shown and no reviewer ever
 * approved — and would leave "why this" pointing at a finding that does not
 * appear anywhere in the app.
 */
export async function getTargetFindings(childId: string): Promise<TargetFinding[]> {
  const { data: findingSet } = await serviceClient()
    .from('finding_sets')
    .select('id')
    .eq('child_id', childId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!findingSet) return [];

  const { data: findings, error } = await serviceClient()
    .from('findings')
    .select('id, statement')
    .eq('finding_set_id', findingSet.id)
    .eq('excluded', false)
    .neq('corroboration_status', 'conflicting')
    .order('position');

  if (error) throw new Error(`fetching findings for finding_set ${findingSet.id}: ${error.message}`);

  // A finding the parent has told us is wrong must not drive an activity. They
  // know the child; planning against something they have explicitly rejected
  // would be both useless and a good way to lose their trust in the rest.
  const { data: rejected } = await serviceClient()
    .from('parent_finding_responses')
    .select('finding_id')
    .eq('response', 'doesnt_match')
    .in('finding_id', (findings ?? []).map(f => f.id));

  const rejectedIds = new Set((rejected ?? []).map(r => r.finding_id));

  return (findings ?? [])
    .filter(f => !rejectedIds.has(f.id))
    .map(f => ({ id: f.id, statement: f.statement }));
}

export interface CurrentPlanActivity {
  id: string;
  title: string;
  instructions: string;
  steps: string[];
  materials: string[];
  estimatedMinutes: number | null;
  kind: string;
  declined: boolean;
  completed: boolean;
  snoozedUntil: string | null;
}

export interface CurrentPlan {
  planId: string;
  cycleNo: number;
  status: string;
  activities: CurrentPlanActivity[];
}

/**
 * The child's most recent non-rejected plan — used for chat context
 * (docs/specs/04-grounded-general-routing.md) and, since it already carries
 * everything the Today card needs, by src/app/children/[id]/page.tsx too.
 */
export async function getCurrentPlan(childId: string): Promise<CurrentPlan | null> {
  const { data: plan } = await serviceClient()
    .from('plans')
    .select('id, cycle_no, status')
    .eq('child_id', childId)
    .neq('status', 'rejected')
    .order('cycle_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!plan) return null;

  const { data: activities, error } = await serviceClient()
    .from('plan_activities')
    .select('id, title, instructions, steps, materials, estimated_minutes, kind, declined, completed, snoozed_until')
    .eq('plan_id', plan.id)
    .order('position');

  if (error) throw new Error(`fetching activities for plan ${plan.id}: ${error.message}`);

  return {
    planId: plan.id,
    cycleNo: plan.cycle_no,
    status: plan.status,
    activities: (activities ?? []).map(a => ({
      id: a.id,
      title: a.title,
      instructions: a.instructions,
      steps: a.steps,
      materials: a.materials,
      estimatedMinutes: a.estimated_minutes,
      kind: a.kind,
      declined: a.declined,
      completed: a.completed,
      snoozedUntil: a.snoozed_until,
    })),
  };
}

/**
 * Starts plan.generate for a child, unless one is already draft/in_review —
 * one plan in flight per child (the singletonKey only collapses jobs still
 * queued, not a plan already produced and sitting unreviewed). Shared by
 * the finding-set publish path (report-analyse.ts) and the legacy manual
 * decision route (api/review/[id]/decision), which both start a plan the
 * moment findings become usable.
 *
 * `send` is injected rather than imported here: the web process and the
 * worker process each hold their own pg-boss client/pool (see
 * queue/enqueue.ts's note on the connection pooler), and this function is
 * called from both — it must never open a pool of its own.
 */
export async function maybeQueuePlanGeneration(
  childId: string,
  requestId: string | undefined,
  send: (queue: string, data: object, options?: { singletonKey?: string }) => Promise<string | null>,
): Promise<boolean> {
  const { data: pendingPlan } = await serviceClient()
    .from('plans')
    .select('id')
    .eq('child_id', childId)
    .in('status', ['draft', 'in_review'])
    .maybeSingle();

  if (pendingPlan) return false;

  await send('plan.generate', { childId, requestId }, { singletonKey: `plan:${childId}` });
  return true;
}

/** Empty until the resource library (PRD: "the moat") is actually curated. */
export async function getResourceCandidates(): Promise<Resource[]> {
  const { data } = await serviceClient()
    .from('resources')
    .select('id, title, skill_codes, age_min, age_max')
    .eq('is_active', true);

  return (data ?? []).map(r => ({
    id: r.id,
    title: r.title,
    skillIds: r.skill_codes,
    ageMinMonths: r.age_min,
    ageMaxMonths: r.age_max,
  }));
}

export async function getNextCycleNo(childId: string): Promise<number> {
  const { data } = await serviceClient()
    .from('plans')
    .select('cycle_no')
    .eq('child_id', childId)
    .order('cycle_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.cycle_no ?? 0) + 1;
}

export interface CreatePlanInput {
  familyId: string;
  childId: string;
  topicContext: string | null;
  modelDeployment: string;
  promptVersion: string;
}

const MAX_CREATE_PLAN_ATTEMPTS = 5;

/**
 * getNextCycleNo() + insert used to be two separate steps a caller did
 * itself, which raced: two regenerations for the same child (e.g. a chat
 * "regenerate_plan" overlapping a queued plan.generate job) could both read
 * the same "next" cycle_no and one would fail outright on
 * plans_child_id_cycle_no_key, discarding a fully-generated plan — observed
 * in practice as a 502 with nothing returned to the parent. Cycle number
 * selection now happens inside the retry loop, re-read fresh on every
 * attempt, so a losing race just costs one extra round trip instead of
 * failing the whole turn.
 */
export async function createPlan(input: CreatePlanInput): Promise<{ id: string; cycleNo: number }> {
  for (let attempt = 1; attempt <= MAX_CREATE_PLAN_ATTEMPTS; attempt++) {
    const cycleNo = await getNextCycleNo(input.childId);
    const { data, error } = await serviceClient()
      .from('plans')
      .insert({
        family_id: input.familyId,
        child_id: input.childId,
        cycle_no: cycleNo,
        topic_context: input.topicContext,
        model_deployment: input.modelDeployment,
        prompt_version: input.promptVersion,
      })
      .select('id')
      .single();

    if (!error && data) return { id: data.id, cycleNo };

    // 23505 = unique_violation (plans_child_id_cycle_no_key) — another
    // concurrent regeneration won this cycle_no first. Retry with a fresh
    // read rather than failing a plan the model already fully generated.
    if (error?.code !== '23505' || attempt === MAX_CREATE_PLAN_ATTEMPTS) {
      throw new Error(`creating plan for child ${input.childId}: ${error?.message ?? 'no row returned'}`);
    }
  }
  throw new Error(`creating plan for child ${input.childId}: unreachable`);
}

// ---------- Editing a single activity (chat's edit_plan_activity tool, and
// the Today card / plan page's own PATCH route at
// src/app/api/plan-activities/[id]/route.ts) ----------
//
// See docs/specs/03-direct-apply-tools.md.

export interface PlanActivityForEdit {
  id: string;
  planId: string;
  familyId: string;
  childId: string;
  title: string;
  instructions: string;
  declined: boolean;
  completed: boolean;
}

export async function getPlanActivityForEdit(activityId: string): Promise<PlanActivityForEdit | null> {
  const { data } = await serviceClient()
    .from('plan_activities')
    .select('id, plan_id, title, instructions, declined, completed, plans(family_id, child_id)')
    .eq('id', activityId)
    .maybeSingle();

  if (!data) return null;
  const plan = Array.isArray(data.plans) ? data.plans[0] : data.plans;
  return {
    id: data.id,
    planId: data.plan_id,
    familyId: (plan as { family_id: string; child_id: string } | null)?.family_id ?? '',
    childId: (plan as { family_id: string; child_id: string } | null)?.child_id ?? '',
    title: data.title,
    instructions: data.instructions,
    declined: data.declined,
    completed: data.completed,
  };
}

export interface UpdatePlanActivityInput {
  activityId: string;
  title?: string;
  instructions?: string;
  declined?: boolean;
  completed?: boolean;
  /** YYYY-MM-DD, or null to clear a prior snooze. Undefined leaves it untouched. */
  snoozedUntil?: string | null;
}

export async function updatePlanActivity(input: UpdatePlanActivityInput): Promise<void> {
  const update: Record<string, unknown> = {};
  if (input.title !== undefined) update.title = input.title;
  if (input.instructions !== undefined) update.instructions = input.instructions;
  if (input.completed !== undefined) {
    update.completed = input.completed;
    update.completed_at = input.completed ? new Date().toISOString() : null;
  }
  if (input.snoozedUntil !== undefined) update.snoozed_until = input.snoozedUntil;
  if (input.declined !== undefined) update.declined = input.declined;

  const { error } = await serviceClient().from('plan_activities').update(update).eq('id', input.activityId);
  if (error) throw new Error(`updating plan activity ${input.activityId}: ${error.message}`);

  if (input.declined !== undefined) await syncRemovedActivity(input.activityId, input.declined);
}

/**
 * Mirrors a decline into removed_activities (migration 0019), the per-child
 * record that outlives the plan — plan_activities.declined alone is lost the
 * moment the plan is superseded and deleted. Lives here rather than in each
 * caller so the Today card, chat's edit_plan_activity and the email action
 * all record removals the same way. Un-declining forgets it again.
 */
async function syncRemovedActivity(activityId: string, declined: boolean): Promise<void> {
  const admin = serviceClient();
  const { data: activity, error: readError } = await admin
    .from('plan_activities')
    .select('title, instructions, plans(family_id, child_id)')
    .eq('id', activityId)
    .maybeSingle();
  if (readError) throw new Error(`reading plan activity ${activityId}: ${readError.message}`);
  const plan = activity?.plans as { family_id: string; child_id: string } | null | undefined;
  if (!activity || !plan) return;

  const { error } = declined
    ? await admin.from('removed_activities').upsert(
        { family_id: plan.family_id, child_id: plan.child_id, title: activity.title, instructions: activity.instructions },
        { onConflict: 'child_id,title', ignoreDuplicates: true },
      )
    : await admin.from('removed_activities').delete().eq('child_id', plan.child_id).eq('title', activity.title);
  if (error) throw new Error(`recording removal of activity ${activityId}: ${error.message}`);
}

/**
 * Feeds runPlan()'s priorFailures — every activity the parent has ever
 * removed for this child, across all past plans, so a regeneration never
 * hands one back (or a lookalike of it; see prompts/plan.ts).
 */
export async function getRemovedActivities(childId: string): Promise<Array<{ title: string; reason: string; instructions: string }>> {
  const { data, error } = await serviceClient()
    .from('removed_activities')
    .select('title, instructions')
    .eq('child_id', childId)
    .order('created_at');

  if (error) throw new Error(`fetching removed activities for child ${childId}: ${error.message}`);
  return (data ?? []).map(a => ({ title: a.title, instructions: a.instructions, reason: 'the parent removed this activity' }));
}

/** Whether any non-rejected plan for the child was created at or after `since`. */
export async function hasPlanCreatedSince(childId: string, since: Date): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from('plans')
    .select('id')
    .eq('child_id', childId)
    .neq('status', 'rejected')
    .gte('created_at', since.toISOString())
    .limit(1);
  if (error) throw new Error(`checking for recent plans for child ${childId}: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Set when plan.generate gives up on a child, so the child page and chat can
 * say so instead of promising a plan that isn't coming. Cleared by
 * finalizeApprovedPlan() once any new plan lands.
 */
export async function setPlanError(childId: string, message: string): Promise<void> {
  const { error } = await serviceClient()
    .from('children')
    .update({ plan_error: message, plan_error_at: new Date().toISOString() })
    .eq('id', childId);
  if (error) throw new Error(`recording plan error for child ${childId}: ${error.message}`);
}

/**
 * Sets a plan straight to 'approved', skipping review_queue — used only by
 * chat's regenerate_plan tool (src/server/chat/dispatch.ts), which is a
 * direct-apply write with no draft period by design. The legacy
 * plan-generate worker never calls this; it leaves new plans at 'draft' via
 * enqueueForReview. See docs/engineering/engineering-doc.md §4/§7.
 */
export async function approvePlanDirectly(planId: string): Promise<void> {
  const { error } = await serviceClient().from('plans').update({ status: 'approved' }).eq('id', planId);
  if (error) throw new Error(`approving plan ${planId}: ${error.message}`);
  await finalizeApprovedPlan(planId);
}

/**
 * Everything that follows a plan becoming the child's plan: any earlier
 * plan.generate failure is no longer news (children.plan_error cleared), and
 * a child has one plan — once a new one is approved, every earlier cycle is
 * deleted (activities and check-ins cascade; review_queue has no FK, so its
 * rows go explicitly). Runs only after approval so a failed regeneration
 * never leaves the child with no plan at all.
 *
 * Only strictly lower cycle numbers are removed, and never a draft/in_review
 * plan — if two regenerations overlap and the older one is approved last,
 * it must not delete the newer one. Worst case that leaves one extra row,
 * which the next approval clears.
 */
export async function finalizeApprovedPlan(planId: string): Promise<void> {
  const admin = serviceClient();
  const { data: plan, error: readError } = await admin
    .from('plans')
    .select('child_id, cycle_no')
    .eq('id', planId)
    .maybeSingle();
  if (readError) throw new Error(`reading plan ${planId}: ${readError.message}`);
  if (!plan) return;

  const { error: clearError } = await admin
    .from('children')
    .update({ plan_error: null, plan_error_at: null })
    .eq('id', plan.child_id);
  if (clearError) throw new Error(`clearing plan error for child ${plan.child_id}: ${clearError.message}`);

  const { data: superseded, error: listError } = await admin
    .from('plans')
    .select('id')
    .eq('child_id', plan.child_id)
    .lt('cycle_no', plan.cycle_no)
    .not('status', 'in', '(draft,in_review)');
  if (listError) throw new Error(`listing plans superseded by ${planId}: ${listError.message}`);

  const ids = (superseded ?? []).map(p => p.id);
  if (ids.length === 0) return;

  const { error: queueError } = await admin
    .from('review_queue')
    .delete()
    .eq('artifact_type', 'plan')
    .in('artifact_id', ids);
  if (queueError) throw new Error(`deleting review rows for superseded plans: ${queueError.message}`);

  const { error: deleteError } = await admin.from('plans').delete().in('id', ids);
  if (deleteError) throw new Error(`deleting plans superseded by ${planId}: ${deleteError.message}`);
}

export async function savePlanActivities(planId: string, activities: PlanActivity[]): Promise<void> {
  const { error } = await serviceClient().from('plan_activities').insert(
    activities.map((a, i) => ({
      plan_id: planId,
      position: i + 1,
      kind: a.kind,
      title: a.title,
      instructions: a.instructions,
      steps: a.steps,
      materials: a.materials,
      estimated_minutes: a.estimatedMinutes,
      addresses_finding_id: a.addressesFindingId,
      resource_id: a.resourceId,
    })),
  );

  if (error) throw new Error(`saving plan activities for plan ${planId}: ${error.message}`);
}
