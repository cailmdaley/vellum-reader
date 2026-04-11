/**
 * TextAnnotationLayer — text selection annotations with left-margin dots.
 *
 * The left margin is conversational (what the reader thought), mirroring
 * the right margin's structural citation glyphs.
 *
 * Flow:
 *   1. User selects text in prose → floating "Add note" toolbar appears
 *   2. Click → comment textarea opens → submit saves via /api/annotations
 *   3. Annotated text gets gold highlight; small dot appears in left margin
 *   4. Click highlight or dot → popover shows comment, with edit/delete
 *
 * Highlights are rendered by finding the annotation's selectedText in the
 * DOM text content and wrapping it with a <mark> element. Context strings
 * (contextBefore/contextAfter) improve matching when text is duplicated.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation } from '~/utils/content-types';
import {
  createAnnotation,
  deleteAnnotation,
  updateAnnotation,
} from '~/utils/api-client';

interface TextAnnotationLayerProps {
  slug: string;
  annotations: Annotation[];
  proseRef: React.RefObject<HTMLElement>;
  wrapperRef: React.RefObject<HTMLElement>;
  onAnnotationsChange: (annotations: Annotation[]) => void;
}

/** Extract text around a selection for re-anchoring. */
function getContext(sel: Selection, charsBefore = 30, charsAfter = 30): {
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
} {
  const range = sel.getRangeAt(0);
  const selectedText = range.toString();

  // Walk backward from start to get context before
  const preRange = document.createRange();
  const container = range.startContainer.parentElement?.closest('.vellum-prose') ?? document.body;
  preRange.setStart(container, 0);
  preRange.setEnd(range.startContainer, range.startOffset);
  const preText = preRange.toString();
  const contextBefore = preText.slice(-charsBefore);

  // Walk forward from end to get context after
  const postRange = document.createRange();
  postRange.setStart(range.endContainer, range.endOffset);
  postRange.setEnd(container, container.childNodes.length);
  const postText = postRange.toString();
  const contextAfter = postText.slice(0, charsAfter);

  return { selectedText, contextBefore, contextAfter };
}

/** Find annotation text in the prose DOM and return its bounding rect. */
function findAnnotationInDom(
  prose: HTMLElement,
  ann: Annotation,
): Range | null {
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  let accumulated = '';
  const textNodes: { node: Text; start: number }[] = [];

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    textNodes.push({ node, start: accumulated.length });
    accumulated += node.textContent ?? '';
  }

  if (textNodes.length === 0) return null;

  // Find the selectedText in the accumulated text, using context for disambiguation
  const needle = ann.selectedText;
  let searchFrom = 0;
  let bestIdx = -1;

  // Try all occurrences, prefer the one whose surrounding context matches
  while (true) {
    const idx = accumulated.indexOf(needle, searchFrom);
    if (idx === -1) break;

    if (ann.contextBefore || ann.contextAfter) {
      const before = accumulated.slice(Math.max(0, idx - 30), idx);
      const after = accumulated.slice(idx + needle.length, idx + needle.length + 30);
      const matchScore =
        (ann.contextBefore && before.endsWith(ann.contextBefore.slice(-15)) ? 1 : 0) +
        (ann.contextAfter && after.startsWith(ann.contextAfter.slice(0, 15)) ? 1 : 0);

      if (matchScore > 0 || bestIdx === -1) {
        bestIdx = idx;
        if (matchScore > 0) break; // good enough match
      }
    } else {
      bestIdx = idx;
      break;
    }

    searchFrom = idx + 1;
  }

  if (bestIdx === -1) return null;

  // Convert character offset to DOM Range
  const startOffset = bestIdx;
  const endOffset = bestIdx + needle.length;

  let startNode: Text | null = null;
  let startNodeOffset = 0;
  let endNode: Text | null = null;
  let endNodeOffset = 0;

  for (const tn of textNodes) {
    const nodeEnd = tn.start + (tn.node.textContent?.length ?? 0);
    if (!startNode && startOffset < nodeEnd) {
      startNode = tn.node;
      startNodeOffset = startOffset - tn.start;
    }
    if (endOffset <= nodeEnd) {
      endNode = tn.node;
      endNodeOffset = endOffset - tn.start;
      break;
    }
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, startNodeOffset);
  range.setEnd(endNode, endNodeOffset);
  return range;
}

