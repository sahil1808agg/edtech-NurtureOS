import { serviceClient } from '../../lib/db/clients.js';
import {
  TOOL_SCHEMAS,
  type ToolName,
  EditFindingStatementArgs,
  ExcludeFindingArgs,
  RestoreFindingArgs,
  EditPlanActivityArgs,
  RequestReportReanalysisArgs,
  FindNearbyResourcesArgs,
} from './tools.js';
import { getFindingForEdit, updateFinding } from '../db/findings.js';
import {
  getPlanActivityForEdit,
  updatePlanActivity,
  getChild,
  ageMonthsFromDob,
  getTargetFindings,
  getFamilyConstraints,
  getResourceCandidates,
  getNextCycleNo,
  createPlan,
  savePlanActivities,
  approvePlanDirectly,
} from '../db/plans.js';
import { runPlan } from '../pipeline/plan.js';
import { enqueue } from '../queue/enqueue.js';
import { searchNearbyPlaces } from '../places/google-places.js';

/**
 * Executes one tool call an agent made, auditing it, and never trusting the
 * model's arguments without re-validating and re-checking ownership. Called
 * both from each agent's own tool loop (src/server/chat/orchestrator-dispatch.ts)
 * and, for request_report_reanalysis, directly by the deterministic
 * "not there yet" check (src/server/chat/report-status.ts). See
 * docs/engineering/engineering-doc.md §3/§7, docs/specs/03-direct-apply-tools.md
 * and docs/specs/08-orchestrator-chat.md.
 */

export interface ToolDispatchContext {
  familyId: string;
  childId: string;
  conversationId: string;
  messageId: string;
  actorProfileId: string;
  /** Which agent made this call — prefixes the audit_log action, e.g. "report_agent.edit_finding_statement". */
  agentName: 'report_agent' | 'planning_agent';
}

export interface ToolDispatchResult {
  ok: boolean;
  /** Short human-readable description, relayed to the model so it can describe the change in its reply. */
  summary: string;
  before?: unknown;
  after?: unknown;
  error?: { code: string; message: string };
}

async function writeAudit(ctx: ToolDispatchContext, action: ToolName, entity: string, entityId: string | null, before: unknown, after: unknown) {
  await serviceClient().from('audit_log').insert({
    actor: ctx.actorProfileId,
    action: `${ctx.agentName}.${action}`,
    entity,
    entity_id: entityId,
    payload: { before, after, conversationId: ctx.conversationId, messageId: ctx.messageId },
  });
}

export async function dispatchTool(name: string, rawArgs: unknown, ctx: ToolDispatchContext): Promise<ToolDispatchResult> {
  if (!(name in TOOL_SCHEMAS)) {
    return { ok: false, summary: '', error: { code: 'UNKNOWN_TOOL', message: `no such tool: ${name}` } };
  }

  const parsed = TOOL_SCHEMAS[name as ToolName].safeParse(rawArgs);
  if (!parsed.success) {
    return { ok: false, summary: '', error: { code: 'INVALID_ARGS', message: parsed.error.message } };
  }

  switch (name as ToolName) {
    case 'edit_finding_statement':
      return editFindingStatement(parsed.data as ReturnType<(typeof EditFindingStatementArgs)['parse']>, ctx);
    case 'exclude_finding':
      return setFindingExcluded(parsed.data as ReturnType<(typeof ExcludeFindingArgs)['parse']>, true, ctx);
    case 'restore_finding':
      return setFindingExcluded(parsed.data as ReturnType<(typeof RestoreFindingArgs)['parse']>, false, ctx);
    case 'edit_plan_activity':
      return editPlanActivity(parsed.data as ReturnType<(typeof EditPlanActivityArgs)['parse']>, ctx);
    case 'request_report_reanalysis':
      return requestReportReanalysis(parsed.data as ReturnType<(typeof RequestReportReanalysisArgs)['parse']>, ctx);
    case 'regenerate_plan':
      return regeneratePlan(ctx);
    case 'find_nearby_resources':
      return findNearbyResources(parsed.data as ReturnType<(typeof FindNearbyResourcesArgs)['parse']>, ctx);
  }
}

/**
 * Runs the same sequence as the legacy plan-generate worker
 * (src/server/queue/jobs/plan-generate.ts), inline rather than queued — a
 * single reasoning-tier call, acceptable within a chat request (see
 * engineering doc §2/§3). Each call is a new plan cycle (cycle_no already
 * increments per call via getNextCycleNo), so there is no "supersede the
 * prior plan" step needed — old cycles simply remain as history, the same
 * way the legacy flow already works. The one real difference: this skips
 * enqueueForReview and goes straight to 'approved', per the direct-apply
 * decision (engineering doc §4/§7).
 */
