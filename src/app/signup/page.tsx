'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '../../lib/db/browser';

export default function SignUpPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, fullName }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Could not create your account (${res.status})`);
      setBusy(false);
      return;
    }

    // The route creates the account; signing in here is what puts a session
    // cookie in place for middleware and Server Components.
    const { error: signInError } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setBusy(false);

    if (signInError) {
      setError('Account created, but sign-in failed. Try signing in.');
      return;
    }

    router.push('/children/new');
    router.refresh();
  }

  return (
    <main className="max-w-sm">
      <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        You will add your child next. Nothing is analysed until you give consent for that child.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="fullName" className="block text-sm">Your name</label>
          <input
            id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm">Email</label>
          <input
            id="email" type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm">Password</label>
          <input
            id="password" type="password" required minLength={10} value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-[var(--muted)]">At least 10 characters.</p>
        </div>

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

        <button
          type="submit" disabled={busy}
          className="w-full rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className="mt-4 text-sm text-[var(--muted)]">
        Already have an account? <Link href="/signin" className="underline">Sign in</Link>
      </p>
    </main>
  );
}
