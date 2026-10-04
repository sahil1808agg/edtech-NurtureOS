import type { ChildContext } from './chat-orchestrator.js';
import { renderPromptTemplate } from './load-template.js';

/**
 * The planning agent. Wraps the existing home-activity plan generation
 * (regenerate_plan, dispatch.ts — unchanged) and adds find_nearby_resources
 * (Google Places, anchored on the child's city/pincode) for nearby
 * activities/classes.
 *
 * Wording lives in templates/chat-planning-agent.md, not here — open that
 * file to review or edit what's actually sent to the model. See
 * docs/specs/08-orchestrator-chat.md.
 */

export function buildPlanningAgentSystemPrompt(ctx: ChildContext): string {
  return renderPromptTemplate('chat-planning-agent', {
    childName: ctx.childName,
    activeFindingsSummary: ctx.activeFindingsSummary,
    currentPlanSummary: ctx.currentPlanSummary,
  });
}
