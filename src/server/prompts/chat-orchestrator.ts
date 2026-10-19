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
  /** Preferences the parent has stated in chat and asked to be saved (see update_family_interests), e.g. "wants more arts activities". */
  standingPreferences: string;
  /** The child's most recent report, if any — carried through to the chat UI so it can open the evidence side panel, independent of which agent (if any) the orchestrator delegated to. */
  report: { id: string; sourceType: 'pdf' | 'photo' } | null;
}

export function buildOrchestratorSystemPrompt(ctx: ChildContext): string {
  return renderPromptTemplate('chat-orchestrator', {
    childName: ctx.childName,
    activeFindingsSummary: ctx.activeFindingsSummary,
    currentPlanSummary: ctx.currentPlanSummary,
  });
}
