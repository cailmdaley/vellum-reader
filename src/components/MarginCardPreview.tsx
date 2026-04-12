/**
 * MarginCardPreview — the hover-pop shell used by left-margin glyphs.
 *
 * Hover-previews and pinned floating cards share a single rendering
 * path. This component is that path: the unified Card primitive rendered
 * at a constrained preview width, with a
 * positioning shell that anchors to the left-margin gutter and supplies
 * the interactive chrome margin hovers need — a grace period so the
 * cursor can cross the gap from glyph to preview, a ⊞ pin button that
 * dispatches the same `vellum:open-card` event pinned floating cards
 * use, and a click-to-scroll handler that jumps to the full AstraBlocks
 * entry for the content.
 *
 * The pretext lockup needs a concrete pixel width to lay out into, so the
 * preview is a fixed size (falls in Card's "summary" tier). At viewports
 * narrow enough that the fixed width won't fit in the gutter, the whole
 * margin substrate is already hidden by the reader's responsive rules.
 */

import { Card, type CardContent } from './Card';

/** Preview width — lands in Card's "summary" tier (260 < w ≤ 500). */
const PREVIEW_WIDTH = 300;

interface MarginCardPreviewProps {
  content: CardContent;
  /** Absolute `top` in the margin stack's coordinate system. */
  top: number;
  /** Cancel the glyph's pending close-on-leave timer. */
  onMouseEnter: () => void;
  /** Start the glyph's close-on-leave timer. */
  onMouseLeave: () => void;
  /** Scroll the prose to the content's corresponding AstraBlocks anchor. */
  onScrollToAnchor: () => void;
}

export function MarginCardPreview({
  content,
  top,
  onMouseEnter,
  onMouseLeave,
  onScrollToAnchor,
}: MarginCardPreviewProps) {
  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    document.dispatchEvent(
      new CustomEvent('vellum:open-card', {
        detail: { content, x: e.clientX, y: e.clientY },
      }),
    );
    onMouseLeave();
  };

  // Clicking anywhere else on the preview takes the reader to the full
  // structured block in AstraBlocks — the "read more" affordance.
  const handleBodyClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.margin-card-preview__pin')) return;
    onScrollToAnchor();
  };

  return (
    <div
      className="margin-card-preview"
      style={{ top, width: PREVIEW_WIDTH }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={handleBodyClick}
      role="button"
      tabIndex={0}
    >
      <button
        type="button"
        className="margin-card-preview__pin"
        title="Open as floating card"
        onClick={handlePin}
      >
        ⊞
      </button>
      <Card content={content} width={PREVIEW_WIDTH} />
    </div>
  );
}
