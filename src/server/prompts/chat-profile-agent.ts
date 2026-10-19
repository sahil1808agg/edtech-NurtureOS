import { renderPromptTemplate } from './load-template.js';
import type { ChildProfile, FamilyChildSummary } from '../db/children.js';

/**
 * The profile agent — lets a parent update the child's name, date of birth,
 * grade/class, curriculum board, or home location from chat, via the single
 * update_child_profile tool (src/server/chat/tools.ts, dispatch.ts). Grounded
 * on the child's current profile (not the shared ChildContext, which only
 * carries findings/plan) so it can state current values and confirm exactly
 * what changed.
 *
 * Also grounded on the FULL family roster (every child, not just this
 * conversation's), loaded fresh each turn — without this, "who are my
 * children" / "is Arjun on file" has no real data source, and the model
 * falls back on its own memory of the conversation, which can include a
 * child that was discussed but never actually added. See
 * db/children.ts:listFamilyChildren.
 *
 * Wording lives in templates/chat-profile-agent.md, not here — open that
 * file to review or edit what's actually sent to the model. See
 * docs/specs/08-orchestrator-chat.md.
 */

function formatCurrentProfile(profile: ChildProfile): string {
  const lines = [
    `Name: ${profile.firstName}`,
    `Date of birth: ${profile.dob}`,
    `Grade/class: ${profile.grade}`,
    `Board: ${profile.board ?? '(not set)'}`,
    `Location: ${profile.address ?? '(not set)'}`,
  ];
  return lines.join('\n');
}

function formatFamilyChildren(children: FamilyChildSummary[]): string {
  if (children.length === 0) return '(none on file)';
  return children.map(c => `- ${c.firstName} — ${c.grade}${c.board ? `, ${c.board}` : ''}`).join('\n');
}

export function buildProfileAgentSystemPrompt(
  childName: string,
  profile: ChildProfile,
  familyChildren: FamilyChildSummary[],
): string {
  return renderPromptTemplate('chat-profile-agent', {
    childName,
    currentProfile: formatCurrentProfile(profile),
    familyChildren: formatFamilyChildren(familyChildren),
  });
}
