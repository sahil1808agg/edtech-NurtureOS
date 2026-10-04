# Spec 01 — Chat conversation thread (core UI)

Implements Feature 1 of `docs/engineering/implementation-specs.md`. DB objects are in `docs/specs/supabase-schema.sql` (`conversations`, `messages`, `message_role`, `message_status`).

## Types

```ts
// src/server/db/conversations.ts
export interface Conversation {
  id: string;
  familyId: string;
  childId: string;
  createdAt: string;
}

// src/server/db/messages.ts
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
```

## DB access functions (reuse the ownership-check pattern from `src/app/api/reports/route.ts`)

```ts
// src/server/db/conversations.ts
export async function getOrCreateConversation(db: SupabaseClient, childId: string, familyId: string): Promise<Conversation>;

// src/server/db/messages.ts
export async function appendMessage(db: SupabaseClient, input: {
  conversationId: string; familyId: string; role: MessageRole; content: string;
  toolCalls?: unknown; toolResults?: unknown; attachmentReportId?: string;
  status?: MessageStatus; promptVersion?: string; modelDeployment?: string;
}): Promise<ChatMessageRow>;

export async function listMessages(db: SupabaseClient, conversationId: string, opts: { before?: string; limit?: number }): Promise<ChatMessageRow[]>;

export async function updateMessage(db: SupabaseClient, id: string, patch: Partial<Pick<ChatMessageRow,
  'content' | 'status' | 'toolResults'>>): Promise<ChatMessageRow>;
```

## API routes

```
GET  /api/children/:id/chat
  -> 200 { conversation: Conversation, messages: ChatMessageRow[] }
  Ownership check identical to src/app/api/reports/route.ts (`.eq('family_id', user.familyId)` on children).
  Creates the conversation on first call (getOrCreateConversation).

POST /api/children/:id/chat/messages
  body: { content: string }
  -> 200 { userMessage: ChatMessageRow, assistantMessage: ChatMessageRow }
  1. Ownership check (same pattern).
  2. appendMessage(role: 'user', content).
  3. Run routing + response (Spec 04) and tool dispatch (Spec 03) if triggered.
  4. appendMessage(role: 'assistant', ...).
```

## State management (client)

```ts
// src/app/(chat)/[childId]/useChatThread.ts
interface ChatThreadState {
  messages: ChatMessageRow[];
  sending: boolean;
}
// actions: sendMessage(content), sendAttachment(file) [Spec 02], receiveRealtimeUpdate(row)
```

Realtime subscription (Supabase JS client, user's own session — RLS applies):

```ts
supabase
  .channel(`messages:${conversationId}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => receiveRealtimeUpdate(payload.new))
  .subscribe();
```

## Components

- `src/app/(chat)/[childId]/page.tsx` — server component; calls `GET /api/children/:id/chat` server-side for the initial render, passes to client component.
- `src/app/(chat)/[childId]/ChatThread.tsx` — client component: message list (virtualized if long), composer, attach button (Spec 02), citation chip rendering (Spec 04), change-summary rendering (Spec 03).
- `src/app/(chat)/ChildPicker.tsx` — rendered only when `children` count > 1 for the family.

## Edge cases

- No children yet for the family → redirect to `children/new` (existing page, unchanged) before a conversation can exist.
- `GET /api/children/:id/chat` called for a child not owned by the caller's family → 404, same as every other child-scoped route today.
- Composer disabled while `sending` is true to prevent duplicate POSTs on double-click; no server-side idempotency key needed since each POST is a new user message by design.
