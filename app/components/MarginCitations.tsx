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
 *   decision   → ◇  (gold, diamond variant)
 */

import { useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import type { GraphNode } from '~/utils/content-types';
import { glyphForNode, statusClass } from '~/utils/fiber-status';

interface Glyph {
  slug: string;
  node: GraphNode;
  top: number;       // px from top of prose wrapper
  href: string;
  label: string;
  linkEl: HTMLAnchorElement;
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
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
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

      const prose = proseRef.current!;
      const wrapper = wrapperRef.current!;
      const wrapperRect = wrapper.getBoundingClientRect();

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

        const rect = a.getBoundingClientRect();
        const top = rect.top - wrapperRect.top + window.scrollY;

        next.push({
          slug,
          node,
          top,
          href,
          label: node.label ?? slug,
          linkEl: a,
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
      // reading doesn't flash tooltips.
      positioned.forEach((g, i) => {
        const onEnter = () => {
          g.linkEl.classList.add('margin-active');
          if (hoverTimer) clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => setHoveredIdx(i), LINK_HOVER_DELAY_MS);
        };
        const onLeave = () => {
          g.linkEl.classList.remove('margin-active');
          if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
          setHoveredIdx((cur) => (cur === i ? null : cur));
        };
        g.linkEl.addEventListener('mouseenter', onEnter);
        g.linkEl.addEventListener('mouseleave', onLeave);
        cleanups.push(() => {
          g.linkEl.removeEventListener('mouseenter', onEnter);
          g.linkEl.removeEventListener('mouseleave', onLeave);
        });
      });
    };

    // Measure after paint
    const frame = requestAnimationFrame(measure);

    // Re-measure on resize
    const observer = new ResizeObserver(measure);
    observer.observe(proseRef.current!);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
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
          onMouseEnter={() => { g.linkEl.classList.add('margin-active'); setHoveredIdx(i); }}
          onMouseLeave={() => { g.linkEl.classList.remove('margin-active'); setHoveredIdx(null); }}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate(g.href)}
          aria-label={`Navigate to ${g.label}`}
        >
          <span className="margin-glyph__dot">{glyphForNode(g.node)}</span>
          <span className="margin-glyph__label">{g.label}</span>
        </div>
      ))}

      {/* Hover tooltip — positioned in the right margin below the glyph */}
      {hoveredGlyph && (
        <div
          className="fiber-tooltip"
          style={{ top: hoveredGlyph.top + 20 }}
        >
          <div className="fiber-tooltip__title">{hoveredGlyph.label}</div>
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
        </div>
      )}
    </>
  );
}
