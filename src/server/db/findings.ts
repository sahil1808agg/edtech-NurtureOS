import { serviceClient } from '../../lib/db/clients.js';
import type { ObservationRow, NarrativeRow, CandidateClaim, CorroborationResult } from '../pipeline/types.js';

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
