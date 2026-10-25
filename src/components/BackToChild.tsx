import Link from 'next/link';

/** Back to the child's Report & plan tab — the place the report and plan detail pages are opened from. */
export function BackToChild({ childId, name }: { childId: string; name: string }) {
  return (
    <Link href={`/children/${childId}/plan`} className="mb-3 inline-block text-xs underline text-[var(--muted)]">
      ← Back to {name}
    </Link>
  );
}
