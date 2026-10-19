'use client';

import { usePathname } from 'next/navigation';

// The chat conversation page (/chat/[childId]) breaks out of the app's
// centered max-w-6xl shell — unlike every other page, it wants the full
// viewport width rather than a reading-width column. /chat itself (the
// child picker) is unaffected.
export function AppShell({ nav, children }: { nav: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const isChatThread = /^\/chat\/[^/]+/.test(pathname ?? '');

  return (
    <div className={isChatThread ? 'px-6 py-10' : 'mx-auto max-w-6xl px-6 py-10'}>
      {nav}
      {children}
    </div>
  );
}
