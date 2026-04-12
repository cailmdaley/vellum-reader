/**
 * MarginCitations — right-margin citation glyphs.
 *
 * After the prose renders, scans for all internal `a[href^="/"]` links,
 * looks each up in the ASTRA graph, and renders a status glyph positioned
 * at the line where the citation appears.
 *
 * Glyph map:
 *   open       → ○  (gold)
 *   active     → ◐  (teal)
 *   closed     → ●  (teal, dimmed)
 *   suspended  → ·  (muted)
 *   decision   → ⧖  (gold, hourglass)
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GraphNode } from '~/utils/content-types';
import { useHoverGrace } from '~/hooks/useHoverGrace';
import { HOVER_GRACE_MS } from '~/utils/hover';
import { glyphForNode, statusClass } from '~/utils/fiber-status';

interface Glyph {
  slug: string;
  node: GraphNode;
  top: number;       // px from top of prose wrapper
  href: string;
  label: string;
  /**
   * Every anchor element that backs this glyph. Usually a single anchor,
   * but pretext emits one `<a>` per wrapped line fragment of a single
   * source link, so a wikilink that straddles two lines contributes two
   * (or more) same-href anchors which we fold into one glyph. Hover
   * listeners are attached to each so highlighting works on whichever
   * fragment the reader actually mouses over.
   */
  linkEls: HTMLAnchorElement[];
}

interface MarginCitationsProps {
  nodes: GraphNode[];
  proseRef: React.RefObject<HTMLElement>;
  wrapperRef: React.RefObject<HTMLElement>;
  changedIds?: Set<string>;
}

/** Delay (ms) before a prose-link hover surfaces the tooltip. Glyph hovers are immediate. */
const LINK_HOVER_DELAY_MS = 250;

