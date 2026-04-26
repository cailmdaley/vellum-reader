/**
 * PaperModal — vellum-native paper-evidence modal.
 *
 * Sibling-and-replacement of `paper-viewer.js`'s `openPaperModal`. Same
 * split-pane idea (PDF on the left, insights rail on the right), brought
 * into vellum's component world so:
 *
 *   1. The PDF renders through vellum's `PdfReader` (lazy pdfjs, fits
 *      container width, hi-DPI-aware) — retiring paper-viewer.js's
 *      duplicate pdfjs render path. This is the per-user-comment stake in
 *      the ground for Stage 5: "vellum has a PDF reader, use it." See the
 *      constitution at `vellum-reader/vellum-native-astra-renderer`.
 *
 *   2. The insights rail mirrors `mountInsightsRail` row shape — claim,
 *      quote, page link, "Informs <decision>" pills — but reuses the same
 *      `<DecisionPills>` and `PaperCitation`-friendly structure the inline
 *      Insights section already uses (Stage 3). Same data substrate, two
 *      surfaces: the readable section + this modal.
 *
 * Open state lives in `AstraPaperView` and is opened by clicking any
 * `<PaperCitation>` row (under `Evidence` and `InsightsList`). The modal
 * closes on Escape, backdrop click, or the close button.
 *
 * PDF source URL: constructed from the bundle's `paper.cache_key`. The
 * default mount is `/papers/<cache_key>/paper.pdf` (mirrors lightcone-ui's
 * dev-server behaviour and portolan's `HttpApiAstraView.handlePaperPdf`);
 * a `resolvePaperPdf` prop overrides for hosts that mount differently
 * (e.g. static deploys that ship a flattened paper bundle).
 *
 * Static / uncached: when the paper is not cached locally
 * (`paper.cached === false`), the PDF pane shows a "Paper not in cache"
 * message and a doi.org link. The insights rail still renders so the
 * reader can see what was learned without the PDF in front of them.
 *
 * Accessibility: the modal is a real `<dialog>`-shape — `role="dialog"`,
 * `aria-modal="true"`, `aria-labelledby` pointed at the paper title,
 * Escape closes, click-outside closes, the close button is reachable by
 * Tab. Background siblings stay visible (the inline page underneath); the
 * modal sits above with a scrim so the reader doesn't lose orientation.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Bundle, Insight, PaperMetadata } from 'lightcone-ui-core';
import { PdfReader, type PdfReaderHandle } from '../FileReader';
import { scrollToAstraAnchor } from './AstraProse';

export interface PaperModalProps {
  /** DOI to open. Used as the key into `bundle.papers` and to filter
   *  insights. Required — the modal is keyed off this. */
  doi: string;
  /** Optional insight id to scroll to + highlight when the modal opens.
   *  Mirrors `paper-viewer.js`'s focusInsightId. */
  focusInsightId?: string | null;
  /** Bundle the open citation came from. Used to resolve the paper
   *  metadata (title, authors, cached, cache_key) and the insights for
   *  this DOI plus their decision-pill mappings. */
  bundle: Bundle;
  /** Resolve a `cache_key` into a fetchable PDF URL. Defaults to
   *  `/papers/<cache_key>/paper.pdf` (the mount portolan's
   *  `HttpApiAstraView.handlePaperPdf` exposes). */
  resolvePaperPdf?: (cacheKey: string) => string;
  /** Fires when the user dismisses the modal. */
  onClose: () => void;
}

function defaultResolvePaperPdf(cacheKey: string): string {
  return `/papers/${encodeURIComponent(cacheKey)}/paper.pdf`;
}

interface InsightForRail {
  id: string;
  insight: Insight;
}

function insightsForDoi(insights: Bundle['insights'], doi: string): InsightForRail[] {
  const out: InsightForRail[] = [];
  for (const [id, ins] of Object.entries(insights)) {
    if (ins.doi === doi) out.push({ id, insight: ins });
  }
  return out;
}

