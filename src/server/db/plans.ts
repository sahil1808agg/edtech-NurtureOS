import { serviceClient } from '../../lib/db/clients.js';
import type { FamilyConstraints, Resource } from '../prompts/plan.js';
import type { PlanActivity } from '../pipeline/plan.js';

export interface ChildRow {
  id: string;
  familyId: string;
  dob: string;
  firstName: string;
  /** For the planning agent's find_nearby_resources tool (docs/specs/08-orchestrator-chat.md). Either may be unset. */
  city: string | null;
  pincode: string | null;
}

export async function getChild(childId: string): Promise<ChildRow> {
  const { data, error } = await serviceClient().from('children').select('id, family_id, dob, first_name, city, pincode').eq('id', childId).single();
  if (error || !data) throw new Error(`child ${childId} not found: ${error?.message ?? 'no row'}`);
  return { id: data.id, familyId: data.family_id, dob: data.dob, firstName: data.first_name, city: data.city ?? null, pincode: data.pincode ?? null };
}

export function ageMonthsFromDob(dob: string): number {
  const birth = new Date(dob);
  const now = new Date();
  return (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
}

// family_constraints has no hasDevice/languages columns yet — MVP default until
// that capture flow exists. weeklyMinutes/otherConstraints are real, from the DB.
export async function getFamilyConstraints(familyId: string): Promise<FamilyConstraints> {
  const { data } = await serviceClient()
    .from('family_constraints')
    .select('weekly_minutes, materials, interests')
    .eq('family_id', familyId)
    .maybeSingle();

  return {
    weeklyMinutes: data?.weekly_minutes ?? 60,
    hasDevice: true,
    languages: ['English'],
    otherConstraints: null,
  };
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
  declined: boolean;
}

export interface CurrentPlan {
  planId: string;
  cycleNo: number;
  activities: CurrentPlanActivity[];
}

/** The child's most recent non-rejected plan, for chat context (docs/specs/04-grounded-general-routing.md). */
export async function getCurrentPlan(childId: string): Promise<CurrentPlan | null> {
  const { data: plan } = await serviceClient()
    .from('plans')
    .select('id, cycle_no')
    .eq('child_id', childId)
    .neq('status', 'rejected')
    .order('cycle_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!plan) return null;

  const { data: activities, error } = await serviceClient()
    .from('plan_activities')
    .select('id, title, instructions, declined')
    .eq('plan_id', plan.id)
    .order('position');

  if (error) throw new Error(`fetching activities for plan ${plan.id}: ${error.message}`);

  return { planId: plan.id, cycleNo: plan.cycle_no, activities: activities ?? [] };
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
  cycleNo: number;
  topicContext: string | null;
  modelDeployment: string;
  promptVersion: string;
}

export async function createPlan(input: CreatePlanInput): Promise<string> {
  const { data, error } = await serviceClient()
    .from('plans')
    .insert({
      family_id: input.familyId,
      child_id: input.childId,
      cycle_no: input.cycleNo,
      topic_context: input.topicContext,
      model_deployment: input.modelDeployment,
      prompt_version: input.promptVersion,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`creating plan for child ${input.childId}: ${error?.message}`);
  return data.id;
}

// ---------- Editing a single activity (chat's edit_plan_activity tool) ----------
//
// No legacy equivalent exists yet — the legacy plan page only approves/rejects
// a plan as a whole (src/app/api/review/plan/[id]/decision/route.ts). This is
// new, not extracted. See docs/specs/03-direct-apply-tools.md.

export interface PlanActivityForEdit {
  id: string;
  planId: string;
  familyId: string;
  title: string;
  instructions: string;
  declined: boolean;
}

export async function getPlanActivityForEdit(activityId: string): Promise<PlanActivityForEdit | null> {
  const { data } = await serviceClient()
    .from('plan_activities')
    .select('id, plan_id, title, instructions, declined, plans(family_id)')
    .eq('id', activityId)
    .maybeSingle();

  if (!data) return null;
  const plan = Array.isArray(data.plans) ? data.plans[0] : data.plans;
  return {
    id: data.id,
    planId: data.plan_id,
    familyId: (plan as { family_id: string } | null)?.family_id ?? '',
    title: data.title,
    instructions: data.instructions,
    declined: data.declined,
  };
}

export interface UpdatePlanActivityInput {
  activityId: string;
  title?: string;
  instructions?: string;
  declined?: boolean;
}

export async function updatePlanActivity(input: UpdatePlanActivityInput): Promise<void> {
  const update: Record<string, unknown> = {};
  if (input.title !== undefined) update.title = input.title;
  if (input.instructions !== undefined) update.instructions = input.instructions;
  if (input.declined !== undefined) update.declined = input.declined;

  const { error } = await serviceClient().from('plan_activities').update(update).eq('id', input.activityId);
  if (error) throw new Error(`updating plan activity ${input.activityId}: ${error.message}`);
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
}

export async function savePlanActivities(planId: string, activities: PlanActivity[]): Promise<void> {
  const { error } = await serviceClient().from('plan_activities').insert(
    activities.map((a, i) => ({
      plan_id: planId,
      position: i + 1,
      kind: a.kind,
      title: a.title,
      instructions: a.instructions,
      addresses_finding_id: a.addressesFindingId,
      resource_id: a.resourceId,
    })),
  );

  if (error) throw new Error(`saving plan activities for plan ${planId}: ${error.message}`);
}
