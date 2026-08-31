import { serviceClient } from '../../lib/db/clients.js';
import type { FamilyConstraints, Resource } from '../prompts/plan.js';
import type { PlanActivity } from '../pipeline/plan.js';

export interface ChildRow {
  id: string;
  familyId: string;
  dob: string;
}

export async function getChild(childId: string): Promise<ChildRow> {
  const { data, error } = await serviceClient().from('children').select('id, family_id, dob').eq('id', childId).single();
  if (error || !data) throw new Error(`child ${childId} not found: ${error?.message ?? 'no row'}`);
  return { id: data.id, familyId: data.family_id, dob: data.dob };
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

/** Findings from the child's most recent finding_set, excluding actively-contradicted claims. */
export async function getTargetFindings(childId: string): Promise<TargetFinding[]> {
  const { data: findingSet } = await serviceClient()
    .from('finding_sets')
    .select('id')
    .eq('child_id', childId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!findingSet) return [];

  const { data: findings, error } = await serviceClient()
    .from('findings')
    .select('id, statement')
    .eq('finding_set_id', findingSet.id)
    .neq('corroboration_status', 'conflicting')
    .order('position');

  if (error) throw new Error(`fetching findings for finding_set ${findingSet.id}: ${error.message}`);
  return (findings ?? []).map(f => ({ id: f.id, statement: f.statement }));
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
