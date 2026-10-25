/**
 * One-off: gives every current plan that has no day-by-day schedule
 * (plans made before migration 0020) a schedule starting today, using the
 * same createScheduleForPlan() a newly generated plan gets.
 *
 *   npx tsx scripts/backfill-plan-schedules.ts            # dry run — lists plans
 *   npx tsx scripts/backfill-plan-schedules.ts --apply    # writes schedules
 */
import '../src/test/load-env.js';
import { serviceClient } from '../src/lib/db/clients.js';
import { createScheduleForPlan } from '../src/server/db/schedule.js';

const apply = process.argv.includes('--apply');
const admin = serviceClient();

const { data: plans, error } = await admin
  .from('plans')
  .select('id, child_id, cycle_no, status')
  .in('status', ['approved', 'published']);
if (error) throw new Error(`listing plans: ${error.message}`);

const { data: scheduled, error: schedError } = await admin.from('plan_activity_days').select('plan_id');
if (schedError) throw new Error(`listing schedules: ${schedError.message}`);
const hasSchedule = new Set((scheduled ?? []).map(r => r.plan_id));

const todo = (plans ?? []).filter(p => !hasSchedule.has(p.id));
console.log(`${todo.length} plan(s) without a schedule${apply ? '' : ' (dry run — pass --apply to write)'}`);

for (const p of todo) {
  if (!apply) {
    console.log(`  would schedule plan ${p.id} (child ${p.child_id}, cycle ${p.cycle_no})`);
    continue;
  }
  const source = await createScheduleForPlan(p.id);
  console.log(`  scheduled plan ${p.id} (child ${p.child_id}, cycle ${p.cycle_no}) — ${source}`);
}

process.exit(0);
