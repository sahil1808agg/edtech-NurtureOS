import type { ChatMessageRow } from '../db/messages.js';
import type { ChatTurnMessage } from '../llm/types.js';

/**
 * Converts stored messages into the turn history callChatModel() takes.
 * Only the final user-visible text of each turn is replayed — the
 * in-request tool-call/tool-result exchange (dispatchTool loop) is ephemeral
 * and never persisted as its own row, so there is nothing to reconstruct
 * there. See docs/specs/04-grounded-general-routing.md.
 */
export function toChatHistory(rows: ChatMessageRow[]): ChatTurnMessage[] {
  return rows
    .filter((r): r is ChatMessageRow & { role: 'user' | 'assistant' } => r.role === 'user' || r.role === 'assistant')
    .map(r => ({ role: r.role, content: r.content }));
}
