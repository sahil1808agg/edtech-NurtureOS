import { serviceClient } from '../../lib/db/clients.js';
import type { ObservationRow, NarrativeRow, CandidateClaim, CorroborationResult } from '../pipeline/types.js';
import type { TargetFinding } from './plans.js';

export async function getObservations(reportId: string): Promise<ObservationRow[]> {
  const { data, error } = await serviceClient()
    .from('observations')
    .select('id, report_id, skill_id, raw_label, scale_id, term_index, raw_value, normalised, is_ambiguous, confidence, source_ref')
    .eq('report_id', reportId);

  if (error) throw new Error(`fetching observations for report ${reportId}: ${error.message}`);

  return (data ?? []).map(o => ({
    id: o.id,
    reportId: o.report_id,
    skillId: o.skill_id,
    rawLabel: o.raw_label,
    scaleId: o.scale_id,
    termIndex: o.term_index,
    rawValue: o.raw_value,
    normalised: o.normalised,
    isAmbiguous: o.is_ambiguous,
    confidence: o.confidence,
    sourceRef: o.source_ref,
  }));
}

export async function getNarratives(reportId: string): Promise<NarrativeRow[]> {
  const { data, error } = await serviceClient()
    .from('narratives')
    .select('id, report_id, subject, text')
    .eq('report_id', reportId);

  if (error) throw new Error(`fetching narratives for report ${reportId}: ${error.message}`);

  return (data ?? []).map(n => ({ id: n.id, reportId: n.report_id, subject: n.subject, text: n.text }));
}

/**
 * Findings from the child's most recent NON-REJECTED finding set — draft,
 * in_review, or published, excluding only rejected. Used to ground chat (both
 * loadChildContext and the report-analysis agent), where a draft summary is
 * already surfaced into the conversation the moment analyse finishes
 * (report-analyse.ts's postChatUpdate) — grounding chat on published-only
 * would contradict what the parent was just told one turn later. Planning
 * keeps the stricter published-only gate (getTargetFindings, db/plans.ts) —
 * a plan is a bigger commitment than a chat answer. See
 * docs/specs/08-orchestrator-chat.md.
 */
