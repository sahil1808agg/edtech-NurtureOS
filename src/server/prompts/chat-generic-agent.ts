import type { ChildContext } from './chat-orchestrator.js';
import { renderPromptTemplate } from './load-template.js';

/**
 * The generic agent — the direct continuation of the old chat.ts's
 * classification: 'general' path. No tools, no grounding requirement:
 * ordinary parenting/education advice, not tied to the child's specific
 * data. Still carries the no-diagnosis/no-comparison rules, which apply
 * regardless of whether the turn is grounded.
 *
 * Wording lives in templates/chat-generic-agent.md, not here — open that
 * file to review or edit what's actually sent to the model. See
 * docs/specs/08-orchestrator-chat.md.
 */

export function buildGenericAgentSystemPrompt(ctx: ChildContext): string {
  return renderPromptTemplate('chat-generic-agent', {
    childName: ctx.childName,
  });
}
