/**
 * Formats pipeline output into a chat message. Pure formatting — no model
 * call. Describes current state plainly; does not claim something is final
 * when it is still sitting at in_review/draft, since this revision does not
 * change when/whether pipeline-produced findings and plans are published —
 * see docs/engineering/engineering-doc.md §4 and §7. (Chat's own direct-apply
 * tools are a separate, already-implemented path — see dispatch.ts.)
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
    "These are still waiting on your review before they're final — you can look them over on the report page, or ask me about any of them here.",
  ].join('\n');
}

export function buildFailureMessageForChat(status: 'held' | 'failed'): string {
  return status === 'held'
    ? "I didn't find enough in this report to stand behind a finding — happy to look again if you upload a clearer copy or a different term's report."
    : 'Something went wrong processing that report. Mind trying the upload again?';
}

export function buildPlanSummaryForChat(activities: { title: string; instructions: string }[]): string {
  if (activities.length === 0) return "I put together a plan, but it came out empty — let me know if you'd like me to try again.";
  const lines = activities.map(a => `- ${a.title}: ${a.instructions}`);
  return ['Here\'s an updated plan:', ...lines, '', "Still waiting on your review before it's final."].join('\n');
}
