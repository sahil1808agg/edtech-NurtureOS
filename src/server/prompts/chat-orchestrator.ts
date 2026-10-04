import { renderPromptTemplate } from './load-template.js';

/**
 * The orchestrator's system prompt. Identifies what the parent is actually
 * asking for, calls the matching agent(s) as tools, then writes the reply
 * the parent sees using what came back — the orchestrator writes the final
 * text, it does not just relay an agent's draft verbatim (an agent's output
 * is working material, same trust level as a tool result today). Replaces
 * chat-route.ts's classify step and chat.ts's single routed prompt.
 *
 * Wording lives in templates/chat-orchestrator.md, not here — open that file
 * to review or edit what's actually sent to the model. See
 * docs/specs/08-orchestrator-chat.md.
 */

export interface ChildContext {
  childName: string;
  /** Non-excluded findings from the child's most recent non-rejected finding set, with ids. */
  activeFindingsSummary: string;
  /** Current plan activities, with ids. */
  currentPlanSummary: string;
}

export function buildOrchestratorSystemPrompt(ctx: ChildContext): string {
  return renderPromptTemplate('chat-orchestrator', {
    childName: ctx.childName,
    activeFindingsSummary: ctx.activeFindingsSummary,
    currentPlanSummary: ctx.currentPlanSummary,
  });
}
