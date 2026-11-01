'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { formatNumber, formatDateTime } from './format';
import { JsonTree } from './JsonTree';

// Mirrors src/server/db/llm-request-log.ts's LlmRequestLogDetail (as JSON
// over the wire) — local type, same convention as ObservabilityDashboard.tsx.
interface LlmRequestLogDetail {
  id: number;
  stage: string;
  provider: string;
  model: string;
  promptVersion: string | null;
  familyId: string | null;
  requestId: string | null;
  status: 'ok' | 'error';
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  createdAt: string;
  requestText: string | null;
  responseText: string | null;
}

export function CallDetailModal({ callId, onClose }: { callId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<LlmRequestLogDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);

    fetch(`/api/observability/calls/${callId}`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then(json => { if (!cancelled) setDetail(json); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load'); });

    return () => { cancelled = true; };
  }, [callId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="mt-4 w-full max-w-5xl rounded-lg border border-[var(--border)] bg-[var(--background)] p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-sm font-semibold">Call #{callId}</h2>
          <button onClick={onClose} className="text-xs text-[var(--muted)] hover:underline">Close</button>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {!detail && !error && <p className="mt-3 text-sm text-[var(--muted)]">Loading…</p>}

        {detail && (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-3">
              <Field label="Stage" value={detail.stage} />
              <Field label="Provider / model" value={`${detail.provider}/${detail.model}`} />
              <Field label="Prompt version" value={detail.promptVersion ?? '—'} />
              <Field label="Family" value={detail.familyId ?? '—'} />
              <Field label="Workflow" value={detail.requestId ?? '—'} />
              <Field label="Status" value={detail.status === 'ok' ? 'ok' : (detail.errorCode ?? 'error')} />
              <Field label="Tokens (in/out)" value={`${detail.inputTokens ?? '—'} / ${detail.outputTokens ?? '—'}`} />
              <Field label="Cost" value={detail.costUsd === null ? '—' : `$${detail.costUsd.toFixed(5)}`} />
              <Field label="Latency" value={`${formatNumber(detail.latencyMs)} ms`} />
              <Field label="Time" value={formatDateTime(detail.createdAt)} />
            </dl>

            <RequestView raw={detail.requestText} />
            <ResponseView raw={detail.responseText} isError={detail.status === 'error'} />
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="mt-0.5 break-all font-medium">{value}</dd>
    </div>
  );
}

// ---------- Structured request / response views ----------
//
// Logged requests are one JSON string per call: {system, user} for pipeline
// stages (where `user` is itself JSON inside a string) and {system, history,
// tools} for chat stages. Responses are a JSON object ({activities},
// {content, toolCalls}, ...) or, for a failed call, plain error text. These
// views decode all of that into labelled sections; "Raw" still shows the
// exact logged text.

/** logLlmRequest() cuts text at 100,000 chars and appends this marker. */
const TRUNCATION_MARKER = /\n…\[truncated, (\d+) chars total\]$/;

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** A string that is itself JSON (the pipeline stages' `user` message) → its parsed value. */
function parseNested(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return value;
  const parsed = tryParse(t);
  return parsed.ok ? parsed.value : value;
}

/**
 * From a request cut off mid-JSON, recover the leading "system" string —
 * it comes first, so it's usually intact even when the input after it isn't.
 */
function recoverSystemPrompt(raw: string): string | null {
  const prefix = '{"system":"';
  if (!raw.startsWith(prefix)) return null;
  for (let i = prefix.length; i < raw.length; i++) {
    if (raw[i] === '\\') { i++; continue; }
    if (raw[i] === '"') {
      const decoded = tryParse(raw.slice(prefix.length - 1, i + 1));
      return decoded.ok && typeof decoded.value === 'string' ? decoded.value : null;
    }
  }
  return null;
}

function Section({ title, raw, children }: { title: string; raw: string | null; children: React.ReactNode }) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!raw) return;
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (permissions, insecure context) — Raw still shows the text.
    }
  }

  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] pb-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</h3>
        {raw && (
          <div className="flex items-center gap-3 text-[11px]">
            <button type="button" onClick={() => setShowRaw(r => !r)} className="text-[var(--muted)] hover:underline">
              {showRaw ? 'Formatted' : 'Raw'}
            </button>
            <button type="button" onClick={copy} className="text-[var(--muted)] hover:underline">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
      {showRaw ? (
        <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border)] p-3 font-mono text-[11px] leading-relaxed">
          {raw}
        </pre>
      ) : (
        <div className="mt-2 space-y-4">{children}</div>
      )}
    </section>
  );
}

