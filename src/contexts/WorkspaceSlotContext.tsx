/**
 * WorkspaceSlotContext — embedding-host hook for replacing tab bodies.
 *
 * Vellum ships four modes (Narrative / Workspace / Find / Delta). Standalone
 * vellum uses the built-in `<WorkspaceView>` for the Workspace tab and renders
 * nothing for Find. Embedding hosts (portolan) override these tabs' bodies via
 * slot fields: `workspaceSlot` carries the kanban grid, `findSlot` carries the
 * cross-project find tab.
 *
 * Rather than punch a hole through every consumer (FiberPage, FloatingIsland)
 * with a new prop chain, the host hands `WorkspaceMount` a slot + label/letter
 * trio per mode; we provide them here for any descendant to read. When a slot
 * is non-null, FiberPage renders it instead of the built-in view for that
 * mode.
 *
 * label/letter override the default strings in `FloatingIsland`'s mode-tabs
 * rendering ("Workspace" → "Kanban"; "Find" stays "Find" by default). Vellum's
 * standalone host (App.tsx → main.tsx) doesn't provide the context, so the
 * defaults survive.
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
  /** When non-null, FiberPage renders this for the Find tab instead of
   *  showing nothing. The Find tab itself is always rendered in vellum's
   *  mode strip; without a slot it shows an empty state. */
  findSlot: ReactNode | null;
  /** Override label for the Find tab in FloatingIsland's wide layout.
   *  Null = default ("Find"). */
  findLabel: string | null;
  /** Override single-letter glyph for the Find tab in narrow layout.
   *  Null = default ("F"). */
  findLetter: string | null;
}

const DEFAULT_VALUE: WorkspaceSlotValue = {
  slot: null,
  label: null,
  letter: null,
  findSlot: null,
  findLabel: null,
  findLetter: null,
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
