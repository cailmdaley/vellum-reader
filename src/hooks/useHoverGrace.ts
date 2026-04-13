/**
 * useHoverGrace — debounced open/close for hover-activated previews.
 *
 * Reader hovers a glyph, a preview pops. Moving the cursor across the gap
 * from glyph to preview should not close it — the preview is interactive
 * and the reader may want to click things inside. `scheduleClose()` is
 * debounced by `delayMs`; any `cancelClose()` or `openKey()` before the
 * timer fires keeps the preview open.
 *
 * Keyed by string so the same hook can back stacks with multiple glyphs.
 * The caller reads `hoveredKey` to decide which preview (if any) to render,
 * and wires `openKey` + `scheduleClose` onto each glyph + the preview.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function useHoverGrace(delayMs: number, openDelayMs = 0) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    // Leaving also cancels any pending open — a cursor that grazed
    // a glyph and moved on shouldn't summon the preview after the fact.
    clearTimers();
    closeTimerRef.current = setTimeout(() => {
      setHoveredKey(null);
      closeTimerRef.current = null;
    }, delayMs);
  }, [clearTimers, delayMs]);

  const openKey = useCallback(
    (key: string) => {
      clearTimers();
      setHoveredKey(key);
    },
    [clearTimers],
  );

  // Delayed variant: the preview only appears after the cursor dwells
  // on the trigger for `openDelayMs`. Reading through a text flecked
  // with margin glyphs shouldn't flash previews mid-sentence. Falls
  // through to the immediate path when the delay is zero.
  const scheduleOpen = useCallback(
    (key: string) => {
      if (openDelayMs <= 0) {
        openKey(key);
        return;
      }
      clearTimers();
      openTimerRef.current = setTimeout(() => {
        setHoveredKey(key);
        openTimerRef.current = null;
      }, openDelayMs);
    },
    [clearTimers, openDelayMs, openKey],
  );

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { hoveredKey, openKey, scheduleOpen, cancelClose, scheduleClose };
}
