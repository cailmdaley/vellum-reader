/**
 * Canvas-column geometry helpers shared by hover previews, pinned cards,
 * and the MarginCitations click-to-pin dispatcher.
 *
 * All three surfaces must render at the same width and x for a click on
 * a glyph / prose text / hover preview to feel like it's pinning the
 * preview in place. Previously each had its own copy of the formula; a
 * single source keeps them in lockstep when the rules change.
 */

/** Minimum card width for Card's pretext layout to render legibly. */
export const CARD_MIN_WIDTH = 220;

/** Inset from the canvas-column edge at wide column widths — the card
 *  sits inside the column rather than butting against the divider or
 *  the viewport edge. */
export const CANVAS_INSET = 64;

/** Symmetric edge inset kept when the column is too narrow to honor
 *  CARD_MIN_WIDTH + CANVAS_INSET — the card shrinks below MIN_WIDTH
 *  rather than clipping past the viewport edge. */
export const CANVAS_EDGE_INSET = 12;

/** Width for a marginalia card rendered against a canvas column of the
 *  given pixel width. At wide columns this is `canvasWidth - CANVAS_INSET`
 *  with a `CARD_MIN_WIDTH` floor; at narrow columns the floor is relaxed
 *  so the card fits inside the column with a small symmetric edge inset.
 */
export function marginaliaWidth(canvasWidth: number, fallback = 340): number {
  if (canvasWidth <= 0) return fallback;
  return Math.min(
    Math.max(CARD_MIN_WIDTH, canvasWidth - CANVAS_INSET),
    Math.max(canvasWidth - CANVAS_EDGE_INSET * 2, CANVAS_EDGE_INSET),
  );
}

/** Read `--canvas-width` off `:root`. Returns 0 when unset or invalid so
 *  callers can fall back to their own default (usually via
 *  `marginaliaWidth`'s second arg). */
export function readCanvasWidth(): number {
  if (typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--canvas-width');
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Left x of the canvas column in viewport coords. When the canvas is
 *  collapsed or absent, falls back to a small viewport-right offset. */
export function readCanvasLeft(): number {
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const canvasWidth = readCanvasWidth();
  return canvasWidth > 0 ? vw - canvasWidth : 8;
}
