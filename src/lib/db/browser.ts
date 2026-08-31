'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser client that writes the session to cookies, so middleware and Server
 * Components can read it. clients.ts#browserClient uses plain supabase-js and
 * keeps the session in localStorage, which the server cannot see.
 */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
