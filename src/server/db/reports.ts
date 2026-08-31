import { serviceClient } from '../../lib/db/clients.js';

export interface ReportRow {
  id: string;
  familyId: string;
  childId: string;
  storagePath: string;
  sourceType: 'pdf' | 'photo';
  status: string;
}

export async function getReport(reportId: string): Promise<ReportRow> {
  const { data, error } = await serviceClient()
    .from('reports')
    .select('id, family_id, child_id, storage_path, source_type, status')
    .eq('id', reportId)
    .single();

  if (error || !data) {
    throw new Error(`report ${reportId} not found: ${error?.message ?? 'no row'}`);
  }

  return {
    id: data.id,
    familyId: data.family_id,
    childId: data.child_id,
    storagePath: data.storage_path,
    sourceType: data.source_type,
    status: data.status,
  };
}

export async function updateReportStatus(
  reportId: string,
  status: string,
  failureReason?: string,
): Promise<void> {
  const { error } = await serviceClient()
    .from('reports')
    .update({ status, failure_reason: failureReason ?? null })
    .eq('id', reportId);

  if (error) {
    throw new Error(`failed to update report ${reportId} status to ${status}: ${error.message}`);
  }
}
