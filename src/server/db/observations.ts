import { serviceClient } from '../../lib/db/clients.js';
import type { ExtractOutput } from '../pipeline/extract.js';
import type { ObservationRow } from '../pipeline/types.js';

export async function getExtractionOutput(reportId: string): Promise<ExtractOutput> {
  const { data, error } = await serviceClient()
    .from('extractions')
    .select('raw_json')
    .eq('report_id', reportId)
    .single();

  if (error || !data) {
    throw new Error(`extraction for report ${reportId} not found: ${error?.message ?? 'no row'}`);
  }

  return data.raw_json as ExtractOutput;
}

/** null when the scale is not one this project knows about. */
export async function getScaleBoard(scaleId: string): Promise<string | null> {
  const { data } = await serviceClient().from('scales').select('board').eq('id', scaleId).maybeSingle();
  return data?.board ?? null;
}

export interface SkillCandidate {
  code: string;
  name: string;
  aliases: string[];
}

/** Every known skill, with any aliases already recorded for this board. */
export async function getSkillCandidates(board: string): Promise<SkillCandidate[]> {
  const { data: skills, error } = await serviceClient().from('skills').select('id, code, name');
  if (error) throw new Error(`fetching skills: ${error.message}`);
  if (!skills?.length) return [];

  const { data: aliases } = await serviceClient()
    .from('skill_aliases')
    .select('skill_id, raw_label')
    .eq('board', board);

  const aliasesBySkill = new Map<string, string[]>();
  for (const a of aliases ?? []) {
    const list = aliasesBySkill.get(a.skill_id) ?? [];
    list.push(a.raw_label);
    aliasesBySkill.set(a.skill_id, list);
  }

  return skills.map(s => ({ code: s.code, name: s.name, aliases: aliasesBySkill.get(s.id) ?? [] }));
}

/** Maps skill codes (what the model returns) back to skill uuids (what observations.skill_id stores). */
export async function getSkillIdsByCode(codes: string[]): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const { data, error } = await serviceClient().from('skills').select('id, code').in('code', codes);
  if (error) throw new Error(`resolving skill codes: ${error.message}`);
  return new Map((data ?? []).map(s => [s.code, s.id]));
}

// observations.family_id/child_id scope the row for RLS; the pure ObservationRow
// pipeline type has no notion of that scoping, so the job layer adds it here.
export type ObservationInsert = ObservationRow & { familyId: string; childId: string };

// observations has no unique key to upsert against, so a re-run replaces by delete+insert
// — same reasoning as narratives in extractions.ts.
export async function saveObservations(reportId: string, rows: ObservationInsert[]): Promise<void> {
  // .select() makes the delete report which rows it actually removed — without it
  // PostgREST returns 204 with no body, so a delete that matched nothing is
  // indistinguishable from one that cleared the table.
  const { data: deleted, error: deleteError } = await serviceClient()
    .from('observations')
    .delete()
    .eq('report_id', reportId)
    .select('id');
  if (deleteError) throw new Error(`failed to clear prior observations for report ${reportId}: ${deleteError.message}`);
  console.log(`[normalise] cleared ${deleted?.length ?? 0} prior observation(s) for report ${reportId}`);

  if (rows.length === 0) return;
  const { error } = await serviceClient().from('observations').insert(
    rows.map(r => ({
      family_id: r.familyId,
      child_id: r.childId,
      report_id: r.reportId,
      skill_id: r.skillId,
      raw_label: r.rawLabel,
      scale_id: r.scaleId,
      term_index: r.termIndex,
      raw_value: r.rawValue,
      normalised: r.normalised,
      is_ambiguous: r.isAmbiguous,
      confidence: r.confidence,
      source_ref: r.sourceRef,
    })),
  );

  if (error) throw new Error(`saving observations: ${error.message}`);
}
