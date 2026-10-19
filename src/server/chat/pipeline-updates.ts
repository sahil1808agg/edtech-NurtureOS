import { getConversationByChild } from '../db/conversations.js';
import { getPendingMessageForReport, appendMessage, updateMessage } from '../db/messages.js';

/**
 * Surfaces report-pipeline progress in an already-open chat tab — updates the
 * attachment's pending placeholder in place if the report came in through chat
 * (docs/specs/02-report-attachment.md), or posts a fresh message if the child
 * has a conversation but this report came from the legacy upload page. Does
 * nothing if neither exists (no chat ever opened for this child).
 *
 * Pass status 'pending' for an intermediate stage update — this keeps the
 * placeholder's animated dots going while swapping in new stage text, so a
 * parent watching the thread sees it actually moving rather than a single
 * unchanging "thinking" bubble for the full couple of minutes the pipeline
 * can take. Pass 'complete' (the default) for the terminal outcome.
 *
 * `toolResults` carries the report reference (`{ report: { id, sourceType } }`,
 * matching the orchestrator's own shape — see chat-orchestrator.ts) on the
 * terminal success update, which is what ChatThread's findReportEvidence
 * reads to show "View evidence" / the citations panel. Omit it on failure
 * and intermediate updates — there's nothing to show evidence for yet.
 * See docs/specs/05-pipeline-live-updates.md.
 */
export async function postChatUpdate(
  reportId: string,
  familyId: string,
  childId: string,
  content: string,
  status: 'pending' | 'complete' = 'complete',
  toolResults?: unknown,
): Promise<void> {
  const pending = await getPendingMessageForReport(reportId);
  if (pending) {
    await updateMessage(pending.id, { content, status, ...(toolResults !== undefined ? { toolResults } : {}) });
    return;
  }

  // No placeholder to update mid-pipeline (e.g. report came from the legacy
  // upload page, not chat) — nothing to show until there's a final outcome.
  if (status === 'pending') return;

  const conversation = await getConversationByChild(childId);
  if (conversation) {
    await appendMessage({
      conversationId: conversation.id,
      familyId,
      role: 'assistant',
      content,
      status: 'complete',
      ...(toolResults !== undefined ? { toolResults } : {}),
    });
  }
}
