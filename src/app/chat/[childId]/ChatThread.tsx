'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { supabaseBrowser } from '../../../lib/db/browser';
import { SourceViewer } from '../../../components/SourceViewer';

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

interface EvidenceReport {
  id: string;
  sourceType: 'pdf' | 'photo';
  /** Set when opened from a specific citation rather than the generic "view evidence" state. */
  page?: number;
  label?: string | null;
}

interface EvidenceCitation {
  observationId: string;
  label: string;
  termIndex: number;
  value: string | null;
  page: number | null;
}

interface EvidenceFinding {
  id: string;
  kind: string;
  statement: string;
  citations: EvidenceCitation[];
}

// Optimistic placeholders (see sendMessage) carry an id in this namespace so
// the realtime handler can recognise and replace them in place instead of
// appending a second, real-id copy of the same message — see upsertMessage.
function isTempId(id: string): boolean {
  return id.startsWith('temp-user-') || id.startsWith('temp-thinking-');
}

function upsertMessage(list: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const index = list.findIndex((m) => m.id === incoming.id);
  if (index === -1) return [...list, incoming];
  const next = [...list];
  next[index] = incoming;
  return next;
}

// Matches each finding to the bullet point in the model's own reply that's
// actually about it, so the evidence panel can title a finding's citations
// the same way the point reads above instead of the differently-worded raw
// finding statement. Asking the model to tag this itself (a markdown link
// per bullet) turned out unreliable in practice — two different rephrasings
// of that instruction were both ignored — so this matches on text overlap
// instead: the model's bullets consistently paraphrase a finding's statement
// closely enough (often sharing exact multi-word phrases) for word overlap
// to find the right one without needing any cooperation from the model.
interface Bullet {
  title: string;
  body: string;
}

function extractBullets(content: string): Bullet[] {
  const bullets: Bullet[] = [];
  for (const para of content.split(/\n\s*\n/)) {
    const line = para.trim().replace(/^(?:\d+\.|[-*])\s+/, '');
    const m = line.match(/^\*\*(.+?)\*\*:?\s*([\s\S]*)$/);
    if (m) bullets.push({ title: m[1].replace(/:\s*$/, '').trim(), body: m[2].trim() });
  }
  return bullets;
}

const STOPWORDS = new Set(['that', 'this', 'with', 'from', 'their', 'them', 'into', 'such', 'they', 'what', 'when', 'using']);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  );
}

// Minimum shared significant words before a bullet counts as "about" a
// finding — low enough to survive paraphrasing, high enough that an
// unrelated bullet (e.g. a plan activity in the same reply) doesn't win by
// chance on a couple of generic words.
const MATCH_THRESHOLD = 3;

function matchFindingTitles(content: string, findings: EvidenceFinding[]): Map<string, string> {
  const bullets = extractBullets(content);
  const titles = new Map<string, string>();
  if (bullets.length === 0) return titles;

  for (const f of findings) {
    const findingWords = significantWords(f.statement);
    let bestBullet: Bullet | null = null;
    let bestScore = 0;
    for (const bullet of bullets) {
      const bulletWords = significantWords(bullet.body);
      let overlap = 0;
      for (const w of findingWords) if (bulletWords.has(w)) overlap += 1;
      if (overlap > bestScore) {
        bestScore = overlap;
        bestBullet = bullet;
      }
    }
    if (bestBullet && bestScore >= MATCH_THRESHOLD) titles.set(f.id, bestBullet.title);
  }
  return titles;
}

const EMPTY_TITLES: Map<string, string> = new Map();

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

// toolResults is stored as opaque JSON (see the chat route) — this only
// reads the one field we care about here and ignores the rest, rather than
// trusting the whole structure.
function findReportEvidence(toolResults: unknown): EvidenceReport | null {
  if (!toolResults || typeof toolResults !== 'object') return null;
  const report = (toolResults as { report?: unknown }).report;
  if (!report || typeof report !== 'object') return null;
  const { id, sourceType } = report as { id?: unknown; sourceType?: unknown };
  if (typeof id !== 'string' || (sourceType !== 'pdf' && sourceType !== 'photo')) return null;
  return { id, sourceType };
}

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
      className="ml-auto flex max-w-2xl items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] hover:border-[var(--accent)]"
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

