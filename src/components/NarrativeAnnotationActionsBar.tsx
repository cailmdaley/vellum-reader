/**
 * NarrativeAnnotationActionsBar — fiber-page version of the bulk-action
 * row that lives in `FileViewerModal`'s header.
 *
 * Sits above the FiberHeader masthead when both (a) the host registered
 * actions via `AnnotationActionsProvider` and (b) at least one
 * annotation is present on the fiber. Each registered action is filtered
 * by its `applicableTo` predicate before rendering — actions like "Clear
 * sent" don't surface unless at least one annotation matches — and on
 * click receives that filtered subset alongside `{ anchor,
 * refreshAnnotations }` for popover positioning and post-mutation
 * refetch.
 *
 * Visually: a compact monospace strip with a count caption ("3
 * annotations") followed by a button per action. Theme-agnostic; it
 * mounts inside the prose wrapper so all theme chrome gates leave it
 * alone.
 */

import { useRef } from 'react';
import type { Annotation, AnnotationBulkAction } from '../utils/content-types';

interface NarrativeAnnotationActionsBarProps {
  annotations: Annotation[];
  bulkActions: AnnotationBulkAction[];
  /**
   * Called by an action's `onInvoke` `ctx.refreshAnnotations` so the bar's
   * host (NarrativeView) re-fetches annotations after the action mutates
   * them — e.g. "Clear sent" deletes the matching subset and the bar
   * needs to re-read from the adapter.
   */
  onRefreshAnnotations: () => void;
}

export function NarrativeAnnotationActionsBar({
  annotations,
  bulkActions,
  onRefreshAnnotations,
}: NarrativeAnnotationActionsBarProps) {
  // Live ref on the latest annotation list. The button's onClick captures
  // the array at mount time otherwise; long-running pickers (worker
  // picker, etc.) would dispatch against a stale list.
  const annotationsRef = useRef<Annotation[]>(annotations);
  annotationsRef.current = annotations;

  if (bulkActions.length === 0) return null;
  if (annotations.length === 0) return null;

  // Pre-filter once for the visible-button decision; the click handler
  // re-filters from `annotationsRef.current` so a refresh that lands
  // between render and click sees the current set.
  const visibleActions = bulkActions
    .map((action) => {
      const applicable = action.applicableTo
        ? annotations.filter(action.applicableTo)
        : annotations;
      return { action, count: applicable.length };
    })
    .filter(({ count }) => count > 0);

  if (visibleActions.length === 0) return null;

  return (
    <div
      className="vellum-narrative-action-bar"
      role="toolbar"
      aria-label="Annotation actions"
    >
      <span className="vellum-narrative-action-bar__caption">
        {annotations.length} annotation{annotations.length === 1 ? '' : 's'}
      </span>
      <div className="vellum-narrative-action-bar__buttons">
        {visibleActions.map(({ action, count }) => (
          <button
            key={action.id}
            type="button"
            className="vellum-modal-btn vellum-modal-btn--bulk"
            title={action.title ?? action.label}
            onClick={(e) => {
              const matched = action.applicableTo
                ? annotationsRef.current.filter(action.applicableTo)
                : annotationsRef.current;
              void action.onInvoke(matched, {
                anchor: e.currentTarget as HTMLElement,
                refreshAnnotations: onRefreshAnnotations,
              });
            }}
          >
            {action.label}
            <span className="vellum-modal-btn__count">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
