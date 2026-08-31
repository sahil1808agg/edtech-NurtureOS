import { serviceClient } from '../../lib/db/clients.js';

const BUCKET = 'reports';

export async function downloadReportFile(storagePath: string): Promise<Buffer> {
  const { data, error } = await serviceClient().storage.from(BUCKET).download(storagePath);

  if (error || !data) {
    throw new Error(`failed to download ${BUCKET}/${storagePath}: ${error?.message ?? 'no data'}`);
  }

  return Buffer.from(await data.arrayBuffer());
}

export async function uploadReportFile(storagePath: string, bytes: Buffer, contentType: string): Promise<void> {
  const { error } = await serviceClient()
    .storage.from(BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: false });

  if (error) {
    throw new Error(`failed to upload ${BUCKET}/${storagePath}: ${error.message}`);
  }
}
