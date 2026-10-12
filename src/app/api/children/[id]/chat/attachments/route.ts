import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../../lib/db/server';
import { ConsentError } from '../../../../../../server/consent/policy';
import { ingestReport, IngestValidationError } from '../../../../../../server/reports/ingest';
import { getOrCreateConversation } from '../../../../../../server/db/conversations';
import { appendMessage } from '../../../../../../server/db/messages';

export const runtime = 'nodejs';

/** Report upload as a chat attachment. Reuses the exact ingestReport() path the legacy upload route calls. See docs/specs/02-report-attachment.md. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: childId } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: child } = await db
    .from('children')
    .select('id, family_id')
    .eq('id', childId)
    .eq('family_id', user.familyId)
    .maybeSingle();

  if (!child) return NextResponse.json({ error: 'Child not found' }, { status: 404 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });

  try {
    const { reportId } = await ingestReport({ childId, familyId: child.family_id, file });

    const conversation = await getOrCreateConversation(childId, child.family_id);

    // Represents what the parent actually uploaded in the thread — without
    // this, only the assistant's "Looking at this now…" placeholder ever
    // showed up, with no trace of the file itself. file.name is the only
    // filename we have (reports stores a storage_path, not an original
    // name), so it's carried on this message rather than looked up later.
    const userMessage = await appendMessage({
      conversationId: conversation.id,
      familyId: child.family_id,
      role: 'user',
      content: file.name,
      attachmentReportId: reportId,
    });

    const pendingMessage = await appendMessage({
      conversationId: conversation.id,
      familyId: child.family_id,
      role: 'assistant',
      content: 'Looking at this report now…',
      status: 'pending',
      attachmentReportId: reportId,
    });

    return NextResponse.json({ reportId, userMessage, pendingMessage }, { status: 202 });
  } catch (err) {
    if (err instanceof IngestValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof ConsentError) {
      return NextResponse.json(
        { error: 'No live consent to analyse this child\'s reports.', reason: err.reason },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 });
  }
}
