'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '../../lib/db/browser';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setBusy(false);

    if (error) {
      setError(error.message);
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-sm">
      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
            id="password" type="password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

        <button
          type="submit" disabled={busy}
          className="w-full rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
