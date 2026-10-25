import { getChild, getCurrentPlan, getFamilyConstraints } from '../db/plans.js';
import { getScheduleForDay, todayISODate } from '../db/schedule.js';
import { getFindingsForChat, getLatestReportForChat } from '../db/findings.js';
import type { ChildContext } from '../prompts/chat-orchestrator.js';

/**
 * Builds the CHILD CONTEXT block every agent is grounded in — active
 * findings and the current plan, both with ids so an agent can target them
 * with tools. Loaded once per turn and threaded to the orchestrator and
 * every agent it calls, not reloaded per agent call. See
 * docs/specs/08-orchestrator-chat.md (supersedes
 * docs/specs/04-grounded-general-routing.md's version of this file).
 */
export async function loadChildContext(childId: string): Promise<ChildContext> {
  const child = await getChild(childId);
  const [findings, plan, constraints, report, today] = await Promise.all([
    getFindingsForChat(childId),
    getCurrentPlan(childId),
    getFamilyConstraints(child.familyId),
    getLatestReportForChat(childId),
    getScheduleForDay(childId),
  ]);

  const activeFindingsSummary = findings.length
    ? findings.map(f => `- [${f.id}] ${f.statement}`).join('\n')
    : '(no active findings yet)';

  const currentPlanSummary = plan
    ? plan.activities
        .map(a => {
          const tags = `${a.declined ? ' (declined)' : ''}${a.completed ? ' (done)' : ''}`;
          const meta = [
            a.estimatedMinutes != null ? `~${a.estimatedMinutes} min` : null,
            a.materials.length ? `materials: ${a.materials.join(', ')}` : 'no materials needed',
          ].join('; ');
          const steps = a.steps.map((s, i) => `    ${i + 1}. ${s}`).join('\n');
          return `- [${a.id}] ${a.title}${tags}: ${a.instructions} (${meta})\n${steps}`;
        })
        .join('\n')
    : '(no plan yet)';

  // The plan is the two-week set; "today" is only what the schedule puts on
  // today's date (db/schedule.ts). Spelled out so "what's for today?" is
  // answered from the schedule, not from the whole plan.
  const todayDate = todayISODate();
  let todaySummary = '';
  if (plan && today && today.activities.length > 0) {
    const range = today.endsOn ? `; plan runs ${today.startsOn} to ${today.endsOn}` : '';
    const lines = today.activities.map(a => {
      const tag = a.dayStatus === 'done' ? ' (done today)' : a.dayStatus === 'skipped' ? ' (skipped today)' : '';
      return `- [${a.id}] ${a.title}${tag}`;
    });
    todaySummary = `\n\nSCHEDULED FOR TODAY (${todayDate}${range}):\n${lines.join('\n')}`;
  } else if (plan) {
    const finished = today?.endsOn != null && today.endsOn < todayDate;
    todaySummary = `\n\nSCHEDULED FOR TODAY (${todayDate}): nothing — ${finished ? 'the plan has finished' : 'a rest day'}.`;
  }

  return {
    childName: child.firstName,
    activeFindingsSummary,
    currentPlanSummary: currentPlanSummary + todaySummary,
    standingPreferences: constraints.otherConstraints ?? '(none stated yet)',
    report,
  };
}
