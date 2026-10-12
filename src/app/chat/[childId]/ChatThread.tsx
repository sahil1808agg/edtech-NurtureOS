'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
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

// Assistant replies are markdown (lists, bold, etc.) — rendered with the
// app's own palette rather than a generic "prose" stylesheet, since no
// typography plugin is installed. Parent-typed text is never run through
// this (see the plain-text branch in the message list below).
const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  // The model's lists are often "loose" (blank line between items), which
  // makes remark wrap each item's text in its own <p> — zero that
  // paragraph's margin so spacing comes only from the list's own space-y-1.
  li: ({ children }) => <li className="leading-relaxed [&>p]:mb-0">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-[var(--accent)] hover:opacity-80">
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-[var(--border)]/50 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-[var(--border)] pl-3 italic text-[var(--muted)] last:mb-0">{children}</blockquote>
  ),
  h1: ({ children }) => <p className="mb-1 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="mb-1 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mb-1 font-semibold">{children}</p>,
};

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function AttachmentChip({ reportId, fileName }: { reportId: string; fileName: string }) {
  return (
    <Link
      href={`/reports/${reportId}`}
      className="ml-auto flex max-w-[80%] items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] hover:border-[var(--accent)]"
    >
      <PaperclipIcon />
      <span className="truncate">{fileName}</span>
    </Link>
  );
}

function PendingDots() {
  return (
    <span className="inline-flex gap-1 align-middle">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)] [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)] [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)]" />
    </span>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.attachmentReportId && message.role === 'user') {
    return <AttachmentChip reportId={message.attachmentReportId} fileName={message.content} />;
  }

  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[80%] rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
        {message.content}
      </div>
    );
  }

  const isPending = message.status === 'pending';

  return (
    <div
      className={
        isPending
          ? 'max-w-[80%] rounded-2xl border border-dashed border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted)]'
          : 'max-w-[80%] rounded-2xl border border-[var(--border)] px-4 py-2.5 text-sm'
      }
    >
      {isPending ? (
        <span className="inline-flex items-center gap-2">
          {message.content}
          <PendingDots />
        </span>
      ) : (
        <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
      )}
    </div>
  );
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
      } else {
        setMessages((prev) => {
          const next = [...prev];
          if (body.userMessage) next.push(body.userMessage);
          if (body.pendingMessage) next.push(body.pendingMessage);
          return next;
        });
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

      <div className="space-y-3">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="mt-6 flex items-end gap-2 border-t border-[var(--border)] pt-4">
        <label className="shrink-0 cursor-pointer rounded border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)]">
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