export function MarginCitations({ nodes, proseRef, wrapperRef, changedIds }: MarginCitationsProps) {
  const [glyphs, setGlyphs] = useState<Glyph[]>([]);
  const { hoveredKey, openKey, cancelClose, scheduleClose } =
    useHoverGrace(HOVER_GRACE_MS);
  const hoveredIdx = hoveredKey != null ? Number(hoveredKey) : null;
  const navigate = useNavigate();

  // Measure positions after prose paints
  useEffect(() => {
    if (!proseRef.current || !wrapperRef.current) return;

    const nodeBySlug = new Map(nodes.map((n) => [n.slug, n]));
    const cleanups: Array<() => void> = [];
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;

    const measure = () => {
      // Drop any listeners from the previous measurement — new glyph
      // indices would otherwise point into stale state.
      for (const fn of cleanups.splice(0)) fn();
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      cancelClose();

      const prose = proseRef.current!;
      const wrapper = wrapperRef.current!;
      const wrapperRect = wrapper.getBoundingClientRect();

      // Search the subtree for an element whose positioning origin matches
      // pretext's own coordinate space — `.pretext-prose` is the relatively-
      // positioned box pretext lays its lines inside. We read its offset
      // once (one getBoundingClientRect for the whole container) and then
      // stamp each pretext-authored anchor's glyph using
      // `data-pretext-line-top` rather than re-measuring every link with
      // its own bounding rect. Gate 2 of the pretext-refoundation
      // constitution: on column or card resize, glyphs track pretext's
      // updated line coordinates without a per-anchor CSS measurement pass.
      const pretextBox = prose.querySelector<HTMLElement>('.pretext-prose');
      const pretextOriginTop = pretextBox
        ? pretextBox.getBoundingClientRect().top - wrapperRect.top + window.scrollY
        : null;

      // All internal anchor tags in the prose
      const anchors = Array.from(
        prose.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')
      );

      const next: Glyph[] = [];

      for (const a of anchors) {
        const href = a.getAttribute('href') ?? '';
        const slug = href.replace(/^\//, ''); // strip leading /
        if (!slug) continue;

        const node = nodeBySlug.get(slug);
        if (!node) continue;

        // Prefer pretext's authoritative line coordinate when the anchor
        // was rendered by PretextProse. Fall back to the flow-layout
        // measurement used by the myst-to-react column.
        let top: number;
        const dataLineTop = a.dataset.pretextLineTop;
        if (dataLineTop != null && pretextOriginTop != null) {
          top = pretextOriginTop + Number(dataLineTop);
        } else {
          const rect = a.getBoundingClientRect();
          top = rect.top - wrapperRect.top + window.scrollY;
        }

        // Pretext emits one `<a>` per wrapped line fragment of a single
        // source link, so a wikilink straddling two lines produces two
        // adjacent same-href anchors. Fold those into one glyph: if the
        // previous accepted glyph has the same href AND sits within one
        // pretext line-height of this anchor, treat this as a
        // continuation rather than a new citation. A naive same-href
        // dedupe collapses distinct citations of the same slug in
        // different paragraphs; anchoring on line-distance keeps those
        // separate because their top values differ by much more than a
        // line. When `data-pretext-line-height` is missing (myst-column
        // fallback path) there's nothing to dedupe — myst renders one
        // `<a>` per link across wraps — so we leave the anchor alone.
        const prev = next[next.length - 1];
        if (prev && prev.href === href) {
          const dataLineHeight = a.dataset.pretextLineHeight;
          if (dataLineHeight != null) {
            const lineHeight = Number(dataLineHeight);
            if (Math.abs(top - prev.top) <= lineHeight * 1.5) {
              prev.linkEls.push(a);
              continue;
            }
          }
        }

        next.push({
          slug,
          node,
          top,
          href,
          label: node.label ?? slug,
          linkEls: [a],
        });
      }

      // Stack overlapping glyphs (within 14px of each other)
      const MIN_GAP = 16;
      let lastTop = -999;
      const positioned = next.map((g) => {
        const t = Math.max(g.top, lastTop + MIN_GAP);
        lastTop = t;
        return { ...g, top: t };
      });

      setGlyphs(positioned);

      // Surface the same tooltip when the user hovers a prose link, not
      // just the margin glyph. Delayed so scrubbing across links while
      // reading doesn't flash tooltips. Wired on every anchor backing
      // the glyph so that a wrap-fragmented wikilink highlights
      // correctly from either fragment.
      positioned.forEach((g, i) => {
        const setActive = (active: boolean) => {
          for (const el of g.linkEls) {
            el.classList.toggle('margin-active', active);
          }
        };
        const onEnter = () => {
          setActive(true);
          if (hoverTimer) clearTimeout(hoverTimer);
          cancelClose();
          hoverTimer = setTimeout(() => openKey(String(i)), LINK_HOVER_DELAY_MS);
        };
        const onLeave = () => {
          setActive(false);
          if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
          scheduleClose();
        };
        for (const el of g.linkEls) {
          el.addEventListener('mouseenter', onEnter);
          el.addEventListener('mouseleave', onLeave);
        }
        cleanups.push(() => {
          for (const el of g.linkEls) {
            el.removeEventListener('mouseenter', onEnter);
            el.removeEventListener('mouseleave', onLeave);
          }
        });
      });
    };

    // Measure after paint
    const frame = requestAnimationFrame(measure);

    // Re-measure on resize. We observe two targets:
    //
    //   1. The prose article itself — catches outer column width changes
    //      from viewport / mode switches.
    //   2. The inner `.pretext-prose` box (when present) — pretext
    //      re-computes line y-coordinates when its width changes, and the
    //      new coordinates only land on `data-pretext-line-top` after
    //      PretextProse re-renders. Observing the inner box makes sure
    //      the re-measurement runs *after* that re-render, so the glyphs
    //      read fresh pretext coordinates instead of stale ones from the
    //      previous layout pass. Without this, making CONTENT_WIDTH
    //      reactive in PretextNarrativePage silently desyncs citations
    //      from the prose on every responsive breakpoint trip.
    const observer = new ResizeObserver(measure);
    const proseEl = proseRef.current!;
    observer.observe(proseEl);
    const pretextBox = proseEl.querySelector<HTMLElement>('.pretext-prose');
    if (pretextBox) observer.observe(pretextBox);

    // Pretext may mount its inner box a tick after the article; watch for
    // that so the first Gate 1 load with pretext still picks it up for
    // subsequent resizes.
    let mutationObserver: MutationObserver | null = null;
    if (!pretextBox && typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        const box = proseEl.querySelector<HTMLElement>('.pretext-prose');
        if (box) {
          observer.observe(box);
          mutationObserver?.disconnect();
          mutationObserver = null;
        }
      });
      mutationObserver.observe(proseEl, { childList: true, subtree: true });
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutationObserver?.disconnect();
      if (hoverTimer) clearTimeout(hoverTimer);
      for (const fn of cleanups) fn();
    };
  }, [proseRef, wrapperRef, nodes]);

  if (glyphs.length === 0) return null;

  const hoveredGlyph = hoveredIdx !== null ? glyphs[hoveredIdx] : null;

  return (
    <>
      {glyphs.map((g, i) => (
        <div
          key={`${g.slug}-${i}`}
          className={`margin-glyph margin-glyph--${statusClass(g.node.status)}${changedIds?.has(g.slug) ? ' margin-glyph--changed' : ''}${g.node.tempered ? ' margin-glyph--tempered' : ''}`}
          style={{ top: g.top }}
          onClick={() => navigate(g.href)}
          onMouseEnter={() => {
            for (const el of g.linkEls) el.classList.add('margin-active');
            openKey(String(i));
          }}
          onMouseLeave={() => {
            for (const el of g.linkEls) el.classList.remove('margin-active');
            scheduleClose();
          }}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate(g.href)}
          aria-label={`Navigate to ${g.label}`}
        >
          <span className="margin-glyph__dot">{glyphForNode(g.node)}</span>
          <span className="margin-glyph__label">{g.label}</span>
        </div>
      ))}

      {/* Hover tooltip — positioned in the right margin below the glyph.
          `pointer-events: auto` plus mirror-ed enter/leave handlers keep
          the card open while the reader moves their cursor from the glyph
          into the card body, so they can click the title, a tag, or a
          decision row. */}
      {hoveredGlyph && (
        <div
          className="fiber-tooltip fiber-tooltip--interactive"
          style={{ top: hoveredGlyph.top + 20 }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <Link
            to={hoveredGlyph.href}
            className="fiber-tooltip__title fiber-tooltip__title--link"
          >
            {hoveredGlyph.label}
          </Link>
          <div className="fiber-tooltip__status">
            <span>{glyphForNode(hoveredGlyph.node)}</span>
            <span>{hoveredGlyph.node.status}</span>
            {hoveredGlyph.node.tempered && <span className="fiber-tooltip__tempered" title="Human-reviewed; load-bearing">⬡</span>}
            {hoveredGlyph.node.tags?.map((t) => (
              <span key={t} className="vellum-tag">{t}</span>
            ))}
          </div>
          {hoveredGlyph.node.verdict && (
            <div className="fiber-tooltip__verdict">{hoveredGlyph.node.verdict}</div>
          )}
          {hoveredGlyph.node.decisions?.map((d) => (
            <div key={d.key} className="fiber-tooltip__decision">
              <span className="fiber-tooltip__decision-label">decision</span>
              {' '}{d.label}{d.selectedLabel ? `: ${d.selectedLabel}` : ''}
            </div>
          ))}
          <button
            className="fiber-tooltip__pin"
            onClick={(e) => {
              document.dispatchEvent(
                new CustomEvent('vellum:open-context-card', {
                  detail: {
                    slug: hoveredGlyph.node.slug,
                    x: e.clientX,
                    y: e.clientY,
                  },
                }),
              );
              scheduleClose();
            }}
            title="Open as floating card"
          >
            ⊞
          </button>
        </div>
      )}
    </>
  );
}
