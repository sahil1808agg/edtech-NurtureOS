import type { ChildContext } from './chat-orchestrator.js';
import { renderPromptTemplate } from './load-template.js';

/**
 * The report-analysis agent. Answers in terms of strengths / gaps /
 * opportunities, reframing `kind: 'strength' | 'growth'` into that
 * three-part language rather than inventing a third database category.
 * Grounded on getFindingsForChat (db/findings.ts) — the child's most recent
 * non-rejected finding set, not published-only — threaded in by
 * orchestrator-dispatch.ts as `ctx` plus a `statusNote` for the "not there
 * yet" case (src/server/chat/report-status.ts).
 *
 * Wording lives in templates/chat-report-agent.md, not here — open that
 * file to review or edit what's actually sent to the model. See
 * docs/specs/08-orchestrator-chat.md.
 */

function buildStatusBlock(statusNote: string | null): string {
  if (!statusNote) return '';
  return `\nSTATUS NOTE — there is nothing to ground a reports/findings answer on yet: ${statusNote}\nSay this plainly rather than guessing or inventing findings. Still answer anything else the parent asked using what IS in CHILD CONTEXT (e.g. an existing plan).\n`;
}

export function buildReportAgentSystemPrompt(ctx: ChildContext, statusNote: string | null): string {
  return renderPromptTemplate('chat-report-agent', {
    childName: ctx.childName,
    statusBlock: buildStatusBlock(statusNote),
    activeFindingsSummary: ctx.activeFindingsSummary,
    currentPlanSummary: ctx.currentPlanSummary,
  });
}
