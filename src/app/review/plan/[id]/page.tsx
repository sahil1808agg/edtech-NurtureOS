import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Plans are reviewed on the plan page itself now. */
export default async function LegacyPlanReviewRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/plans/${id}`);
}
