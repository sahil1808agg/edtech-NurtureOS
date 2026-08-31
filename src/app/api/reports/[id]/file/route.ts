import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../lib/db/server';
import { serviceClient } from '../../../../../lib/db/clients';

export const runtime = 'nodejs';

/**
 * Redirects to a short-lived signed URL for the report file.
 *
 * The bucket is private, so this is the only way to read it. Authorisation is
 * checked here — family matched explicitly, since the reports policy widens for
 * ops — and the signed URL is deliberately short-lived: it carries no auth of
 * its own, so anyone holding it can read the file until it expires.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // Ops may view any report's source — reviewing a claim means checking it
  // against the page it came from.
  let query = db.from('reports').select('id, storage_path, family_id').eq('id', id);
  if (!user.isOps) query = query.eq('family_id', user.familyId);

  const { data: report } = await query.maybeSingle();
  if (!report || report.storage_path === 'pending') {
    return NextResponse.json({ error: 'Report file not found' }, { status: 404 });
  }

  const { data, error } = await serviceClient()
    .storage.from('reports')
    .createSignedUrl(report.storage_path, 300);

  if (error || !data) {
    return NextResponse.json({ error: `Could not sign URL: ${error?.message}` }, { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl);
}