function Part({ label, meta, children }: { label: string; meta?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium">
        {label}
        {meta && <span className="ml-2 font-normal text-[var(--muted)]">{meta}</span>}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Long text, collapsed to a fixed height with a toggle — system prompts run to several thousand characters. */
function LongText({ text }: { text: string }) {
  const long = text.length > 1200;
  const [expanded, setExpanded] = useState(!long);
  return (
    <div>
      <pre
        className={`overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border)] p-3 font-mono text-[11px] leading-relaxed ${expanded ? 'max-h-[40rem]' : 'max-h-40'}`}
      >
        {text}
      </pre>
      {long && (
        <button type="button" onClick={() => setExpanded(e => !e)} className="mt-1 text-[11px] text-[var(--muted)] hover:underline">
          {expanded ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-xs leading-relaxed [&_li]:ml-4 [&_ol]:list-decimal [&_strong]:font-semibold [&_ul]:list-disc">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

/** Chat history can run to dozens of turns; the latest ones are what the call was about. */
const RECENT_MESSAGES = 6;

function Conversation({ messages }: { messages: unknown[] }) {
  const [showAll, setShowAll] = useState(messages.length <= RECENT_MESSAGES);
  const hidden = showAll ? 0 : messages.length - RECENT_MESSAGES;
  const visible = showAll ? messages : messages.slice(-RECENT_MESSAGES);

  return (
    <ol className="space-y-2">
      {hidden > 0 && (
        <li>
          <button type="button" onClick={() => setShowAll(true)} className="text-[11px] text-[var(--muted)] hover:underline">
            Show {hidden} earlier message{hidden === 1 ? '' : 's'}
          </button>
        </li>
      )}
      {visible.map((m, i) => {
        const msg = (m ?? {}) as { role?: unknown; content?: unknown };
        const role = typeof msg.role === 'string' ? msg.role : 'message';
        const isUser = role === 'user';
        return (
          <li key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg border px-3 py-2 ${isUser ? 'border-[var(--accent)]/40 bg-[var(--accent)]/5' : 'border-[var(--border)]'}`}
            >
              <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{role}</p>
              {typeof msg.content === 'string'
                ? <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed">{msg.content}</p>
                : <div className="mt-1"><JsonTree value={msg.content} defaultDepth={1} /></div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function RequestView({ raw }: { raw: string | null }) {
  if (!raw) {
    return <Section title="Request" raw={null}><p className="text-xs text-[var(--muted)]">Not logged.</p></Section>;
  }

  const truncation = raw.match(TRUNCATION_MARKER);
  const parsed = tryParse(raw);

  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
    const system = recoverSystemPrompt(raw);
    return (
      <Section title="Request" raw={raw}>
        {truncation && (
          <p className="rounded border border-[var(--border)] p-2 text-[11px] text-[var(--muted)]">
            This request was cut off when it was logged ({formatNumber(Number(truncation[1]))} characters; the log keeps
            the first 100,000), so only part of it can be shown. Use Raw to see everything that was kept.
          </p>
        )}
        {system
          ? <Part label="System prompt" meta={`${formatNumber(system.length)} chars`}><LongText text={system} /></Part>
          : <LongText text={raw} />}
      </Section>
    );
  }

  const { system, user, history, tools, ...rest } = parsed.value as Record<string, unknown>;
  const input = parseNested(user);

  return (
    <Section title="Request" raw={raw}>
      {typeof system === 'string' && (
        <Part label="System prompt" meta={`${formatNumber(system.length)} chars`}><LongText text={system} /></Part>
      )}
      {user !== undefined && (
        <Part label="Input">
          {typeof input === 'string'
            ? <LongText text={input} />
            : <div className="rounded border border-[var(--border)] p-3"><JsonTree value={input} /></div>}
        </Part>
      )}
      {Array.isArray(history) && (
        <Part label="Conversation" meta={`${history.length} message${history.length === 1 ? '' : 's'}`}>
          <Conversation messages={history} />
        </Part>
      )}
      {Array.isArray(tools) && tools.length > 0 && (
        <Part label="Tools available">
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t, i) => (
              <span key={i} className="rounded border border-[var(--border)] px-2 py-0.5 font-mono text-[11px]">
                {typeof t === 'string' ? t : (t as { name?: string } | null)?.name ?? JSON.stringify(t)}
              </span>
            ))}
          </div>
        </Part>
      )}
      {Object.keys(rest).length > 0 && (
        <Part label="Other fields">
          <div className="rounded border border-[var(--border)] p-3"><JsonTree value={rest} /></div>
        </Part>
      )}
    </Section>
  );
}

function ResponseView({ raw, isError }: { raw: string | null; isError: boolean }) {
  if (!raw) {
    return <Section title="Response" raw={null}><p className="text-xs text-[var(--muted)]">No response.</p></Section>;
  }

  const parsed = tryParse(raw);

  if (!parsed.ok) {
    return (
      <Section title="Response" raw={raw}>
        {isError ? (
          <p className="whitespace-pre-wrap break-words rounded border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {raw}
          </p>
        ) : (
          <LongText text={raw} />
        )}
      </Section>
    );
  }

  const value = parsed.value;
  const isChat = typeof value === 'object' && value !== null && !Array.isArray(value) && 'content' in value;

  if (isChat) {
    const { content, toolCalls } = value as { content?: unknown; toolCalls?: unknown };
    const calls = Array.isArray(toolCalls) ? toolCalls : [];
    const hasText = typeof content === 'string' && content.trim() !== '';
    return (
      <Section title="Response" raw={raw}>
        {hasText && (
          <Part label="Reply">
            <div className="rounded border border-[var(--border)] p-3"><Markdown text={content as string} /></div>
          </Part>
        )}
        {calls.length > 0 && (
          <Part label="Tool calls" meta={`${calls.length}`}>
            <ol className="space-y-2">
              {calls.map((c, i) => {
                const call = (c ?? {}) as { name?: unknown; arguments?: unknown; args?: unknown; input?: unknown };
                const args = parseNested(call.arguments ?? call.args ?? call.input);
                return (
                  <li key={i} className="rounded border border-[var(--border)] p-3">
                    <p className="font-mono text-[11px] font-semibold">{typeof call.name === 'string' ? call.name : `call ${i + 1}`}</p>
                    {args !== undefined && <div className="mt-1.5"><JsonTree value={args} /></div>}
                  </li>
                );
              })}
            </ol>
          </Part>
        )}
        {!hasText && calls.length === 0 && <p className="text-xs text-[var(--muted)]">Empty reply.</p>}
      </Section>
    );
  }

  return (
    <Section title="Response" raw={raw}>
      <div className="rounded border border-[var(--border)] p-3"><JsonTree value={value} /></div>
    </Section>
  );
}
