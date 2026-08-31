import { serviceClient } from '../../lib/db/clients.js';
import type { CheckinDecision } from '../pipeline/checkin.js';

export interface CheckinRow {
  id: string;
  planId: string;
  activitiesDone: number;
  note: string | null;
  concernRaised: boolean;
}

export async function getCheckin(checkinId: string): Promise<CheckinRow> {
  const { data, error } = await serviceClient()
    .from('checkins')
    .select('id, plan_id, activities_done, response_note, concern_raised')
    .eq('id', checkinId)
    .single();

  if (error || !data) throw new Error(`checkin ${checkinId} not found: ${error?.message ?? 'no row'}`);
  if (data.activities_done === null) throw new Error(`checkin ${checkinId} has not been responded to yet`);

  return {
    id: data.id,
    planId: data.plan_id,
    activitiesDone: data.activities_done as number,
    note: data.response_note,
    concernRaised: data.concern_raised,
  };
}

/**
 * How many activities the parent was actually asked to do. Declined activities
 * are excluded: counting them would put "advance" out of reach for a plan the
 * parent had already trimmed.
 */
export async function countPlanActivities(planId: string): Promise<number> {
  const { count, error } = await serviceClient()
    .from('plan_activities')
    .select('*', { count: 'exact', head: true })
    .eq('plan_id', planId)
    .eq('declined', false);

  if (error) throw new Error(`counting activities for plan ${planId}: ${error.message}`);
  return count ?? 0;
}

export async function saveCheckinDecision(checkinId: string, decision: CheckinDecision): Promise<void> {
  const { error } = await serviceClient().from('checkins').update({ decision }).eq('id', checkinId);
  if (error) throw new Error(`saving decision for checkin ${checkinId}: ${error.message}`);
}
