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
 * The pretext lockup needs a concrete pixel width to lay out into, so the
 * preview is a fixed size (falls in Card's "summary" tier). At viewports
 * narrow enough that the fixed width won't fit in the gutter, the whole
 * margin substrate is already hidden by the reader's responsive rules.
 */

import { useEffect, useRef, useState } from 'react';
import { Card, type CardContent } from './Card';
import { useAdapter } from '~/contexts/AdapterContext';

const MIN_PREVIEW_WIDTH = 220;
/** Small inset from the canvas edge so the card doesn't butt against the
 *  divider or the viewport edge. */
const CANVAS_INSET = 64;

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
  if (typeof document === 'undefined') return MIN_PREVIEW_WIDTH;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--canvas-width');
  const canvasWidth = Number.parseFloat(raw);
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) return MIN_PREVIEW_WIDTH;
  // Fill the right column: the hover preview lives in the canvas
  // pane, so its natural width is the canvas itself (less a small
  // inset so it doesn't collide with the divider or the viewport edge).
  return Math.max(MIN_PREVIEW_WIDTH, canvasWidth - CANVAS_INSET);
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
      className="margin-card-preview"
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