export function PaperModal({
  doi,
  focusInsightId,
  bundle,
  resolvePaperPdf = defaultResolvePaperPdf,
  onClose,
}: PaperModalProps) {
  const paper: PaperMetadata | undefined = bundle.papers[doi];
  const decisionsByInsight = bundle.decisions_by_insight ?? {};
  const decisionLabel = (key: string): string =>
    bundle.decisions[key]?.label ?? key;
  const insights = insightsForDoi(bundle.insights, doi);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PdfReaderHandle | null>(null);
  const titleId = `astra-paper-modal-title-${encodeURIComponent(doi)}`;

  // Escape closes; lock body scroll while open. Mirrors paper-viewer.js's
  // `openBackdrop` / `closePaperModal`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Initial focus on the close button — Tab cycles forward into the rail
    // (which holds the focusable controls) and back to close. Pdf preview
    // is canvas-only, no interactive children to trap focus around.
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Scroll the focused insight into view + flash it. Re-runs on
  // focusInsightId change, including null → id (modal stays open across
  // citation clicks). Mirrors paper-viewer.js's `focusInsight`.
  //
  // Also scrolls the PDF pane to the insight's evidence page (if the
  // insight has one) — same gesture as paper-viewer.js's
  // `if (focusInsight_.page) scrollToPage(focusInsight_.page)` after
  // the render loop. The PdfReader queues the call if pages haven't
  // landed yet, so timing is safe even when the modal opens and the
  // PDF starts loading in the same frame.
  useEffect(() => {
    if (!focusInsightId) return;
    const root = railRef.current;
    if (!root) return;
    // Querying the rail's own subtree avoids cross-modal collisions if
    // multiple modals were ever stacked (today they aren't).
    const el = root.querySelector(
      `[data-rail-insight-id="${CSS.escape(focusInsightId)}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('astra-paper-modal__insight--focus');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('astra-paper-modal__insight--focus');
    const focused = bundle.insights[focusInsightId];
    if (focused?.page != null) pdfRef.current?.scrollToPage(focused.page);
    const t = window.setTimeout(() => {
      el.classList.remove('astra-paper-modal__insight--focus');
    }, 1800);
    return () => window.clearTimeout(t);
  }, [focusInsightId, bundle.insights]);

  const title = paper?.title || doi;
  const cached = !!paper?.cached;
  const cacheKey = paper?.cache_key ?? null;
  const pdfUrl = cached && cacheKey ? resolvePaperPdf(cacheKey) : null;
  const doiHref = `https://doi.org/${encodeURIComponent(doi)}`;

  // Portal to document.body so the modal escapes any transformed /
  // clipped ancestor — astra pin cards in portolan apply CSS transforms
  // on the canvas (camera zoom/pan), and `position: fixed` is relative
  // to the nearest transformed ancestor, not the viewport. Without the
  // portal the modal would render *inside* the pin and be clipped to
  // the card's dimensions. SSR-safe guard for hosts that pre-render.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="astra-paper-modal-scrim"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="astra-paper-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="astra-paper-modal__header">
          <div className="astra-paper-modal__title-block">
            <h2 id={titleId} className="astra-paper-modal__title">
              {title}
            </h2>
            {paper?.authors && paper.authors.length > 0 && (
              <p className="astra-paper-modal__authors">
                {paper.authors.join(', ')}
              </p>
            )}
            <p className="astra-paper-modal__doi">
              <a
                className="astra-paper-modal__doi-link"
                href={doiHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                {doi}
                {paper?.version != null && ` · v${paper.version}`}
              </a>
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="astra-paper-modal__close"
            aria-label="Close paper"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="astra-paper-modal__body">
          <div className="astra-paper-modal__pdf-pane">
            {pdfUrl ? (
              <PdfReader
                ref={pdfRef}
                file={{
                  kind: 'pdf',
                  path: `${doi}/paper.pdf`,
                  language: '',
                  content: '',
                  url: pdfUrl,
                }}
              />
            ) : (
              <UncachedNotice doi={doi} />
            )}
          </div>
          <aside
            ref={railRef}
            className="astra-paper-modal__rail"
            aria-label="Insights from this paper"
          >
            <div className="astra-paper-modal__rail-head">
              <span className="astra-paper-modal__rail-count">
                {insights.length} {insights.length === 1 ? 'insight' : 'insights'}
              </span>
            </div>
            {insights.length === 0 ? (
              <p className="astra-paper-modal__rail-empty">
                No insights from this paper.
              </p>
            ) : (
              <ul className="astra-paper-modal__insights">
                {insights.map(({ id, insight }) => {
                  const decisions = decisionsByInsight[id] ?? [];
                  return (
                    <li
                      key={id}
                      className="astra-paper-modal__insight"
                      data-rail-insight-id={id}
                    >
                      <div className="astra-paper-modal__insight-head">
                        <span className="astra-paper-modal__insight-id">{id}</span>
                        {insight.claim && (
                          <span className="astra-paper-modal__insight-claim">
                            {insight.claim}
                          </span>
                        )}
                      </div>
                      {insight.quote && (
                        <p className="astra-paper-modal__insight-quote">
                          "{insight.quote}"
                        </p>
                      )}
                      {insight.page != null && (
                        // Button instead of static text so the rail's
                        // page hint scrolls the PDF pane to that page —
                        // mirrors paper-viewer.js's `[data-page]` link
                        // (line 80 of templates/paper-viewer.js). Plain
                        // click only; no Cmd-fallback because there's
                        // nowhere external to fall through to.
                        <p className="astra-paper-modal__insight-page">
                          <button
                            type="button"
                            className="astra-paper-modal__insight-page-link"
                            data-page={insight.page}
                            disabled={!pdfUrl}
                            onClick={() => {
                              if (insight.page != null) {
                                pdfRef.current?.scrollToPage(insight.page);
                              }
                            }}
                          >
                            Evidence · page {insight.page}
                          </button>
                        </p>
                      )}
                      {decisions.length > 0 && (
                        <div className="astra-paper-modal__insight-informs">
                          <span className="astra-paper-modal__insight-informs-label">
                            Informs
                          </span>
                          <ul className="astra-paper-modal__insight-informs-pills">
                            {decisions.map((k) => (
                              <li key={k}>
                                <button
                                  type="button"
                                  className="astra-paper-modal__informs-pill"
                                  onClick={() => {
                                    onClose();
                                    // Defer until the modal scrim has unmounted
                                    // so the scroll lands on the page underneath.
                                    window.setTimeout(() => {
                                      scrollToAstraAnchor(`astra-decision-${k}`);
                                    }, 0);
                                  }}
                                >
                                  {decisionLabel(k)}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function UncachedNotice({ doi }: { doi: string }) {
  const doiHref = `https://doi.org/${encodeURIComponent(doi)}`;
  return (
    <div className="astra-paper-modal__pdf-uncached">
      <p>
        Paper not in cache. Run{' '}
        <code>astra papers fetch {doi}</code>
        {' '}to download it, then reload.
      </p>
      <p>
        <a
          className="astra-paper-modal__pdf-uncached-link"
          href={doiHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on publisher site →
        </a>
      </p>
    </div>
  );
}
