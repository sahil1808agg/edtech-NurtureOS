import { serviceClient } from '../../lib/db/clients.js';

export interface Conversation {
  id: string;
  familyId: string;
  childId: string;
  createdAt: string;
}

function fromRow(row: { id: string; family_id: string; child_id: string; created_at: string }): Conversation {
  return { id: row.id, familyId: row.family_id, childId: row.child_id, createdAt: row.created_at };
}

/** One conversation per child. Creates it on first use — see docs/specs/01-chat-thread.md. */
export async function getOrCreateConversation(childId: string, familyId: string): Promise<Conversation> {
  const { data: existing } = await serviceClient()
    .from('conversations')
    .select('id, family_id, child_id, created_at')
    .eq('child_id', childId)
    .maybeSingle();

  if (existing) return fromRow(existing);

  const { data: created, error } = await serviceClient()
    .from('conversations')
    .insert({ family_id: familyId, child_id: childId })
    .select('id, family_id, child_id, created_at')
    .single();

  if (error || !created) throw new Error(`creating conversation for child ${childId}: ${error?.message}`);
  return fromRow(created);
}

export async function getConversationByChild(childId: string): Promise<Conversation | null> {
  const { data } = await serviceClient()
    .from('conversations')
    .select('id, family_id, child_id, created_at')
    .eq('child_id', childId)
    .maybeSingle();

  return data ? fromRow(data) : null;
}
