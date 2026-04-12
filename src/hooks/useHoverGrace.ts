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

export function useHoverGrace(delayMs: number) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    timerRef.current = setTimeout(() => {
      setHoveredKey(null);
      timerRef.current = null;
    }, delayMs);
  }, [cancelClose, delayMs]);

  const openKey = useCallback(
    (key: string) => {
      cancelClose();
      setHoveredKey(key);
    },
    [cancelClose],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { hoveredKey, openKey, cancelClose, scheduleClose };
}
