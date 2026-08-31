/**
 * Request-scoped Supabase client for Route Handlers and Server Components.
 *
 * Uses the anon key plus the caller's session cookies, so RLS applies and a
 * request cannot read across families. Distinct from serviceClient() in
 * clients.ts, which bypasses RLS and is worker-only.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

type CookieToSet = { name: string; value: string; options: CookieOptions };

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export async function routeClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list: CookieToSet[]) => {
          try {
            for (const { name, value, options } of list) cookieStore.set(name, value, options);
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Session refresh is handled in middleware instead.
          }
        },
      },
    },
  );
}

export interface AuthedUser {
  id: string;
  familyId: string;
  isOps: boolean;
}

/**
 * Resolves the signed-in user and their family. Returns null when not signed in
 * or when no profile row exists yet (an auth user without an account is not
 * usable — see create_family_account in migration 0003).
 */
export async function currentUser(db: SupabaseClient): Promise<AuthedUser | null> {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;

  const { data: profile } = await db
    .from("profiles")
    .select("id, family_id, is_ops")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;
  return { id: profile.id, familyId: profile.family_id, isOps: profile.is_ops };
}
