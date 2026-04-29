/**
 * AnnotationActionsContext — host hook for annotation actions on fiber
 * pages.
 *
 * Two action shapes flow through here:
 *
 *   - **bulkActions**: rendered above the article masthead by
 *     `NarrativeAnnotationActionsBar` once annotations have been
 *     persisted. Each action operates on a filtered subset of the
 *     fiber's annotations (worker-dispatch, "Clear sent", "File as
 *     fiber" the bulk variant).
 *   - **singleActions**: rendered inside the floating selection toolbar
 *     by `TextAnnotationLayer` while a fresh prose selection is active
 *     (no annotation persisted yet). The canonical case is "+ Fiber" —
 *     promoting the selection into a new draft fiber in a single
 *     gesture, the read→author bridge from the vellum-marginalia
 *     constitution and the meeting-2026-04-04 three-tier ladder.
 *
 * `FileViewerModal` and `FileViewerPage` accept `headerAnnotationActions`
 * directly because their host (typically a portolan-style file mount)
 * already knows the file path and can construct path-specific actions.
 * Fiber pages live deeper in the SPA and the actions a host wants to
 * expose are typically global (every fiber gets the same "Send to
 * worker" / "File as fiber" affordance), so we surface them through a
 * context rather than thread `headerAnnotationActions` down through
 * `FiberPage` → `NarrativeView`.
 *
 * Vellum exports `AnnotationActionsProvider` and `useAnnotationActions()`
 * so a host can wrap its mount tree with whatever actions it supports.
 * Default is empty for both, which is what published vellum-demos
 * surfaces want — they shouldn't expose worker-dispatch or
 * fiber-creation UI against a read-only bake.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type {
  AnnotationBulkAction,
  AnnotationSingleAction,
} from '../utils/content-types';

interface AnnotationActionsContextValue {
  /**
   * Bulk actions rendered as buttons above the article when at least one
   * annotation is present. Each action sees the annotation list filtered
   * by its own `applicableTo` predicate (if provided) and is invoked
   * with that filtered subset.
   */
  bulkActions: AnnotationBulkAction[];
  /**
   * Single-selection actions rendered inside the selection toolbar while
   * a fresh prose selection is active. Each receives the
   * `{selectedText, contextBefore, contextAfter}` triple plus a
   * `{currentSlug, navigate}` ctx so the handler can call into mystra
   * (or any host endpoint) and route the user to the artifact it
   * produces.
   */
  singleActions: AnnotationSingleAction[];
}

const AnnotationActionsContext = createContext<AnnotationActionsContextValue>({
  bulkActions: [],
  singleActions: [],
});

export function AnnotationActionsProvider({
  bulkActions,
  singleActions = [],
  children,
}: {
  bulkActions: AnnotationBulkAction[];
  singleActions?: AnnotationSingleAction[];
  children: ReactNode;
}) {
  return (
    <AnnotationActionsContext.Provider value={{ bulkActions, singleActions }}>
      {children}
    </AnnotationActionsContext.Provider>
  );
}

export function useAnnotationActions(): AnnotationActionsContextValue {
  return useContext(AnnotationActionsContext);
}
