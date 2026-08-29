/**
 * Supabase clients.
 *
 * Three separate constructors so the choice of key is deliberate at every
 * call site rather than incidental:
 *
 *   browserClient  anon key, RLS enforced, safe in the browser
 *   userClient     anon key + a user's access token, RLS enforced
 *   serviceClient  service role key, RLS BYPASSED, server and worker only
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function browserClient(): SupabaseClient {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}

/** Acts as the signed-in parent. RLS applies, so this cannot cross families. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );
}

/**
 * Bypasses every row level security policy. Only the pipeline worker and
 * server-side routes that have already checked authorisation may use this.
 * Never import into a client component.
 */
export function serviceClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("serviceClient() must never run in the browser");
  }
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
}
