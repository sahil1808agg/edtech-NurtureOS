import { serviceClient } from '../../lib/db/clients.js';

/**
 * A profile's email lives in Supabase's own auth.users, not on `profiles`
 * (which only has id/family_id/full_name/is_ops) — this is the one place
 * that reads it server-side, via the same admin-client call already used to
 * create accounts in src/app/api/auth/signup/route.ts.
 */
export async function getParentEmail(profileId: string): Promise<string | null> {
  const { data, error } = await serviceClient().auth.admin.getUserById(profileId);
  if (error || !data?.user) return null;
  return data.user.email ?? null;
}

export interface ProfileForDigest {
  id: string;
  familyId: string;
  emailOptOut: boolean;
}

/**
 * create_family_account() creates exactly one profile per signup, but
 * `profiles.family_id` has no unique constraint — nothing stops a second
 * row existing for the same family, and in practice at least one does. Take
 * the earliest-created one rather than `.maybeSingle()`, which throws on
 * more than one row and would otherwise silently drop that family's digest.
 */
export async function getFamilyProfile(familyId: string): Promise<ProfileForDigest | null> {
  const { data } = await serviceClient()
    .from('profiles')
    .select('id, family_id, email_opt_out')
    .eq('family_id', familyId)
    .order('created_at', { ascending: true })
    .limit(1);

  const row = data?.[0];
  if (!row) return null;
  return { id: row.id, familyId: row.family_id, emailOptOut: row.email_opt_out };
}

export async function setEmailOptOut(profileId: string, optOut: boolean): Promise<void> {
  const { error } = await serviceClient().from('profiles').update({ email_opt_out: optOut }).eq('id', profileId);
  if (error) throw new Error(`setting email_opt_out for profile ${profileId}: ${error.message}`);
}