export async function getFindingsForChat(childId: string): Promise<TargetFinding[]> {
  const { data: findingSet } = await serviceClient()
    .from('finding_sets')
    .select('id')
    .eq('child_id', childId)
    .in('status', ['draft', 'in_review', 'published'])
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

export interface CreateFindingSetInput {
  familyId: string;
  childId: string;
  reportId: string;
  honestyPath: boolean;
  modelDeployment: string;
  promptVersion: string;
}

export async function createFindingSet(input: CreateFindingSetInput): Promise<string> {
  // A re-run must not stack a second set onto the same report, or the review
  // queue shows duplicates of one report.
  //
  // Superseded, never deleted: plan_activities.addresses_finding_id references
  // findings(id) WITHOUT a cascade, so deleting a draft whose findings a plan
  // already targets is correctly refused by the database. Marking the old draft
  // rejected retires it from the queue while leaving every existing reference
  // intact. Only drafts are touched — a published or rejected set is a decision
  // already taken, and re-running analyse must never quietly undo it.
  const { data: superseded, error: clearError } = await serviceClient()
    .from('finding_sets')
    .update({ status: 'rejected' })
    .eq('report_id', input.reportId)
    .eq('status', 'draft')
    .select('id');

  if (clearError) {
    throw new Error(`superseding prior draft finding sets for report ${input.reportId}: ${clearError.message}`);
  }

  for (const old of superseded ?? []) {
    await serviceClient()
      .from('review_queue')
      .update({ status: 'rejected' })
      .eq('artifact_type', 'finding_set')
      .eq('artifact_id', old.id);
  }

  const { data, error } = await serviceClient()
    .from('finding_sets')
    .insert({
      family_id: input.familyId,
      child_id: input.childId,
      report_id: input.reportId,
      honesty_path: input.honestyPath,
      model_deployment: input.modelDeployment,
      prompt_version: input.promptVersion,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`creating finding_set for report ${input.reportId}: ${error?.message}`);
  return data.id;
}

export interface SaveFindingInput {
  findingSetId: string;
  familyId: string;
  position: number;
  claim: CandidateClaim;
  corroboration: CorroborationResult;
}

/** Inserts the finding plus its citation rows (observations from the claim, the corroborating narrative if any). */
export async function saveFinding(input: SaveFindingInput): Promise<void> {
  const { data: finding, error: findingError } = await serviceClient()
    .from('findings')
    .insert({
      finding_set_id: input.findingSetId,
      family_id: input.familyId,
      kind: input.claim.kind,
      statement: input.claim.statement,
      corroboration_status: input.corroboration.verdict,
      corroboration_quote: input.corroboration.quote,
      position: input.position,
    })
    .select('id')
    .single();

  if (findingError || !finding) throw new Error(`saving finding: ${findingError?.message}`);

  interface CitationRow {
    finding_id: string;
    observation_id: string | null;
    narrative_id: string | null;
  }

  const citations: CitationRow[] = input.claim.citedObservationIds.map(observationId => ({
    finding_id: finding.id,
    observation_id: observationId,
    narrative_id: null,
  }));

  if (input.corroboration.narrativeId) {
    citations.push({
      finding_id: finding.id,
      observation_id: null,
      narrative_id: input.corroboration.narrativeId,
    });
  }

  const { error: citationError } = await serviceClient().from('finding_citations').insert(citations);
  if (citationError) throw new Error(`saving finding citations: ${citationError.message}`);
}

// ---------- Editing (legacy page PATCH, and chat's edit_finding_statement / exclude_finding / restore_finding) ----------
//
// Extracted from src/app/api/findings/[id]/route.ts so both the legacy route
// and src/server/chat/dispatch.ts call one implementation. The legacy route
// still enforces "only while the finding set is draft" itself (see
// getFindingSetStatus below) — chat does not, by design, since chat-originated
// findings go straight to approved/published with no draft period. See
// docs/engineering/engineering-doc.md §4 and §7.

export interface FindingForEdit {
  id: string;
  familyId: string;
  statement: string;
  originalStatement: string | null;
  findingSetId: string;
  excluded: boolean;
}

export async function getFindingForEdit(findingId: string): Promise<FindingForEdit | null> {
  const { data } = await serviceClient()
    .from('findings')
    .select('id, family_id, statement, original_statement, finding_set_id, excluded')
    .eq('id', findingId)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    familyId: data.family_id,
    statement: data.statement,
    originalStatement: data.original_statement,
    findingSetId: data.finding_set_id,
    excluded: data.excluded,
  };
}

export async function getFindingSetStatus(findingSetId: string): Promise<string | null> {
  const { data } = await serviceClient().from('finding_sets').select('status').eq('id', findingSetId).maybeSingle();
  return data?.status ?? null;
}

export interface UpdateFindingInput {
  findingId: string;
  editedBy: string;
  statement?: string;
  excluded?: boolean;
  /** The model's original wording — pass only when this is the first edit to statement (current.originalStatement is null). */
  preserveOriginalAs?: string;
}

export async function updateFinding(input: UpdateFindingInput): Promise<void> {
  const update: Record<string, unknown> = { edited_at: new Date().toISOString(), edited_by: input.editedBy };

  if (input.statement !== undefined) {
    update.statement = input.statement;
    if (input.preserveOriginalAs) update.original_statement = input.preserveOriginalAs;
  }
  if (input.excluded !== undefined) update.excluded = input.excluded;

  const { error } = await serviceClient().from('findings').update(update).eq('id', input.findingId);
  if (error) throw new Error(`updating finding ${input.findingId}: ${error.message}`);
}
