/**
 * AnnotationPopover — shared edit/delete/action surface for an
 * existing annotation, used by both `TextAnnotationLayer` (prose) and
 * `FileReader` (CodeMirror) so the click-into-existing-note experience
 * is identical across substrates. Both call sites independently
 * implemented this view; this component is the consolidation.
 *
 * Two visual states:
 *   - **Default**: shows a truncated selectedText snippet, the comment
 *     text, and a row of action buttons (Edit, host-supplied
 *     per-annotation actions, Delete). Time of creation appears at
 *     the bottom in muted mono.
 *   - **Edit mode**: replaces the comment-display block with a
 *     textarea + Save/Cancel. Enter (no shift) submits, Escape
 *     cancels back to the default view.
 *
 * Positioning is left to the caller — the substrate decides whether
 * coordinates are viewport-relative (`position: fixed`) or
 * wrapper-relative (`position: absolute`). The component just renders
 * a fragment with the chosen `position` strategy applied.
 */

import { useCallback, useState } from 'react';
import type { Annotation, AnnotationAction } from '../utils/content-types';

interface AnnotationPopoverProps {
  annotation: Annotation;
  /** Pixel coordinates for the popover's top-left corner. Interpreted
   *  in the coordinate space implied by `positionStrategy`. */
  top: number;
  left: number;
  /** `'fixed'` (viewport-relative) or `'absolute'` (offset-parent-
   *  relative). Defaults to `'fixed'` to match TextAnnotationLayer's
   *  legacy positioning; FileReader passes `'absolute'`. */
  positionStrategy?: 'fixed' | 'absolute';
  /** Persist a comment edit. The handler is responsible for the
   *  network call and the upstream annotation list update; the
   *  popover then closes its edit state automatically on resolve. */
  onEdit: (nextComment: string) => void | Promise<void>;
  /** Delete the annotation. Same contract — handler owns persistence
   *  + list update; the popover dismisses itself on resolve via
   *  `onClose`. */
  onDelete: () => void | Promise<void>;
  /** Optional host-supplied per-annotation actions (e.g. "Send",
   *  "Save as fiber"). Rendered between Edit and Delete in default
   *  view. Each action receives the annotation. */
  actions?: AnnotationAction[];
  /** Fired when the popover should close — after a successful Edit
   *  or Delete. The host (TextAnnotationLayer / FileReader) clears
   *  its `activePopover` state. */
  onClose?: () => void;
}

export function AnnotationPopover({
  annotation,
  top,
  left,
  positionStrategy = 'fixed',
  onEdit,
  onDelete,
  actions,
  onClose,
}: AnnotationPopoverProps) {
  // null → default view; string → edit mode with this initial value.
  // Resetting to null on Escape returns to default view without
  // dismissing the popover, matching the legacy behavior at both
  // call sites.
  const [editingComment, setEditingComment] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (editingComment === null) return;
    const next = editingComment.trim();
    if (!next) return;
    await onEdit(next);
    setEditingComment(null);
    onClose?.();
  }, [editingComment, onEdit, onClose]);

  const handleDelete = useCallback(async () => {
    await onDelete();
    onClose?.();
  }, [onDelete, onClose]);

  return (
    <div
      className="ann-popover"
      style={{ position: positionStrategy, top, left }}
    >
      <div className="ann-popover__selected">
        "{annotation.selectedText.length > 60
          ? `${annotation.selectedText.slice(0, 60)}…`
          : annotation.selectedText}"
      </div>
      {editingComment !== null ? (
        <div className="ann-popover__edit">
          <textarea
            className="ann-popover__input"
            value={editingComment}
            onChange={(e) => setEditingComment(e.target.value)}
            onKeyDown={(e) => {
              // Stop propagation so a host's CodeMirror keymap
              // doesn't swallow Enter/Escape — FileReader's wrapper
              // textarea did this; preserve the behavior.
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              } else if (e.key === 'Escape') {
                setEditingComment(null);
              }
            }}
            rows={2}
            autoFocus
          />
          <div className="ann-toolbar__actions">
            <button
              type="button"
              className="ann-toolbar__submit"
              onClick={() => void handleSubmit()}
            >
              Save
            </button>
            <button
              type="button"
              className="ann-toolbar__cancel"
              onClick={() => setEditingComment(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="ann-popover__comment">{annotation.comment}</div>
      )}
      <div className="ann-popover__actions">
        {editingComment === null && (
          <button
            type="button"
            className="ann-popover__btn"
            onClick={() => setEditingComment(annotation.comment)}
          >
            Edit
          </button>
        )}
        {/* Host-supplied per-annotation actions sit between Edit and
            Delete in the default view. Hidden in edit mode so the
            user is committed to one outcome at a time. */}
        {editingComment === null &&
          actions?.map((action) => (
            <button
              key={action.id}
              type="button"
              className="ann-popover__btn ann-popover__btn--action"
              title={action.title ?? action.label}
              onClick={() => {
                void action.onInvoke(annotation);
              }}
            >
              {action.label}
            </button>
          ))}
        <button
          type="button"
          className="ann-popover__btn ann-popover__btn--delete"
          onClick={() => void handleDelete()}
        >
          Delete
        </button>
      </div>
      {annotation.createdAt ? (
        <div className="ann-popover__time">
          {new Date(annotation.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      ) : null}
    </div>
  );
}
