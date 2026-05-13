/**
 * GutterHoverCard — Lightcone-theme hover preview for inline structured anchors.
 *
 * Mirror of MarginCitations's hover/pin path without the persistent glyph
 * column. Under `data-theme="lightcone-margin"` the right gutter is empty
 * whitespace; hovering an `.structured-anchor` in the prose floats a
 * `MarginCardPreview` into that space at the anchor's pretext line-Y.
 * Clicking pins via `vellum:open-card` (the existing NarrativeView click
 * handler already owns the pin dispatch for Lightcone; this component just
 * owns the hover).
 */

import { useEffect, useRef, useState } from 'react';
import type { GraphNode } from '~/utils/content-types';
import { useHoverGrace } from '~/hooks/useHoverGrace';
import { HOVER_GRACE_MS, HOVER_OPEN_DELAY_MS } from '~/utils/hover';
import { parseStructuredAnchor, resolveStructuredAnchor } from '~/utils/structured-anchor';
import { resolveStructuredCardContent } from '~/utils/structured-card-content';
import { MarginCardPreview } from './MarginCardPreview';
import type { CardContent } from './Card';

interface GutterHoverCardProps {
  proseRef: React.RefObject<HTMLElement>;
  wrapperRef: React.RefObject<HTMLElement>;
  currentNode: GraphNode | null | undefined;
  nodes: GraphNode[];
  childSubKeys?: Set<string>;
  parentSubKeys?: Set<string>;
  parentSubSlugs?: Map<string, string>;
}

interface Hovered {
  content: CardContent;
  top: number;
  left: number;
}

export function GutterHoverCard({
  proseRef,
  wrapperRef,
  currentNode,
  nodes,
  childSubKeys,
  parentSubKeys,
  parentSubSlugs,
}: GutterHoverCardProps) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const { hoveredKey, openKey, cancelClose, scheduleClose } =
    useHoverGrace(HOVER_GRACE_MS, HOVER_OPEN_DELAY_MS);

  // Prop snapshot so the listener-attach effect stays bound to the DOM refs
  // only — prop changes don't tear down/rebuild per-anchor listeners.
  const propsRef = useRef({ currentNode, nodes, childSubKeys, parentSubKeys, parentSubSlugs });
  propsRef.current = { currentNode, nodes, childSubKeys, parentSubKeys, parentSubSlugs };

  useEffect(() => {
    const prose = proseRef.current;
    const wrapper = wrapperRef.current;
    if (!prose || !wrapper) return;

    const cleanups: Array<() => void> = [];
    let scheduled: ReturnType<typeof setTimeout> | null = null;

    // Compute hover card geometry at hover time: the right-gutter x (same
    // canvas-column origin MarginCitations uses) and the anchor's pretext
    // line-Y, both expressed in the wrapperRef's absolute-positioning
    // coordinate system.
    const geometryFor = (a: HTMLAnchorElement): { top: number; left: number } | null => {
      const wrapperRect = wrapper.getBoundingClientRect();
      const rawCanvasWidth = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--canvas-width'),
      );
      const canvasWidth =
        Number.isFinite(rawCanvasWidth) && rawCanvasWidth > 0 ? rawCanvasWidth : 0;
      const canvasLeft =
        canvasWidth > 0 ? window.innerWidth - canvasWidth : window.innerWidth;
      const left = Math.max(0, canvasLeft - wrapperRect.left + 12);

      let top: number;
      const dataLineTop = a.dataset.pretextLineTop;
      const pretextBox = prose.querySelector<HTMLElement>('.pretext-prose');
      const pretextOriginTop = pretextBox
        ? pretextBox.getBoundingClientRect().top - wrapperRect.top
        : null;
      if (dataLineTop != null && pretextOriginTop != null) {
        top = pretextOriginTop + Number(dataLineTop);
      } else {
        const rect = a.getBoundingClientRect();
        top = rect.top - wrapperRect.top;
      }
      return { top: top + 20, left };
    };

    const attach = () => {
      for (const fn of cleanups.splice(0)) fn();
      const anchors = Array.from(prose.querySelectorAll<HTMLAnchorElement>('a.structured-anchor'));
      anchors.forEach((a, i) => {
        const href = a.getAttribute('href') ?? '';
        if (!href) return;
        const parsed = parseStructuredAnchor(href);
        if (!parsed) return;
        const key = `structured:${i}`;
        const onEnter = () => {
          const { currentNode: cn, nodes: ns, childSubKeys: cs, parentSubKeys: ps, parentSubSlugs: pss } =
            propsRef.current;
          if (!cn) return;
          // Broken anchors — CSS already dims them; skip the card since
          // there's nothing to resolve.
          const broken = resolveStructuredAnchor(parsed, cn, cs, ps, ns);
          if (broken) return;
          const content = resolveStructuredCardContent(parsed, cn, ns, pss);
          if (!content) return;
          const geom = geometryFor(a);
          if (!geom) return;
          setHovered({ content, top: geom.top, left: geom.left });
          openKey(key);
          cancelClose();
          a.classList.add('margin-active');
        };
        const onLeave = () => {
          a.classList.remove('margin-active');
          scheduleClose();
        };
        a.addEventListener('mouseenter', onEnter);
        a.addEventListener('mouseleave', onLeave);
        cleanups.push(() => {
          a.removeEventListener('mouseenter', onEnter);
          a.removeEventListener('mouseleave', onLeave);
        });
      });
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = setTimeout(() => {
        scheduled = null;
        attach();
      }, 0);
    };

    attach();
    schedule();

    // PretextProse renders a loading placeholder and swaps in real anchors
    // asynchronously — rewire whenever the subtree changes.
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(prose, { childList: true, subtree: true });

    return () => {
      if (scheduled) clearTimeout(scheduled);
      mutationObserver.disconnect();
      for (const fn of cleanups) fn();
    };
  }, [proseRef, wrapperRef, cancelClose, openKey, scheduleClose]);

  // Clear the preview when the hover-grace hook decides the cursor has left.
  useEffect(() => {
    if (!hoveredKey) setHovered(null);
  }, [hoveredKey]);

  if (!hovered) return null;
  return (
    <MarginCardPreview
      content={hovered.content}
      top={hovered.top}
      left={hovered.left}
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
    />
  );
}
