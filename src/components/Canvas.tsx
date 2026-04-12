/**
 * Canvas — the shared right-side panel that persists across mode switches.
 *
 * Gate 1 of the workspace constitution: the canvas is an empty surface with
 * the correct Weathered Substrate background, sitting to the right of the
 * draggable divider. Later gates will populate it with decision cards,
 * insight cards, and fiber previews popped from the left panel.
 *
 * See .felt/vellum-reader/workspace for the full constitution.
 */

export function Canvas() {
  return (
    <aside className="vellum-canvas" aria-label="Workspace canvas">
      <div className="vellum-canvas__inner" />
    </aside>
  );
}
