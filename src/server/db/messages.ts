import { serviceClient } from '../../lib/db/clients.js';

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'pending' | 'complete';

export interface ChatMessageRow {
  id: string;
  conversationId: string;
  familyId: string;
  role: MessageRole;
  content: string;
  toolCalls: unknown | null;
  toolResults: unknown | null;
  attachmentReportId: string | null;
  status: MessageStatus;
  routeClassification: 'grounded' | 'general' | 'mixed' | null;
  promptVersion: string | null;
  modelDeployment: string | null;
  createdAt: string;
}

const COLUMNS =
  'id, conversation_id, family_id, role, content, tool_calls, tool_results, attachment_report_id, status, route_classification, prompt_version, model_deployment, created_at';

interface MessageRowDb {
  id: string;
  conversation_id: string;
  family_id: string;
  role: MessageRole;
  content: string;
  tool_calls: unknown | null;
  tool_results: unknown | null;
  attachment_report_id: string | null;
  status: MessageStatus;
  route_classification: 'grounded' | 'general' | 'mixed' | null;
  prompt_version: string | null;
  model_deployment: string | null;
  created_at: string;
}

function fromRow(row: MessageRowDb): ChatMessageRow {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    familyId: row.family_id,
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls,
    toolResults: row.tool_results,
    attachmentReportId: row.attachment_report_id,
    status: row.status,
    routeClassification: row.route_classification,
    promptVersion: row.prompt_version,
    modelDeployment: row.model_deployment,
    createdAt: row.created_at,
  };
}

export interface AppendMessageInput {
  conversationId: string;
  familyId: string;
  role: MessageRole;
  content: string;
  toolCalls?: unknown;
  toolResults?: unknown;
  attachmentReportId?: string;
  status?: MessageStatus;
  routeClassification?: 'grounded' | 'general' | 'mixed';
  promptVersion?: string;
  modelDeployment?: string;
}

export async function appendMessage(input: AppendMessageInput): Promise<ChatMessageRow> {
  const { data, error } = await serviceClient()
    .from('messages')
    .insert({
      conversation_id: input.conversationId,
      family_id: input.familyId,
      role: input.role,
      content: input.content,
      tool_calls: input.toolCalls ?? null,
      tool_results: input.toolResults ?? null,
      attachment_report_id: input.attachmentReportId ?? null,
      status: input.status ?? 'complete',
      route_classification: input.routeClassification ?? null,
      prompt_version: input.promptVersion ?? null,
      model_deployment: input.modelDeployment ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error || !data) throw new Error(`appending message to conversation ${input.conversationId}: ${error?.message}`);
  return fromRow(data);
}

export async function listMessages(
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<ChatMessageRow[]> {
  let query = serviceClient()
    .from('messages')
    .select(COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? 50);

  if (opts.before) query = query.lt('created_at', opts.before);

  const { data, error } = await query;
  if (error) throw new Error(`listing messages for conversation ${conversationId}: ${error.message}`);
  return (data ?? []).map(fromRow);
}

export async function updateMessage(
  id: string,
  patch: Partial<Pick<ChatMessageRow, 'content' | 'status' | 'toolResults'>>,
): Promise<ChatMessageRow> {
  const update: Record<string, unknown> = {};
  if (patch.content !== undefined) update.content = patch.content;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.toolResults !== undefined) update.tool_results = patch.toolResults;

  const { data, error } = await serviceClient().from('messages').update(update).eq('id', id).select(COLUMNS).single();
  if (error || !data) throw new Error(`updating message ${id}: ${error?.message}`);
  return fromRow(data);
}

/** The most recently attached report in a conversation, regardless of status — for the report-analysis agent's "not there yet" case (docs/specs/08-orchestrator-chat.md). */
export async function getLatestAttachedReportId(conversationId: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from('messages')
    .select('attachment_report_id')
    .eq('conversation_id', conversationId)
    .not('attachment_report_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.attachment_report_id ?? null;
}

/** The oldest unresolved placeholder for a given report attachment — see docs/specs/05-pipeline-live-updates.md. */
export async function getPendingMessageForReport(reportId: string): Promise<ChatMessageRow | null> {
  const { data } = await serviceClient()
    .from('messages')
    .select(COLUMNS)
    .eq('attachment_report_id', reportId)
    .eq('status', 'pending')
    .maybeSingle();

  return data ? fromRow(data) : null;
}
