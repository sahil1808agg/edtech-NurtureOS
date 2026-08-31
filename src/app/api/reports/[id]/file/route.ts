import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../lib/db/server';
import { serviceClient } from '../../../../../lib/db/clients';

export const runtime = 'nodejs';

/**
 * Streams the report file.
 *
 * The bytes are proxied rather than redirected to a signed URL. Two reasons:
 * the viewer needs the response to be same-origin so that a `#page=N` fragment
 * actually moves the PDF (a fragment does not reliably survive a redirect onto
 * a cross-origin document), and it keeps a bearer-like signed URL from leaving
 * the server at all.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // Ops may view any report's source — reviewing a claim means checking it
  // against the page it came from.
  let query = db.from('reports').select('id, storage_path, source_type').eq('id', id);
  if (!user.isOps) query = query.eq('family_id', user.familyId);

  const { data: report } = await query.maybeSingle();
  if (!report || report.storage_path === 'pending') {
    return NextResponse.json({ error: 'Report file not found' }, { status: 404 });
  }

  const { data, error } = await serviceClient().storage.from('reports').download(report.storage_path);
  if (error || !data) {
    return NextResponse.json({ error: `Could not read file: ${error?.message}` }, { status: 500 });
  }

  const contentType =
    report.source_type === 'pdf'
      ? 'application/pdf'
      : report.storage_path.endsWith('.png')
        ? 'image/png'
        : 'image/jpeg';

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': 'inline',
      // Private: this is one family's child's report. Cached briefly so paging
      // around the document does not refetch it on every click.
      'Cache-Control': 'private, max-age=300',
    },
  });
}
