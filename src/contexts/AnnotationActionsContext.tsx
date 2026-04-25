/**
 * AnnotationActionsContext — host hook for annotation bulk actions on
 * fiber pages.
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
 * so a host can wrap its mount tree with whatever bulk actions it
 * supports. Default is empty, which is what published vellum-demos
 * surfaces want — they shouldn't expose worker-dispatch UI.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { AnnotationBulkAction } from '../utils/content-types';

interface AnnotationActionsContextValue {
  /**
   * Bulk actions rendered as buttons above the article when at least one
   * annotation is present. Each action sees the annotation list filtered
   * by its own `applicableTo` predicate (if provided) and is invoked
   * with that filtered subset.
   */
  bulkActions: AnnotationBulkAction[];
}

const AnnotationActionsContext = createContext<AnnotationActionsContextValue>({
  bulkActions: [],
});

export function AnnotationActionsProvider({
  bulkActions,
  children,
}: {
  bulkActions: AnnotationBulkAction[];
  children: ReactNode;
}) {
  return (
    <AnnotationActionsContext.Provider value={{ bulkActions }}>
      {children}
    </AnnotationActionsContext.Provider>
  );
}

export function useAnnotationActions(): AnnotationActionsContextValue {
  return useContext(AnnotationActionsContext);
}
