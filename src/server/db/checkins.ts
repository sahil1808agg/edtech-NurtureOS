import { serviceClient } from '../../lib/db/clients.js';
import type { CheckinDecision } from '../pipeline/checkin.js';

export interface CheckinRow {
  id: string;
  activitiesDone: 0 | 1 | 2 | 3;
  note: string | null;
  concernRaised: boolean;
}

export async function getCheckin(checkinId: string): Promise<CheckinRow> {
  const { data, error } = await serviceClient()
    .from('checkins')
    .select('id, activities_done, response_note, concern_raised')
    .eq('id', checkinId)
    .single();

  if (error || !data) throw new Error(`checkin ${checkinId} not found: ${error?.message ?? 'no row'}`);
  if (data.activities_done === null) throw new Error(`checkin ${checkinId} has not been responded to yet`);

  return {
    id: data.id,
    activitiesDone: data.activities_done as 0 | 1 | 2 | 3,
    note: data.response_note,
    concernRaised: data.concern_raised,
  };
}

export async function saveCheckinDecision(checkinId: string, decision: CheckinDecision): Promise<void> {
  const { error } = await serviceClient().from('checkins').update({ decision }).eq('id', checkinId);
  if (error) throw new Error(`saving decision for checkin ${checkinId}: ${error.message}`);
}
