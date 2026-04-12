/**
 * HOVER_GRACE_MS — shared debounce window for hover-activated previews.
 *
 * Long enough that the reader can cross the gap from a glyph into the
 * preview without the preview closing mid-gesture; short enough that
 * moving away feels responsive. Used by margin stacks (decisions,
 * insights, citations) and any other surface that pops an interactive
 * hover preview.
 */
export const HOVER_GRACE_MS = 180;
