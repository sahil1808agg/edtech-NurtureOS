'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The child workspace's tab bar. Each tab is its own route under
 * /children/[id] (not client-side state) so every tab is linkable, the back
 * button works, and each one loads only its own data.
 */
export function ChildTabs({ childId }: { childId: string }) {
  const pathname = usePathname() ?? '';
  const base = `/children/${childId}`;

  const tabs = [
    { href: base, label: 'Today', active: pathname === base },
    { href: `${base}/details`, label: 'Child details', active: pathname.startsWith(`${base}/details`) },
    { href: `${base}/plan`, label: 'Report & plan', active: pathname.startsWith(`${base}/plan`) },
    { href: `${base}/chat`, label: 'Chat', active: pathname.startsWith(`${base}/chat`) },
  ];

  return (
    // The baseline is an inset shadow rather than a border so the active
    // tab's underline can paint over it without a negative margin — which,
    // inside a horizontally scrollable strip, spawned a vertical scrollbar.
    <nav
      aria-label="Child sections"
      className="mt-6 flex gap-6 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--border)]"
    >
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? 'page' : undefined}
          className={
            t.active
              ? 'shrink-0 border-b-2 border-[var(--accent)] pb-2 text-sm font-medium'
              : 'shrink-0 border-b-2 border-transparent pb-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]'
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
