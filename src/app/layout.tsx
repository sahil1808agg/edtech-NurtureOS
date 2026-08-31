import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { routeClient, currentUser } from '../lib/db/server';

export const metadata: Metadata = {
  title: 'NurtureOS',
  description: 'Understand your child\'s school report, and what to do next.',
};

async function Nav() {
  const db = await routeClient();
  const user = await currentUser(db);

  return (
    <header className="mb-10 flex items-baseline justify-between border-b border-[var(--border)] pb-4">
      <Link href="/" className="text-sm font-semibold tracking-tight">NurtureOS</Link>

      <nav className="flex items-center gap-4 text-sm">
        {user ? (
          <>
            <Link href="/upload" className="text-[var(--muted)] hover:underline">Upload</Link>
            {user.isOps && (
              <Link href="/review" className="text-[var(--muted)] hover:underline">Monitor</Link>
            )}
            <form action="/api/auth/signout" method="post">
              <button type="submit" className="text-[var(--muted)] hover:underline">Sign out</button>
            </form>
          </>
        ) : (
          <Link href="/signin" className="text-[var(--muted)] hover:underline">Sign in</Link>
        )}
      </nav>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Wide enough for the report-beside-findings split; text-only pages
            constrain themselves with their own max-width. */}
        <div className="mx-auto max-w-6xl px-6 py-10">
          <Nav />
          {children}
        </div>
      </body>
    </html>
  );
}
