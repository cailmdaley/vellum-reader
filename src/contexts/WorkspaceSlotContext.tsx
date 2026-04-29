/**
 * WorkspaceSlotContext — embedding-host hook for replacing the Workspace tab.
 *
 * Vellum ships three modes (Narrative / Workspace / Delta). Standalone vellum
 * uses the built-in `<WorkspaceView>` for the Workspace tab. Embedding hosts
 * (portolan's vellum-kanban modal) need to override that tab's body — the
 * hosted surface is a vanilla-JS kanban grid, not a fiber decomposition view.
 *
 * Rather than punch a hole through every consumer (FiberPage, FloatingIsland)
 * with a new prop chain, the host hands `WorkspaceMount` a slot + label/letter
 * overrides; we provide them here for any descendant to read. When `slot` is
 * non-null, FiberPage renders it instead of `<WorkspaceView>` (and suppresses
 * `<WorkspaceAnatomy>` in the Canvas) when `mode === 'workspace'`.
 *
 * label/letter override the `Workspace`/`W` strings in `FloatingIsland`'s
 * mode-tabs rendering. Vellum's standalone host (App.tsx → main.tsx) doesn't
 * provide the context, so the defaults survive.
 */
import { createContext, useContext, type ReactNode } from 'react';

export interface WorkspaceSlotValue {
  /** When non-null, replaces `<WorkspaceView>` (and suppresses
   *  `<WorkspaceAnatomy>`) for the Workspace tab. */
  slot: ReactNode | null;
  /** Override label for the Workspace tab in FloatingIsland's wide layout
   *  ("Workspace" → "Kanban"). Null = default. */
  label: string | null;
  /** Override single-letter glyph for the Workspace tab in FloatingIsland's
   *  narrow layout ("W" → "K"). Null = default. */
  letter: string | null;
}

const DEFAULT_VALUE: WorkspaceSlotValue = {
  slot: null,
  label: null,
  letter: null,
};

const WorkspaceSlotContext = createContext<WorkspaceSlotValue>(DEFAULT_VALUE);

export function WorkspaceSlotProvider({
  value,
  children,
}: {
  value: WorkspaceSlotValue;
  children: ReactNode;
}) {
  return (
    <WorkspaceSlotContext.Provider value={value}>
      {children}
    </WorkspaceSlotContext.Provider>
  );
}

export function useWorkspaceSlot(): WorkspaceSlotValue {
  return useContext(WorkspaceSlotContext);
}