// Expands the message in place to list the findings behind it and their
// page-level citations (the same data /reports/[id] shows under "Where this
// comes from"), fetched lazily on first expand. Clicking a citation opens
// the side panel at that exact page, rather than just the report generally.
function EvidenceSection({
  evidence,
  content,
  onViewEvidence,
}: {
  evidence: EvidenceReport;
  /** The message's raw markdown — matched against each finding's statement to title its citations after the card's own wording (see matchFindingTitles). */
  content: string;
  onViewEvidence: (report: EvidenceReport) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [findings, setFindings] = useState<EvidenceFinding[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const findingTitles = findings ? matchFindingTitles(content, findings) : EMPTY_TITLES;
  // The citations endpoint returns every active finding for the report, not
  // just the ones this particular reply discusses — without this, expanding
  // evidence on e.g. a "growth areas" reply would also list every strength,
  // unmatched and untitled, which is the same laundry-list problem all over
  // again. Narrow to what's actually matched; only fall back to the full set
  // when nothing matched at all (a reply with no bulleted points to match).
  const matched = findings?.filter((f) => findingTitles.has(f.id)) ?? [];
  const shownFindings = matched.length > 0 ? matched : findings;

  async function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (!next || findings !== null || loading) return;

    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/reports/${evidence.id}/citations`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setFindings(body.findings ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load evidence.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={toggle} className="text-xs underline text-[var(--accent)] hover:opacity-80">
        {expanded ? 'Hide evidence ▲' : 'View evidence →'}
      </button>

      {expanded && (
        <div className="mt-2 space-y-3 border-t border-[var(--border)] pt-2">
          {loading && <p className="text-xs text-[var(--muted)]">Loading evidence…</p>}
          {loadError && <p className="text-xs text-red-600">{loadError}</p>}
          {!loading && !loadError && shownFindings?.length === 0 && (
            <p className="text-xs text-[var(--muted)]">No citations available yet.</p>
          )}
          {!loading &&
            shownFindings?.map((f) => (
              // One card per point — each finding's own citations sit only
              // under it, collapsed by default, so expanding several points
              // at once doesn't merge their citations into one undivided
              // list (the original flat version was confusing exactly this
              // way).
              <div key={f.id} className="rounded border border-[var(--border)] p-2">
                <p className="text-xs font-semibold">{findingTitles.get(f.id) ?? f.statement}</p>
                {findingTitles.has(f.id) && <p className="mt-0.5 text-xs text-[var(--muted)]">{f.statement}</p>}
                {f.citations.length > 0 && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-[var(--muted)]">
                      Where this comes from ({f.citations.length})
                    </summary>
                    <ul className="mt-1.5 space-y-1.5">
                      {f.citations.map((c) => (
                        <li key={c.observationId}>
                          <button
                            type="button"
                            onClick={() =>
                              onViewEvidence({ id: evidence.id, sourceType: evidence.sourceType, page: c.page ?? 1, label: c.label })
                            }
                            className="text-left text-xs text-[var(--muted)] underline decoration-dotted hover:text-[var(--foreground)]"
                          >
                            <span className="font-mono">
                              Term {c.termIndex}: {c.value ?? '—'}
                            </span>
                            {c.page ? <span> · page {c.page}</span> : null}
                            <br />
                            {c.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message, onViewEvidence }: { message: ChatMessage; onViewEvidence: (report: EvidenceReport) => void }) {
  if (message.attachmentReportId && message.role === 'user') {
    return <AttachmentChip reportId={message.attachmentReportId} fileName={message.content} />;
  }

  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-2xl rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
        {message.content}
      </div>
    );
  }

  const isPending = message.status === 'pending';
  const evidence = isPending ? null : findReportEvidence(message.toolResults);

  return (
    <div
      className={
        isPending
          ? 'max-w-2xl rounded-2xl border border-dashed border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted)]'
          : 'max-w-2xl rounded-2xl border border-[var(--border)] px-4 py-2.5 text-sm'
      }
    >
      {isPending ? (
        <span className="inline-flex items-center gap-2">
          {message.content}
          <PendingDots />
        </span>
      ) : (
        <>
          <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
          {evidence && <EvidenceSection evidence={evidence} content={message.content} onViewEvidence={onViewEvidence} />}
        </>
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
  // The report currently open in the side panel — stays in chat rather than
  // navigating to /reports/[id], per the parent's request to not lose the
  // conversation when checking evidence.
  const [evidenceReport, setEvidenceReport] = useState<EvidenceReport | null>(null);
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
            // A fresh row for a message this tab itself just sent (see
            // sendMessage) can arrive over realtime before the POST response
            // does — insert into the matching optimistic placeholder's slot
            // rather than appending, or it briefly shows twice.
            if (payload.eventType === 'INSERT') {
              const tempPrefix = incoming.role === 'user' ? 'temp-user-' : 'temp-thinking-';
              const tempIndex = prev.findIndex((m) => m.id.startsWith(tempPrefix));
              if (tempIndex !== -1) {
                const next = [...prev];
                next[tempIndex] = incoming;
                return next;
              }
            }
            return upsertMessage(prev, incoming);
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

    // Shown the instant the parent hits send, before the server round-trip
    // (which runs the full orchestrator + agent loop and can take several
    // seconds) resolves — both get swapped out for the real rows below (or,
    // if realtime delivers the real rows first, by the subscription above).
    const tempUserId = `temp-user-${crypto.randomUUID()}`;
    const tempThinkingId = `temp-thinking-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const optimisticUser: ChatMessage = {
      id: tempUserId,
      conversationId,
      role: 'user',
      content,
      toolResults: null,
      attachmentReportId: null,
      status: 'complete',
      createdAt: now,
    };
    const thinking: ChatMessage = {
      id: tempThinkingId,
      conversationId,
      role: 'assistant',
      content: 'Thinking',
      toolResults: null,
      attachmentReportId: null,
      status: 'pending',
      createdAt: now,
    };

    setSending(true);
    setError(null);
    setDraft('');
    setMessages((prev) => [...prev, optimisticUser, thinking]);

    try {
      const res = await fetch(`/api/children/${childId}/chat/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const body = await res.json().catch(() => ({}));

      setMessages((prev) => {
        // Drop any temp placeholders still around, then upsert (not push) the
        // real rows — if realtime already swapped a placeholder for its real
        // row, that row's id is already present, and upserting just updates
        // it in place rather than adding a duplicate.
        let next = prev.filter((m) => m.id !== tempUserId && m.id !== tempThinkingId);
        if (body.userMessage) next = upsertMessage(next, body.userMessage);
        if (body.assistantMessage) next = upsertMessage(next, body.assistantMessage);
        return next;
      });

      if (!res.ok) setError(body.error ?? `Request failed (${res.status})`);
    } catch {
      // The request never reached the server — leave the optimistic user
      // bubble in place (it's what the parent typed) and just drop the
      // thinking indicator, since no reply is coming.
      setMessages((prev) => prev.filter((m) => m.id !== tempThinkingId));
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
          let next = prev;
          if (body.userMessage) next = upsertMessage(next, body.userMessage);
          if (body.pendingMessage) next = upsertMessage(next, body.pendingMessage);
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
    <div className={evidenceReport ? 'mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start' : 'mt-6'}>
      <div>
        {error && <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>}

        <div className="space-y-3">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} onViewEvidence={setEvidenceReport} />
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="mt-6 flex items-end gap-2 border-t border-[var(--border)] pt-4">
          <label
            className={
              sending
                ? 'shrink-0 cursor-not-allowed rounded border border-[var(--border)] px-3 py-2 text-sm opacity-50'
                : 'shrink-0 cursor-pointer rounded border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)]'
            }
          >
            {sending ? 'Uploading…' : 'Attach'}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="hidden"
              disabled={sending}
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

      {evidenceReport && (
        <SourceViewer
          reportId={evidenceReport.id}
          isPdf={evidenceReport.sourceType === 'pdf'}
          initialPage={evidenceReport.page ?? 1}
          initialLabel={evidenceReport.label}
          onClose={() => setEvidenceReport(null)}
        />
      )}
    </div>
  );
}
