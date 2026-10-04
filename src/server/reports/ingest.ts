import { serviceClient } from '../../lib/db/clients.js';
import { assertConsent } from '../consent/assert.js';
import { enqueue } from '../queue/enqueue.js';

/**
 * Extracted from src/app/api/reports/route.ts so the legacy upload page and
 * the new chat attachment route (docs/specs/02-report-attachment.md) call one
 * implementation rather than duplicating the consent/validation/storage/enqueue
 * sequence. No behavior change to the legacy route.
 */

export const MAX_BYTES = 20 * 1024 * 1024;
export const ACCEPTED = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export interface IngestReportInput {
  childId: string;
  familyId: string;
  file: File;
  termLabel?: string | null;
  termIndex?: number | null;
  academicYear?: string | null;
}

export interface IngestReportResult {
  reportId: string;
  status: 'uploaded';
}

export class IngestValidationError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Consent check -> validate type/size -> insert reports row -> upload to storage -> enqueue report.extract. */
export async function ingestReport(input: IngestReportInput): Promise<IngestReportResult> {
  const { file } = input;

  if (!ACCEPTED.has(file.type)) {
    throw new IngestValidationError(`Unsupported file type ${file.type}. Upload a PDF, JPEG or PNG.`, 415);
  }
  if (file.size > MAX_BYTES) {
    throw new IngestValidationError(`File is ${(file.size / 1e6).toFixed(1)}MB; the limit is 20MB.`, 413);
  }

  // Consent check happens before a single byte is stored — the PRD's hard
  // gate is "no processing without a live consent row". assertConsent throws
  // ConsentError, which the caller (route handler) catches and maps to a 403.
  await assertConsent(serviceClient(), input.childId, 'report_analysis');

  const admin = serviceClient();

  const { data: report, error: reportError } = await admin
    .from('reports')
    .insert({
      family_id: input.familyId,
      child_id: input.childId,
      term_label: input.termLabel ?? null,
      term_index: input.termIndex ?? null,
      academic_year: input.academicYear ?? null,
      source_type: file.type === 'application/pdf' ? 'pdf' : 'photo',
      storage_path: 'pending',
    })
    .select('id')
    .single();

  if (reportError || !report) {
    throw new Error(`Could not create report: ${reportError?.message}`);
  }

  const extension = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
  const storagePath = `${report.id}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from('reports')
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });

  if (uploadError) {
    // Leave no report row pointing at a file that was never stored.
    await admin.from('reports').delete().eq('id', report.id);
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  await admin.from('reports').update({ storage_path: storagePath }).eq('id', report.id);
  await enqueue('report.extract', { reportId: report.id });

  return { reportId: report.id, status: 'uploaded' };
}
