'use client';

import { useEffect, useState } from 'react';

// Mirrors src/server/db/llm-request-log.ts's LlmRequestLogDetail (as JSON
// over the wire) — local type, same convention as ObservabilityDashboard.tsx.
interface LlmRequestLogDetail {
  id: number;
  stage: string;
  provider: string;
  model: string;
  promptVersion: string | null;
  familyId: string | null;
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
        className="mt-4 w-full max-w-3xl rounded-lg border border-[var(--border)] bg-[var(--background)] p-5 shadow-xl"
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
              <Field label="Status" value={detail.status === 'ok' ? 'ok' : (detail.errorCode ?? 'error')} />
              <Field label="Tokens (in/out)" value={`${detail.inputTokens ?? '—'} / ${detail.outputTokens ?? '—'}`} />
              <Field label="Cost" value={detail.costUsd === null ? '—' : `$${detail.costUsd.toFixed(5)}`} />
              <Field label="Latency" value={`${detail.latencyMs.toLocaleString()} ms`} />
              <Field label="Time" value={new Date(detail.createdAt).toLocaleString()} />
            </dl>

            <TextBlock label="Request" text={detail.requestText} />
            <TextBlock label="Response" text={detail.responseText} />
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

function TextBlock({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-medium text-[var(--muted)]">{label}</h3>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border)] p-3 text-[11px] leading-relaxed text-[var(--muted)]">
        {text ?? '—'}
      </pre>
    </div>
  );
}
