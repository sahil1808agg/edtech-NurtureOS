import { serviceClient } from '../../lib/db/clients.js';
import {
  TOOL_SCHEMAS,
  type ToolName,
  EditFindingStatementArgs,
  ExcludeFindingArgs,
  RestoreFindingArgs,
  EditPlanActivityArgs,
  UpdateFamilyInterestsArgs,
  RequestReportReanalysisArgs,
  FindNearbyResourcesArgs,
  UpdateChildProfileArgs,
  AddChildArgs,
} from './tools.js';
import { getFindingForEdit, updateFinding } from '../db/findings.js';
import {
  getPlanActivityForEdit,
  updatePlanActivity,
  getChild,
  ageMonthsFromDob,
  getTargetFindings,
  getFamilyConstraints,
  setFamilyInterests,
  getResourceCandidates,
  getNextCycleNo,
  createPlan,
  savePlanActivities,
  approvePlanDirectly,
} from '../db/plans.js';
import { getChildProfile, updateChildProfile as saveChildProfile } from '../db/children.js';
import { runPlan } from '../pipeline/plan.js';
import { resolveLocalActivities } from '../pipeline/resolve-local-activities.js';
import { enqueue } from '../queue/enqueue.js';
import { searchNearbyPlaces, geocodeAddress } from '../places/google-places.js';
import { buildPlanSummaryForChat } from './summarize.js';

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
  agentName: 'report_agent' | 'planning_agent' | 'profile_agent';
  /** The chat turn's correlation id — carried onto any model call a tool makes (e.g. regenerate_plan's runPlan) so it groups with the turn that triggered it. See migration 0014. */
  requestId?: string;
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
    case 'update_family_interests':
      return updateFamilyInterests(parsed.data as ReturnType<(typeof UpdateFamilyInterestsArgs)['parse']>, ctx);
    case 'find_nearby_resources':
      return findNearbyResources(parsed.data as ReturnType<(typeof FindNearbyResourcesArgs)['parse']>, ctx);
    case 'update_child_profile':
      return updateChildProfile(parsed.data as ReturnType<(typeof UpdateChildProfileArgs)['parse']>, ctx);
    case 'add_child':
      return addChild(parsed.data as ReturnType<(typeof AddChildArgs)['parse']>, ctx);
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
  const hasLocation = (child.lat != null && child.lng != null) || !!(child.city || child.pincode);

  const result = await runPlan({
    childAgeMonths: ageMonthsFromDob(child.dob),
    targetFindings,
    constraints,
    topicContext: null,
    resourceCandidates,
    priorFailures: [],
    hasLocation,
  }, ctx.familyId, ctx.requestId);

  if (!result.ok) {
    return { ok: false, summary: '', error: { code: 'PLAN_GENERATION_FAILED', message: JSON.stringify(result.error) } };
  }

  const activities = await resolveLocalActivities(result.value.activities, child);

  const planId = await createPlan({
    familyId: ctx.familyId,
    childId: ctx.childId,
    cycleNo,
    topicContext: null,
    modelDeployment: result.meta.modelDeployment,
    promptVersion: result.meta.promptVersion,
  });

  await savePlanActivities(planId, activities);
  await approvePlanDirectly(planId);

  const after = { planId, cycleNo, activities };
  await writeAudit(ctx, 'regenerate_plan', 'plan', planId, null, after);

  return { ok: true, summary: buildPlanSummaryForChat(activities, new Map(resourceCandidates.map(r => [r.id, r.title]))), after };
}

/**
 * Replaces the family's standing interests with the full consolidated list
 * the model sent, so getFamilyConstraints() surfaces it into every future
 * plan regeneration — not just the one right after they said it. See docs
 * on setFamilyInterests() in db/plans.ts for why consolidation happens in
 * the model's own judgment rather than here.
 */
async function updateFamilyInterests(args: { interests: string[] }, ctx: ToolDispatchContext): Promise<ToolDispatchResult> {
  const after = { interests: await setFamilyInterests(ctx.familyId, args.interests) };

  await writeAudit(ctx, 'update_family_interests', 'family_constraints', ctx.familyId, null, after);
  return { ok: true, summary: `Noted — I'll keep these in mind for future plans: ${after.interests.join(', ')}.`, after };
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
  const geo = child.lat != null && child.lng != null ? { lat: child.lat, lng: child.lng } : null;
  const cityPincode = [child.city, child.pincode].filter(Boolean).join(' ') || null;
  if (!geo && !cityPincode) {
    return { ok: true, summary: "There's no location on file for this child, so nearby options aren't available right now — home activities still work." };
  }

  try {
    const places = (await searchNearbyPlaces(args.query, geo, cityPincode)).slice(0, 3);
    if (places.length === 0) {
      return { ok: true, summary: `Didn't find any "${args.query}" nearby.` };
    }
    const lines = places.map(p => {
      const details = [p.rating ? `${p.rating}★` : null, p.distanceKm != null ? `${p.distanceKm.toFixed(1)} km` : null]
        .filter(Boolean)
        .join(', ');
      return `- ${p.name}${details ? ` (${details})` : ''} — ${p.address}${p.googleMapsUrl ? ` (${p.googleMapsUrl})` : ''}`;
    });
    return { ok: true, summary: `Found a few nearby options:\n${lines.join('\n')}` };
  } catch {
    return { ok: true, summary: "Couldn't look up nearby places right now — falling back to a home activity instead." };
  }
}

