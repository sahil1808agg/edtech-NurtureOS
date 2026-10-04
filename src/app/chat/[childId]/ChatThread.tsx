'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabaseBrowser } from '../../../lib/db/browser';

// Mirrors src/server/db/messages.ts's ChatMessageRow shape (as JSON over the
// wire) — kept as a local type rather than importing the server module,
// which pulls in the service-role client and must never run in the browser.
interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolResults: unknown | null;
  attachmentReportId: string | null;
  status: 'pending' | 'complete';
  createdAt: string;
}

export function ChatThread({
  childId,
  conversationId,
  initialMessages,
}: {
  childId: string;
  conversationId: string;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = payload.new as Record<string, unknown>;
          const incoming: ChatMessage = {
            id: row.id as string,
            conversationId: row.conversation_id as string,
            role: row.role as ChatMessage['role'],
            content: row.content as string,
            toolResults: row.tool_results ?? null,
            attachmentReportId: (row.attachment_report_id as string | null) ?? null,
            status: row.status as ChatMessage['status'],
            createdAt: row.created_at as string,
          };
          setMessages((prev) => {
            const existingIndex = prev.findIndex((m) => m.id === incoming.id);
            if (existingIndex === -1) return [...prev, incoming];
            const next = [...prev];
            next[existingIndex] = incoming;
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function sendMessage() {
    const content = draft.trim();
    if (!content || sending) return;

    setSending(true);
    setError(null);
    setDraft('');

    try {
      const res = await fetch(`/api/children/${childId}/chat/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const body = await res.json().catch(() => ({}));

      if (body.userMessage) setMessages((prev) => [...prev, body.userMessage]);
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
      } else if (body.assistantMessage) {
        setMessages((prev) => [...prev, body.assistantMessage]);
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSending(false);
    }
  }

  async function sendAttachment(file: File) {
    setSending(true);
    setError(null);

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch(`/api/children/${childId}/chat/attachments`, { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Upload failed (${res.status})`);
      } else if (body.pendingMessage) {
        setMessages((prev) => [...prev, body.pendingMessage]);
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-6">
      {error && <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>}

      <div className="space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === 'user'
                ? 'ml-auto max-w-[80%] rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white'
                : m.status === 'pending'
                  ? 'max-w-[80%] rounded-lg border border-dashed border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)]'
                  : 'max-w-[80%] rounded-lg border border-[var(--border)] px-4 py-2 text-sm'
            }
          >
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="mt-6 flex items-end gap-2 border-t border-[var(--border)] pt-4">
        <label className="shrink-0 cursor-pointer rounded border border-[var(--border)] px-3 py-2 text-sm">
          Attach
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) sendAttachment(file);
              e.target.value = '';
            }}
          />
        </label>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Ask about a report, or ask to update the plan…"
          rows={1}
          className="flex-1 resize-none rounded border border-[var(--border)] px-3 py-2 text-sm"
        />

        <button
          onClick={sendMessage}
          disabled={sending || !draft.trim()}
          className="shrink-0 rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
