'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The original report, pinned beside the findings.
 *
 * Citations elsewhere on the page carry data-source-page / data-source-label;
 * a delegated listener picks those up, so the findings themselves stay server
 * rendered and only this pane is interactive.
 *
 * The page is changed by reloading the iframe with a fresh query string rather
 * than by setting the hash. The file route redirects to a signed URL on
 * Supabase, so the loaded document is cross-origin and its location cannot be
 * scripted; a hash-only change would not move an already-loaded PDF.
 */
export function SourceViewer({
  reportId,
  isPdf,
  initialPage = 1,
  initialLabel,
  onClose,
}: {
  reportId: string;
  isPdf: boolean;
  initialPage?: number;
  initialLabel?: string | null;
  /** Shows a "Close" control next to the header — for callers that render this in a dismissible panel (e.g. the chat side panel) rather than a page-permanent pane. */
  onClose?: () => void;
}) {
  const [page, setPage] = useState(initialPage);
  const [label, setLabel] = useState<string | null>(initialLabel ?? null);
  const paneRef = useRef<HTMLDivElement>(null);

  // The reports page sets initialPage once and never again (its own
  // data-source-page clicks below move the pane instead). The chat side
  // panel reuses this same mounted instance for every citation the parent
  // clicks, though, passing a new initialPage/initialLabel each time — sync
  // to those so a later citation click actually moves an already-open pane.
  useEffect(() => {
    setPage(initialPage);
    setLabel(initialLabel ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, initialPage, initialLabel]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const el = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-source-page]');
      if (!el) return;

      const next = Number(el.dataset.sourcePage);
      if (!Number.isFinite(next) || next < 1) return;

      event.preventDefault();
      setPage(next);
      setLabel(el.dataset.sourceLabel ?? null);

      // On a narrow screen the panes stack, so bring the viewer into view.
      if (window.matchMedia('(max-width: 1023px)').matches) {
        paneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // pagemode=none hides the thumbnail rail, which otherwise eats half of a
  // narrow pane; view=FitH fills the width rather than defaulting to ~27%.
  // The ?p= is only there to make each page a distinct URL, so the iframe
  // remounts and honours the fragment; the response is cached, so this does not
  // refetch the file each time.
  const src = `/api/reports/${reportId}/file?p=${page}#page=${page}&navpanes=0&view=FitH`;

  return (
    <div ref={paneRef} className="lg:sticky lg:top-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          The original report
        </h2>
        <span className="flex items-center gap-3">
          <a href={src} target="_blank" rel="noreferrer" className="text-xs underline text-[var(--muted)]">
            Open full size
          </a>
          {onClose && (
            <button type="button" onClick={onClose} className="text-xs underline text-[var(--muted)]">
              Close
            </button>
          )}
        </span>
      </div>

      <p className="mt-1 text-xs text-[var(--muted)]">
        {label ? <>Page {page} — looking for: <strong>{label}</strong></> : <>Showing page {page}.</>}
      </p>

      {isPdf ? (
        <iframe
          key={src}
          src={src}
          title="Original report"
          className="mt-2 h-[70vh] min-h-[520px] w-full rounded border border-[var(--border)]"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="Original report"
          className="mt-2 w-full rounded border border-[var(--border)]"
        />
      )}

      <p className="mt-2 text-xs text-[var(--muted)]">
        We record which page a value came from, not its position on it, so you may need to scan for
        the row.
      </p>
    </div>
  );
}