/**
 * `args.location` is free text the parent typed in chat, not a pre-resolved
 * placeId (unlike EditLocation.tsx's picker) — it has to be geocoded before
 * it's trustworthy enough to write, since find_nearby_resources and
 * resolve-local-activities.ts both depend on lat/lng being real. Unlike
 * findNearbyResources (read-only, always returns ok:true with a graceful
 * fallback), a geocoding failure here must not silently write nothing while
 * claiming success — the parent asked for a change, so a bad address comes
 * back as an explicit error the agent can ask them to clarify.
 */
async function updateChildProfile(
  args: { firstName?: string; dob?: string; grade?: string; board?: string; location?: string },
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  if (args.dob && new Date(args.dob) > new Date()) {
    return { ok: false, summary: '', error: { code: 'INVALID_DOB', message: 'that date of birth is in the future' } };
  }

  const before = await getChildProfile(ctx.childId);

  let location: { address: string; lat: number; lng: number; placeId: string } | null = null;
  if (args.location) {
    try {
      location = await geocodeAddress(args.location);
    } catch {
      return { ok: false, summary: '', error: { code: 'PLACES_ERROR', message: "couldn't look up that location right now" } };
    }
    if (!location) {
      return { ok: false, summary: '', error: { code: 'LOCATION_NOT_FOUND', message: `couldn't find "${args.location}" — try a more specific address or area` } };
    }
  }

  await saveChildProfile(ctx.childId, {
    firstName: args.firstName,
    dob: args.dob,
    grade: args.grade,
    board: args.board,
    ...(location && { address: location.address, lat: location.lat, lng: location.lng, placeId: location.placeId }),
  });

  const after = {
    firstName: args.firstName ?? before.firstName,
    dob: args.dob ?? before.dob,
    grade: args.grade ?? before.grade,
    board: args.board ?? before.board,
    address: location?.address ?? before.address,
  };

  const changes: string[] = [];
  if (args.firstName) changes.push(`name to ${after.firstName}`);
  if (args.dob) changes.push(`date of birth to ${after.dob}`);
  if (args.grade) changes.push(`grade to ${after.grade}`);
  if (args.board) changes.push(`board to ${after.board}`);
  if (location) changes.push(`location to ${location.address}`);

  await writeAudit(ctx, 'update_child_profile', 'child', ctx.childId, before, after);
  return { ok: true, summary: `Updated ${changes.join(', ')}.`, before, after };
}

/**
 * Creates a sibling under the same family as the conversation's own child —
 * not ctx.childId, which this never touches. Mirrors POST /api/children
 * exactly (same insert shape, same grant_child_consent RPC and
 * purposes/method), just reached from chat instead of /children/new. The
 * method string differs ('parent_chat' vs 'parent_web_form') so consent
 * provenance stays accurate in the audit trail.
 *
 * args.consent is typed z.literal(true) by AddChildArgs — there is no
 * "false" or "missing" case to handle here, a validation failure before this
 * function is ever called. What this function cannot verify is whether that
 * `true` reflects a real yes from the parent or the model being too eager;
 * that's enforced by the agent's own system prompt, not by this code.
 */
async function addChild(
  args: { firstName: string; dob: string; grade: string; board?: string; location?: string; consent: true },
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  if (new Date(args.dob) > new Date()) {
    return { ok: false, summary: '', error: { code: 'INVALID_DOB', message: 'that date of birth is in the future' } };
  }

  let location: { address: string; lat: number; lng: number; placeId: string } | null = null;
  if (args.location) {
    try {
      location = await geocodeAddress(args.location);
    } catch {
      return { ok: false, summary: '', error: { code: 'PLACES_ERROR', message: "couldn't look up that location right now" } };
    }
    if (!location) {
      return { ok: false, summary: '', error: { code: 'LOCATION_NOT_FOUND', message: `couldn't find "${args.location}" — try a more specific address or area` } };
    }
  }

  const admin = serviceClient();
  const { data: child, error: childError } = await admin
    .from('children')
    .insert({
      family_id: ctx.familyId,
      first_name: args.firstName,
      dob: args.dob,
      grade: args.grade,
      board: args.board ?? null,
      address: location?.address ?? null,
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      place_id: location?.placeId ?? null,
    })
    .select('id')
    .single();

  if (childError || !child) {
    return { ok: false, summary: '', error: { code: 'DB_ERROR', message: `could not add the child: ${childError?.message}` } };
  }

  const { error: consentError } = await admin.rpc('grant_child_consent', {
    p_child_id: child.id,
    p_granted_by: ctx.actorProfileId,
    p_method: 'parent_chat',
    p_purposes: ['report_analysis', 'plan_generation'],
  });

  if (consentError) {
    // A child we cannot act on is worse than no child — do not leave one behind.
    await admin.from('children').delete().eq('id', child.id);
    return { ok: false, summary: '', error: { code: 'CONSENT_ERROR', message: `could not record consent: ${consentError.message}` } };
  }

  const after = {
    childId: child.id,
    firstName: args.firstName,
    dob: args.dob,
    grade: args.grade,
    board: args.board ?? null,
    address: location?.address ?? null,
  };

  await writeAudit(ctx, 'add_child', 'child', child.id, null, after);
  return {
    ok: true,
    summary: `Added ${args.firstName} (${args.grade})${location ? `, near ${location.address}` : ''} — consent recorded.`,
    after,
  };
}
