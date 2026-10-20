import { getChild, getCurrentPlan, getFamilyConstraints } from '../db/plans.js';
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
  const [findings, plan, constraints, report] = await Promise.all([
    getFindingsForChat(childId),
    getCurrentPlan(childId),
    getFamilyConstraints(child.familyId),
    getLatestReportForChat(childId),
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

  return {
    childName: child.firstName,
    activeFindingsSummary,
    currentPlanSummary,
    standingPreferences: constraints.otherConstraints ?? '(none stated yet)',
    report,
  };
}