interface AnnotationMark {
  annotation: Annotation;
  top: number;
  markEls: HTMLElement[];
}

export function TextAnnotationLayer({
  slug,
  annotations,
  proseRef,
  wrapperRef,
  onAnnotationsChange,
}: TextAnnotationLayerProps) {
  // Selection toolbar state
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [selectionContext, setSelectionContext] = useState<{
    selectedText: string;
    contextBefore: string;
    contextAfter: string;
  } | null>(null);

  // Annotation highlights
  const [marks, setMarks] = useState<AnnotationMark[]>([]);

  // Popover state
  const [activePopover, setActivePopover] = useState<{
    annotation: Annotation;
    rect: DOMRect;
  } | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);

  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  // Listen for text selection in the prose
  useEffect(() => {
    const prose = proseRef.current;
    if (!prose) return;

    function handleMouseUp() {
      // Delay to let the selection finalize
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          // Don't clear if we're interacting with the toolbar/popover
          return;
        }

        // Only handle selections within the prose
        const range = sel.getRangeAt(0);
        if (!prose!.contains(range.commonAncestorContainer)) return;

        const selectedText = sel.toString().trim();
        if (selectedText.length < 3) return; // ignore tiny selections

        const rect = range.getBoundingClientRect();
        setSelectionRect(rect);
        setShowCommentBox(false);
        setCommentText('');
        setSelectionContext(getContext(sel));
      });
    }

    prose.addEventListener('mouseup', handleMouseUp);
    return () => prose.removeEventListener('mouseup', handleMouseUp);
  }, [proseRef]);

  // Dismiss toolbar on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('.ann-toolbar') || target.closest('.ann-popover')) return;
      // If clicking a highlight mark, don't dismiss
      if (target.closest('.ann-highlight')) return;
      if (target.closest('.ann-margin-dot')) return;
      setSelectionRect(null);
      setShowCommentBox(false);
      setActivePopover(null);
      setEditingComment(null);
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Render annotation highlights in the DOM
  useEffect(() => {
    const prose = proseRef.current;
    const wrapper = wrapperRef.current;
    if (!prose || !wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const newMarks: AnnotationMark[] = [];
    const allMarkEls: HTMLElement[] = [];

    for (const ann of annotations) {
      const range = findAnnotationInDom(prose, ann);
      if (!range) continue;

      // Wrap the range with <mark> elements (may span multiple text nodes)
      try {
        // Use surroundContents for simple ranges, or extractContents for complex ones
        const rects = Array.from(range.getClientRects());
        if (rects.length === 0) continue;

        // Create highlight wrapper
        const mark = document.createElement('mark');
        mark.className = 'ann-highlight';
        mark.dataset.annotationId = ann.id;

        // Try surroundContents first (works when range is within one element)
        try {
          range.surroundContents(mark);
          allMarkEls.push(mark);

          const markRect = mark.getBoundingClientRect();
          const top = markRect.top - wrapperRect.top + window.scrollY;
          newMarks.push({ annotation: ann, top, markEls: [mark] });
        } catch {
          // Range spans multiple elements — highlight each text node separately
          const startContainer = range.startContainer;
          const endContainer = range.endContainer;
          const markEls: HTMLElement[] = [];

          // Collect text nodes in range
          const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
          let inRange = false;
          let currentNode: Text | null;
          const nodesToWrap: Array<{ node: Text; start: number; end: number }> = [];

          while ((currentNode = walker.nextNode() as Text | null)) {
            if (currentNode === startContainer) {
              inRange = true;
              nodesToWrap.push({
                node: currentNode,
                start: range.startOffset,
                end: currentNode === endContainer ? range.endOffset : (currentNode.textContent?.length ?? 0),
              });
              if (currentNode === endContainer) break;
              continue;
            }
            if (currentNode === endContainer) {
              nodesToWrap.push({
                node: currentNode,
                start: 0,
                end: range.endOffset,
              });
              break;
            }
            if (inRange) {
              nodesToWrap.push({
                node: currentNode,
                start: 0,
                end: currentNode.textContent?.length ?? 0,
              });
            }
          }

          for (const { node, start, end } of nodesToWrap) {
            if (start === end) continue;
            const subRange = document.createRange();
            subRange.setStart(node, start);
            subRange.setEnd(node, end);
            const m = document.createElement('mark');
            m.className = 'ann-highlight';
            m.dataset.annotationId = ann.id;
            try {
              subRange.surroundContents(m);
              markEls.push(m);
              allMarkEls.push(m);
            } catch {
              // Skip nodes that can't be wrapped
            }
          }

          if (markEls.length > 0) {
            const firstRect = markEls[0]!.getBoundingClientRect();
            const top = firstRect.top - wrapperRect.top + window.scrollY;
            newMarks.push({ annotation: ann, top, markEls });
          }
        }
      } catch {
        // Skip annotations that can't be rendered
      }
    }

    setMarks(newMarks);

    // Click handler for highlight marks
    function handleHighlightClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const mark = target.closest('.ann-highlight');
      if (!mark) return;
      const annId = (mark as HTMLElement).dataset.annotationId;
      const ann = annotations.find((a) => a.id === annId);
      if (!ann) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = mark.getBoundingClientRect();
      setActivePopover({ annotation: ann, rect });
      setEditingComment(null);
      setSelectionRect(null);
    }

    prose.addEventListener('click', handleHighlightClick, true);

    // Cleanup: unwrap all marks, merge adjacent text nodes
    return () => {
      prose.removeEventListener('click', handleHighlightClick, true);
      for (const el of allMarkEls) {
        const parent = el.parentNode;
        if (!parent) continue;
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
        parent.normalize();
      }
    };
  }, [annotations, proseRef, wrapperRef]);

  // Submit new annotation
  const handleSubmit = useCallback(async () => {
    if (!selectionContext || !commentText.trim()) return;
    const ann = await createAnnotation({
      slug,
      selectedText: selectionContext.selectedText,
      contextBefore: selectionContext.contextBefore,
      contextAfter: selectionContext.contextAfter,
      comment: commentText.trim(),
    });
    if (ann) {
      onAnnotationsChange([...annotations, ann]);
      setSelectionRect(null);
      setShowCommentBox(false);
      setCommentText('');
      setSelectionContext(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [slug, selectionContext, commentText, annotations, onAnnotationsChange]);

  // Update annotation comment
  const handleUpdate = useCallback(async (id: string, comment: string) => {
    const ann = await updateAnnotation(id, comment);
    if (ann) {
      onAnnotationsChange(annotations.map((a) => (a.id === id ? ann : a)));
      setActivePopover(null);
      setEditingComment(null);
    }
  }, [annotations, onAnnotationsChange]);

  // Delete annotation
  const handleDelete = useCallback(async (id: string) => {
    if (await deleteAnnotation(id)) {
      onAnnotationsChange(annotations.filter((a) => a.id !== id));
      setActivePopover(null);
    }
  }, [annotations, onAnnotationsChange]);

  // Handle margin dot click
  const handleDotClick = useCallback((ann: Annotation, mark: AnnotationMark) => {
    // Find the first mark element for this annotation
    const el = mark.markEls[0];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setActivePopover({ annotation: ann, rect });
    setEditingComment(null);
    setSelectionRect(null);
  }, []);

  // Focus comment input when opened
  useEffect(() => {
    if (showCommentBox && commentInputRef.current) {
      commentInputRef.current.focus();
    }
  }, [showCommentBox]);

  // Stack margin dots that are too close
  const positionedMarks = (() => {
    const MIN_GAP = 16;
    let lastTop = -999;
    return marks.map((m) => {
      const t = Math.max(m.top, lastTop + MIN_GAP);
      lastTop = t;
      return { ...m, displayTop: t };
    });
  })();

  return (
    <>
      {/* Selection toolbar — floating above the selection */}
      {selectionRect && !showCommentBox && (
        <div
          className="ann-toolbar"
          style={{
            position: 'fixed',
            top: selectionRect.top - 40,
            left: selectionRect.left + selectionRect.width / 2,
            transform: 'translateX(-50%)',
          }}
        >
          <button
            className="ann-toolbar__btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowCommentBox(true);
            }}
          >
            + Note
          </button>
        </div>
      )}

      {/* Comment box — below toolbar position */}
      {selectionRect && showCommentBox && (
        <div
          className="ann-toolbar ann-toolbar--comment"
          style={{
            position: 'fixed',
            top: selectionRect.bottom + 8,
            left: selectionRect.left,
          }}
        >
          <textarea
            ref={commentInputRef}
            className="ann-toolbar__input"
            placeholder="Add a note..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
              if (e.key === 'Escape') {
                setShowCommentBox(false);
                setSelectionRect(null);
              }
            }}
            rows={2}
          />
          <div className="ann-toolbar__actions">
            <button
              className="ann-toolbar__submit"
              disabled={!commentText.trim()}
              onClick={handleSubmit}
            >
              Save
            </button>
            <button
              className="ann-toolbar__cancel"
              onClick={() => {
                setShowCommentBox(false);
                setSelectionRect(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Left margin dots */}
      {positionedMarks.map((m) => (
        <div
          key={m.annotation.id}
          className="ann-margin-dot"
          style={{ top: m.displayTop }}
          onClick={() => handleDotClick(m.annotation, m)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && handleDotClick(m.annotation, m)}
          title={m.annotation.comment}
        />
      ))}

      {/* Annotation popover */}
      {activePopover && (
        <div
          className="ann-popover"
          style={{
            position: 'fixed',
            top: activePopover.rect.bottom + 8,
            left: activePopover.rect.left,
          }}
        >
          <div className="ann-popover__selected">
            "{activePopover.annotation.selectedText.length > 60
              ? activePopover.annotation.selectedText.slice(0, 60) + '…'
              : activePopover.annotation.selectedText}"
          </div>
          {editingComment !== null ? (
            <div className="ann-popover__edit">
              <textarea
                className="ann-popover__input"
                value={editingComment}
                onChange={(e) => setEditingComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleUpdate(activePopover.annotation.id, editingComment);
                  }
                  if (e.key === 'Escape') setEditingComment(null);
                }}
                rows={2}
                autoFocus
              />
              <div className="ann-toolbar__actions">
                <button
                  className="ann-toolbar__submit"
                  onClick={() => handleUpdate(activePopover.annotation.id, editingComment)}
                >
                  Save
                </button>
                <button className="ann-toolbar__cancel" onClick={() => setEditingComment(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="ann-popover__comment">{activePopover.annotation.comment}</div>
          )}
          <div className="ann-popover__actions">
            {editingComment === null && (
              <button
                className="ann-popover__btn"
                onClick={() => setEditingComment(activePopover.annotation.comment)}
              >
                Edit
              </button>
            )}
            <button
              className="ann-popover__btn ann-popover__btn--delete"
              onClick={() => handleDelete(activePopover.annotation.id)}
            >
              Delete
            </button>
          </div>
          <div className="ann-popover__time">
            {new Date(activePopover.annotation.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
      )}
    </>
  );
}
