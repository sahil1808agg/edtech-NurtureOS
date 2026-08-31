import { redirect } from 'next/navigation';
import Link from 'next/link';
import { routeClient, currentUser } from '../../../../lib/db/server';

export const dynamic = 'force-dynamic';

/**
 * Shows the original report, opened at the page a citation came from.
 *
 * Honest about its limit: source_ref carries a page number but no geometry.
 * There is no layout pre-pass, so table/row/cell are the model's claim rather
 * than a measurement (see the LLD). We can therefore open the right page and
 * name the row, but not draw a box around the cell.
 */
export default async function SourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; label?: string }>;
}) {
  const { id } = await params;
  const { page, label } = await searchParams;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  let query = db.from('reports').select('id, term_label, source_type, family_id').eq('id', id);
  if (!user.isOps) query = query.eq('family_id', user.familyId);
  const { data: report } = await query.maybeSingle();

  if (!report) return <main><p className="text-sm">Report not found.</p></main>;

  const pageNo = page && /^\d+$/.test(page) ? Number(page) : null;
  // #page=N is understood by the browser's built-in PDF viewer.
  const fileUrl = `/api/reports/${id}/file${pageNo ? `#page=${pageNo}` : ''}`;

  return (
    <main>
      <Link href={`/reports/${id}`} className="text-xs underline text-[var(--muted)]">
        ← Back to findings
      </Link>

      <h1 className="mt-3 text-xl font-semibold tracking-tight">
        The original report{report.term_label ? ` — ${report.term_label}` : ''}
      </h1>

      {label && (
        <p className="mt-2 rounded border border-[var(--border)] p-3 text-sm">
          Looking for{pageNo ? ` on page ${pageNo}` : ''}: <strong>{label}</strong>
        </p>
      )}

      <p className="mt-2 text-xs text-[var(--muted)]">
        {pageNo
          ? `Opened at page ${pageNo}. We record which page a value came from, not its exact position, so you may need to scan the page for the row above.`
          : 'We record which page a value came from, not its exact position.'}
      </p>

      {report.source_type === 'pdf' ? (
        <iframe
          src={fileUrl}
          title="Original report"
          className="mt-4 h-[80vh] min-h-[640px] w-full rounded border border-[var(--border)]"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fileUrl}
          alt="Original report"
          className="mt-4 w-full rounded border border-[var(--border)]"
        />
      )}

      <p className="mt-3 text-xs text-[var(--muted)]">
        If the viewer does not open,{' '}
        <a href={fileUrl} target="_blank" rel="noreferrer" className="underline">
          open the file directly
        </a>
        .
      </p>
    </main>
  );
}
