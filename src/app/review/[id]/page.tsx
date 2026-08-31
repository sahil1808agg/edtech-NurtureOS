import { redirect } from 'next/navigation';
import { routeClient, currentUser } from '../../../lib/db/server';
import { serviceClient } from '../../../lib/db/clients';

export const dynamic = 'force-dynamic';

/**
 * The separate finding-set console is gone — reviewing happens on the report
 * page, beside the findings and the report itself. This only forwards old
 * links (and the queue's fallback) to where the work now happens.
 */
export default async function LegacyReviewRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');
  if (!user.isOps) redirect('/');

  const { data: set } = await serviceClient()
    .from('finding_sets')
    .select('report_id')
    .eq('id', id)
    .maybeSingle();

  redirect(set ? `/reports/${set.report_id}` : '/review');
}
