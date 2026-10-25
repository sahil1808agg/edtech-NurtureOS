import { redirect } from 'next/navigation';
import { routeClient, currentUser } from '../../lib/db/server';

export const dynamic = 'force-dynamic';

/**
 * Uploading moved into each child's Report & plan tab, where the report's
 * progress and the plan that follows are shown. Kept so old links land
 * somewhere sensible: the first child's tab, or adding a child if none.
 */
export default async function LegacyUploadPage() {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) redirect('/signin');

  const { data: child } = await db
    .from('children')
    .select('id')
    .eq('family_id', user.familyId)
    .order('first_name')
    .limit(1)
    .maybeSingle();

  redirect(child ? `/children/${child.id}/plan` : '/children/new');
}
