import { serviceClient } from '../../lib/db/clients.js';
import type { ExtractOutput } from '../pipeline/extract.js';
import type { CallMeta } from '../pipeline/types.js';

export async function saveExtraction(
  reportId: string,
  familyId: string,
  output: ExtractOutput,
  meta: CallMeta,
): Promise<void> {
  const minConfidence = output.cells.length
    ? Math.min(...output.cells.map(c => c.confidence))
    : null;

  // Upsert on report_id: a retried or manually re-run extraction must replace
  // the prior attempt, not collide with the unique(report_id) constraint.
  const { error: extractionError } = await serviceClient()
    .from('extractions')
    .upsert({
      report_id: reportId,
      page_no: null, // whole-document extraction — see supabase/migrations/0004_extraction_whole_report.sql
      raw_json: output,
      min_confidence: minConfidence,
      model_deployment: meta.modelDeployment,
      prompt_version: meta.promptVersion,
      latency_ms: meta.latencyMs,
    }, { onConflict: 'report_id' });

  if (extractionError) {
    throw new Error(`failed to save extraction for report ${reportId}: ${extractionError.message}`);
  }

  // narratives has no unique key to upsert against, so a re-run replaces by delete+insert.
  const { error: deleteError } = await serviceClient().from('narratives').delete().eq('report_id', reportId);
  if (deleteError) {
    throw new Error(`failed to clear prior narratives for report ${reportId}: ${deleteError.message}`);
  }

  if (output.narratives.length === 0) return;

  const { error: narrativeError } = await serviceClient()
    .from('narratives')
    .insert(output.narratives.map(n => ({
      family_id: familyId,
      report_id: reportId,
      subject: n.subject,
      text: n.text,
      source_ref: n.sourceRef,
    })));

  if (narrativeError) {
    throw new Error(`failed to save narratives for report ${reportId}: ${narrativeError.message}`);
  }
}