async function regeneratePlan(ctx: ToolDispatchContext): Promise<ToolDispatchResult> {
  const targetFindings = await getTargetFindings(ctx.childId);
  if (targetFindings.length === 0) {
    return { ok: false, summary: '', error: { code: 'NOTHING_TO_PLAN', message: "there's nothing to plan from yet — no published findings" } };
  }

  const child = await getChild(ctx.childId);
  const [constraints, resourceCandidates, cycleNo] = await Promise.all([
    getFamilyConstraints(ctx.familyId),
    getResourceCandidates(),
    getNextCycleNo(ctx.childId),
  ]);

  const result = await runPlan({
    childAgeMonths: ageMonthsFromDob(child.dob),
    targetFindings,
    constraints,
    topicContext: null,
    resourceCandidates,
    priorFailures: [],
  });

  if (!result.ok) {
    return { ok: false, summary: '', error: { code: 'PLAN_GENERATION_FAILED', message: JSON.stringify(result.error) } };
  }

  const planId = await createPlan({
    familyId: ctx.familyId,
    childId: ctx.childId,
    cycleNo,
    topicContext: null,
    modelDeployment: result.meta.modelDeployment,
    promptVersion: result.meta.promptVersion,
  });

  await savePlanActivities(planId, result.value.activities);
  await approvePlanDirectly(planId);

  const after = { planId, cycleNo, activities: result.value.activities };
  await writeAudit(ctx, 'regenerate_plan', 'plan', planId, null, after);

  const lines = result.value.activities.map(a => `- ${a.title}`);
  return { ok: true, summary: `Put together an updated plan:\n${lines.join('\n')}`, after };
}

async function editFindingStatement(args: { findingId: string; newStatement: string }, ctx: ToolDispatchContext): Promise<ToolDispatchResult> {
  const finding = await getFindingForEdit(args.findingId);
  if (!finding || finding.familyId !== ctx.familyId) {
    return { ok: false, summary: '', error: { code: 'NOT_FOUND', message: "couldn't find that finding" } };
  }

  const before = { statement: finding.statement, excluded: finding.excluded };
  await updateFinding({
    findingId: finding.id,
    editedBy: ctx.actorProfileId,
    statement: args.newStatement,
    preserveOriginalAs: !finding.originalStatement ? finding.statement : undefined,
  });
  const after = { statement: args.newStatement, excluded: finding.excluded };

  await writeAudit(ctx, 'edit_finding_statement', 'finding', finding.id, before, after);
  return { ok: true, summary: `Reworded a finding to: "${args.newStatement}"`, before, after };
}

async function setFindingExcluded(args: { findingId: string }, excluded: boolean, ctx: ToolDispatchContext): Promise<ToolDispatchResult> {
  const finding = await getFindingForEdit(args.findingId);
  if (!finding || finding.familyId !== ctx.familyId) {
    return { ok: false, summary: '', error: { code: 'NOT_FOUND', message: "couldn't find that finding" } };
  }

  const before = { excluded: finding.excluded };
  await updateFinding({ findingId: finding.id, editedBy: ctx.actorProfileId, excluded });
  const after = { excluded };

  await writeAudit(ctx, excluded ? 'exclude_finding' : 'restore_finding', 'finding', finding.id, before, after);
  return { ok: true, summary: excluded ? 'Dropped that finding from the active set.' : 'Restored that finding.', before, after };
}

async function editPlanActivity(
  args: { activityId: string; title?: string; instructions?: string; declined?: boolean },
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  const activity = await getPlanActivityForEdit(args.activityId);
  if (!activity || activity.familyId !== ctx.familyId) {
    return { ok: false, summary: '', error: { code: 'NOT_FOUND', message: "couldn't find that activity" } };
  }

  const before = { title: activity.title, instructions: activity.instructions, declined: activity.declined };
  await updatePlanActivity({ activityId: activity.id, title: args.title, instructions: args.instructions, declined: args.declined });
  const after = {
    title: args.title ?? activity.title,
    instructions: args.instructions ?? activity.instructions,
    declined: args.declined ?? activity.declined,
  };

  await writeAudit(ctx, 'edit_plan_activity', 'plan', activity.id, before, after);
  return { ok: true, summary: `Updated the activity "${after.title}".`, before, after };
}

async function requestReportReanalysis(args: { reportId: string }, ctx: ToolDispatchContext): Promise<ToolDispatchResult> {
  const { data: report } = await serviceClient().from('reports').select('id, family_id').eq('id', args.reportId).maybeSingle();
  if (!report || report.family_id !== ctx.familyId) {
    return { ok: false, summary: '', error: { code: 'NOT_FOUND', message: "couldn't find that report" } };
  }

  await enqueue('report.analyse', { reportId: args.reportId });
  await writeAudit(ctx, 'request_report_reanalysis', 'report', args.reportId, null, { requested: true });
  return { ok: true, summary: "I've asked for that report to be looked at again — I'll let you know what comes up." };
}

/**
 * Read-only — no DB write, so no audit entry (writeAudit assumes a
 * before/after state change). A Places API error (quota, network, bad key)
 * must not fail the whole turn, so this always resolves `ok: true` with an
 * honest fallback the agent can relay, rather than surfacing an error the
 * caller would prefix with "Error:". See docs/specs/08-orchestrator-chat.md.
 */
async function findNearbyResources(args: { query: string }, ctx: ToolDispatchContext): Promise<ToolDispatchResult> {
  const child = await getChild(ctx.childId);
  if (!child.city && !child.pincode) {
    return { ok: true, summary: "There's no city or pincode on file for this child, so nearby options aren't available right now — home activities still work." };
  }

  try {
    const places = await searchNearbyPlaces(args.query, child.city, child.pincode);
    if (places.length === 0) {
      return { ok: true, summary: `Didn't find any "${args.query}" nearby.` };
    }
    const lines = places.map(p => `- ${p.name}${p.rating ? ` (${p.rating}★)` : ''} — ${p.address}${p.googleMapsUrl ? ` (${p.googleMapsUrl})` : ''}`);
    return { ok: true, summary: `Found a few nearby options:\n${lines.join('\n')}` };
  } catch {
    return { ok: true, summary: "Couldn't look up nearby places right now — falling back to a home activity instead." };
  }
}
