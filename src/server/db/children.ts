import { serviceClient } from '../../lib/db/clients.js';

export interface ChildProfile {
  id: string;
  familyId: string;
  firstName: string;
  dob: string;
  grade: string;
  board: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
}

/**
 * Full profile read for the profile agent (chat-profile-agent.ts) — broader
 * than plans.ts's getChild, which only selects the columns plan generation
 * needs. Kept separate rather than widening getChild so its many existing
 * callers' shape doesn't change.
 */
export async function getChildProfile(childId: string): Promise<ChildProfile> {
  const { data, error } = await serviceClient()
    .from('children')
    .select('id, family_id, first_name, dob, grade, board, address, lat, lng, place_id')
    .eq('id', childId)
    .single();
  if (error || !data) throw new Error(`child ${childId} not found: ${error?.message ?? 'no row'}`);

  return {
    id: data.id,
    familyId: data.family_id,
    firstName: data.first_name,
    dob: data.dob,
    grade: data.grade,
    board: data.board ?? null,
    address: data.address ?? null,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    placeId: data.place_id ?? null,
  };
}

export interface FamilyChildSummary {
  id: string;
  firstName: string;
  grade: string;
  board: string | null;
}

/**
 * The whole family's roster, not just the current conversation's child —
 * grounds the profile agent for "who are my children" / "what are Arjun's
 * details" questions, which otherwise have no real data source: the
 * orchestrator's own ChildContext only ever covers the ONE child the
 * conversation is scoped to. Without this, a "list my children" question
 * gets answered from the model's own memory of the conversation instead of
 * the database — which is exactly how a child that was asked about but
 * never actually added (consent never confirmed) ended up listed as real.
 */
export async function listFamilyChildren(familyId: string): Promise<FamilyChildSummary[]> {
  const { data, error } = await serviceClient()
    .from('children')
    .select('id, first_name, grade, board')
    .eq('family_id', familyId)
    .order('first_name');
  if (error) throw new Error(`could not list children for family ${familyId}: ${error.message}`);

  return (data ?? []).map(c => ({ id: c.id, firstName: c.first_name, grade: c.grade, board: c.board ?? null }));
}

export interface ChildProfilePatch {
  firstName?: string;
  dob?: string;
  grade?: string;
  board?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
}

export async function updateChildProfile(childId: string, patch: ChildProfilePatch): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.firstName !== undefined) update.first_name = patch.firstName;
  if (patch.dob !== undefined) update.dob = patch.dob;
  if (patch.grade !== undefined) update.grade = patch.grade;
  if (patch.board !== undefined) update.board = patch.board;
  if (patch.address !== undefined) update.address = patch.address;
  if (patch.lat !== undefined) update.lat = patch.lat;
  if (patch.lng !== undefined) update.lng = patch.lng;
  if (patch.placeId !== undefined) update.place_id = patch.placeId;

  const { error } = await serviceClient().from('children').update(update).eq('id', childId);
  if (error) throw new Error(`could not update child ${childId}: ${error.message}`);
}
