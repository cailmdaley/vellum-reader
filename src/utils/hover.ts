/**
 * HOVER_GRACE_MS — shared debounce window for hover-activated previews.
 *
 * Long enough that the reader can cross the gap from a glyph into the
 * preview without the preview closing mid-gesture; short enough that
 * moving away feels responsive. Used by margin stacks (decisions,
 * findings, citations) and any other surface that pops an interactive
 * hover preview.
 */
export const HOVER_GRACE_MS = 400;

/**
 * HOVER_OPEN_DELAY_MS — dwell time before a hover-activated preview
 * appears. Scrolling the eye across a passage studded with margin
 * glyphs shouldn't flash previews mid-sentence; the reader has to
 * actually pause on a glyph to summon its card.
 */
export const HOVER_OPEN_DELAY_MS = 350;
