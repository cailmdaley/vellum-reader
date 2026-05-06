/**
 * MarginCardPreview — the hover-pop shell used by left-margin glyphs.
 *
 * Hover-previews and pinned floating cards share a single rendering
 * path through the unified Card primitive. The preview is a click-to-
 * pin surface: clicking anywhere on it dispatches `vellum:open-card`
 * with the preview's own width and viewport position, so the pinned
 * floating card spawns in place at the same size and looks identical
 * to the preview the reader just clicked. From there the floating
 * card is draggable and resizable.
 *
 * Width is single-margin-denizen — the preview takes whatever the
 * canvas column resolves to via `marginaliaWidth(readCanvasWidth())`.
 * Drag the divider, the preview reflows; pretext lays the lockup at
 * the new width with no compact / summary / full breakpoints (per
 * `vellum-reader/context-cards` `disclosure-model: continuous-pretext`
 * and `vellum-reader/history-card`'s ratification of the single-width
 * rule). At viewports narrow enough that the preview won't fit in the
 * gutter, the whole margin substrate is already hidden by the
 * reader's responsive rules.
 */

import { useEffect, useRef, useState } from 'react';
import { Card, type CardContent } from './Card';
import { useAdapter } from '~/contexts/AdapterContext';
import { CARD_MIN_WIDTH, marginaliaWidth, readCanvasWidth } from '~/utils/canvas-geometry';

interface MarginCardPreviewProps {
  content: CardContent;
  /** Absolute `top` in the margin stack's coordinate system. */
  top: number;
  /** Absolute `left` in the prose wrapper's coordinate system. */
  left?: number;
  /** Cancel the glyph's pending close-on-leave timer. */
  onMouseEnter: () => void;
  /** Start the glyph's close-on-leave timer. */
  onMouseLeave: () => void;
}

function readPreviewWidth(): number {
  return marginaliaWidth(readCanvasWidth(), CARD_MIN_WIDTH);
}

export function MarginCardPreview({
  content,
  top,
  left = 0,
  onMouseEnter,
  onMouseLeave,
}: MarginCardPreviewProps) {
  const adapter = useAdapter();
  const [previewWidth, setPreviewWidth] = useState<number>(() => readPreviewWidth());
  const rootRef = useRef<HTMLDivElement>(null);
  // Fiber hovers fetch their prose body so the preview has something
  // to scroll through. Non-fiber content (decision, finding, plot,
  // input, output) stays as-is — those don't carry a prose body.
  const [resolved, setResolved] = useState<CardContent>(content);
  useEffect(() => {
    setResolved(content);
    if (content.type !== 'fiber' || content.content) return;
    let cancelled = false;
    adapter.getFiberContent(content.node.slug).then((fiberContent) => {
      if (cancelled || !fiberContent) return;
      setResolved({ type: 'fiber', node: content.node, content: fiberContent });
    });
    return () => { cancelled = true; };
  }, [adapter, content]);

  useEffect(() => {
    const update = () => setPreviewWidth(readPreviewWidth());
    update();
    window.addEventListener('resize', update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    return () => {
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, []);

  // Clicking the preview pins it: dispatch `vellum:open-card` with the
  // preview's own bounding rect so the floating card spawns in the
  // exact same spot at the exact same size. Pinning feels like the
  // card is simply staying put rather than re-materializing at a
  // different dimension.
  const handlePin = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    document.dispatchEvent(
      new CustomEvent('vellum:open-card', {
        detail: {
          // Pass the already-fetched content so the pinned card is
          // the hover preview, verbatim — no re-fetch flicker, no
          // dimension reshuffle, same layout preserved.
          content: resolved,
          x: rect?.left ?? 0,
          y: rect?.top ?? 0,
          width: rect?.width ?? previewWidth,
          height: rect?.height,
          exactPosition: true,
        },
      }),
    );
    onMouseLeave();
  };

  return (
    <div
      ref={rootRef}
      className="margin-card margin-card-preview"
      style={{ top, left, width: previewWidth }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={handlePin}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handlePin();
        }
      }}
    >
      <Card content={resolved} width={previewWidth} />
    </div>
  );
}
