import { redirect } from 'next/navigation';

/** Chat moved into the child workspace's Chat tab; kept so old links still work. */
export default async function LegacyChatPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params;
  redirect(`/children/${childId}/chat`);
}
