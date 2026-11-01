'use client';

import { useState } from 'react';

/**
 * Expandable view of a parsed JSON value for the call detail modal: one key
 * per line, objects and arrays collapsible with a size summary, long strings
 * wrapped (and multi-line ones kept multi-line) instead of one escaped line.
 */
export function JsonTree({ value, defaultDepth = 3 }: { value: unknown; defaultDepth?: number }) {
  // The top-level object/array is shown as its entries directly — a header
  // line like "object · 8 keys" above everything adds nothing.
  if (isContainer(value) && (Array.isArray(value) ? value.length : Object.keys(value).length) > 0) {
    const entries: Array<[string, unknown]> = Array.isArray(value) ? value.map((v, i) => [`[${i}]`, v]) : Object.entries(value);
    return (
      <div className="font-mono text-[11px] leading-relaxed">
        {entries.map(([k, v]) => <Node key={k} label={k} value={v} depth={1} defaultDepth={defaultDepth} />)}
      </div>
    );
  }
  return (
    <div className="font-mono text-[11px] leading-relaxed">
      <Node value={value} depth={0} defaultDepth={defaultDepth} />
    </div>
  );
}

/** Fields that best identify an item, in order — shown next to a collapsed item so it reads as more than "2 keys". */
const PREVIEW_KEYS = ['title', 'statement', 'name', 'label', 'text', 'content', 'role', 'kind', 'id'];

const PREVIEW_CHARS = 90;

function clip(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

function preview(v: Record<string, unknown> | unknown[]): string | null {
  if (Array.isArray(v)) {
    const firsts = v.slice(0, 3).filter(x => typeof x === 'string' || typeof x === 'number');
    return firsts.length ? clip(firsts.join(', ') + (v.length > firsts.length ? ', …' : '')) : null;
  }
  for (const key of PREVIEW_KEYS) {
    const field = v[key];
    if (typeof field === 'string' && field.trim()) return clip(field);
  }
  return null;
}

function isContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return typeof v === 'object' && v !== null;
}

function summary(v: Record<string, unknown> | unknown[]): string {
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  const n = Object.keys(v).length;
  return `${n} key${n === 1 ? '' : 's'}`;
}

function Node({
  label,
  value,
  depth,
  defaultDepth,
}: {
  label?: string;
  value: unknown;
  depth: number;
  defaultDepth: number;
}) {
  const [open, setOpen] = useState(depth < defaultDepth);

  const labelEl = label !== undefined && (
    <span className="text-[var(--accent)]">{label}</span>
  );

  if (!isContainer(value)) {
    return (
      <div className="flex gap-2">
        {labelEl}
        {labelEl && <span className="text-[var(--muted)]">:</span>}
        <Leaf value={value} />
      </div>
    );
  }

  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value);

  if (entries.length === 0) {
    return (
      <div className="flex gap-2">
        {labelEl}
        {labelEl && <span className="text-[var(--muted)]">:</span>}
        <span className="text-[var(--muted)]">{Array.isArray(value) ? '[ ]' : '{ }'}</span>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-0 max-w-full items-baseline gap-2 text-left hover:opacity-80"
        aria-expanded={open}
      >
        <span className="inline-block w-3 text-[var(--muted)]" aria-hidden>{open ? '▾' : '▸'}</span>
        {labelEl ?? <span className="text-[var(--muted)]">{Array.isArray(value) ? 'list' : 'object'}</span>}
        <span className="shrink-0 text-[var(--muted)]">· {summary(value)}</span>
        {!open && preview(value) && <span className="min-w-0 truncate text-[var(--foreground)]">{preview(value)}</span>}
      </button>
      {open && (
        <div className="ml-[5px] border-l border-[var(--border)] pl-4">
          {entries.map(([k, v]) => (
            <Node key={k} label={Array.isArray(value) ? `[${k}]` : k} value={v} depth={depth + 1} defaultDepth={defaultDepth} />
          ))}
        </div>
      )}
    </div>
  );
}

function Leaf({ value }: { value: unknown }) {
  if (value === null) return <span className="text-[var(--muted)]">null</span>;
  if (typeof value === 'string') {
    // Multi-line strings (prompts, instructions) read as text, not one escaped line.
    return <span className="min-w-0 whitespace-pre-wrap break-words">{value === '' ? <span className="text-[var(--muted)]">""</span> : value}</span>;
  }
  return <span className="font-medium">{String(value)}</span>;
}
