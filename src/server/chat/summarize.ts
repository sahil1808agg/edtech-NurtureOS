/**
 * Formats pipeline output into a chat message. Pure formatting — no model
 * call. Findings publish immediately now (no parent/ops review gate), so
 * this describes them as final, not pending — see
 * src/server/queue/jobs/report-analyse.ts.
 */

export function buildFindingsSummaryForChat(
  findings: { kind: 'strength' | 'growth'; statement: string }[],
  honestyPath: boolean,
): string {
  if (honestyPath || findings.length === 0) {
    return "I've looked at that report, but there wasn't enough in it to stand behind a finding yet — happy to look again with a clearer copy or a different term's report.";
  }

  const lines = findings.map(f => `- ${f.kind === 'strength' ? 'Strength' : 'Developing'}: ${f.statement}`);
  return [
    `I've been through that report — here's what stood out:`,
    ...lines,
    '',
    "I'm putting together a home-activity plan from these now — you can see the report in full, or ask me about any of them here.",
  ].join('\n');
}

export function buildFailureMessageForChat(status: 'held' | 'failed'): string {
  return status === 'held'
    ? "I didn't find enough in this report to stand behind a finding — happy to look again if you upload a clearer copy or a different term's report."
    : 'Something went wrong processing that report. Mind trying the upload again?';
}

export function buildPlanSummaryForChat(
  activities: {
    title: string;
    instructions: string;
    steps: string[];
    materials: string[];
    estimatedMinutes: number;
    kind: string;
    resourceId: string | null;
  }[],
  resourceTitleById: Map<string, string> = new Map(),
): string {
  if (activities.length === 0) return "I put together a plan, but it came out empty — let me know if you'd like me to try again.";

  const home = activities.filter(a => a.kind !== 'local');
  const outside = activities.filter(a => a.kind === 'local');
  const describe = (a: (typeof activities)[number]) => {
    const resourceTitle = a.resourceId ? resourceTitleById.get(a.resourceId) : null;
    const label = resourceTitle ? `${a.title} — ${resourceTitle}` : a.title;
    const meta = `~${a.estimatedMinutes} min; ${a.materials.length ? `materials: ${a.materials.join(', ')}` : 'no materials needed'}`;
    const steps = a.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
    return `- ${label}: ${a.instructions} (${meta})\n${steps}`;
  };
  const section = (label: string, list: typeof activities) =>
    list.length ? [`${label}:`, ...list.map(describe)] : [];

  return ["Here's an updated plan:", ...section('At home', home), ...section('Outside', outside)].join('\n');
}
