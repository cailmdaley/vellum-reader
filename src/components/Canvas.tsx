/**
 * Canvas — the right-side aside of the reader, paired with the draggable
 * divider. This component is only the chrome: a fixed-position pane with the
 * page's background, sized by the `--canvas-width` CSS variable that the
 * divider writes on the root element.
 *
 * What appears inside the pane is decided by whichever tab (Narrative,
 * Workspace, Map) is active. Each tab passes its own children in — there is
 * no shared state between tabs, so switching tabs swaps the whole right side.
 */

import type { ReactNode } from 'react';

export function Canvas({ children }: { children?: ReactNode }) {
  return (
    <aside className="vellum-canvas" aria-label="Canvas">
      <div className="vellum-canvas__inner">{children}</div>
    </aside>
  );
}
