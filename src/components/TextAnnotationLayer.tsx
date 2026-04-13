import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation } from '~/utils/content-types';
import { createAnnotation, deleteAnnotation, updateAnnotation } from '~/api';

interface TextAnnotationLayerProps {
  slug: string;
  annotations: Annotation[];
  proseRef: React.RefObject<HTMLElement>;
  wrapperRef: React.RefObject<HTMLElement>;
  onAnnotationsChange: (annotations: Annotation[]) => void;
}

/**
 * Collapse runs of whitespace (including \n, \t) into a single space and trim.
 *
 * Pretext's flat absolute-positioned DOM has no \n between paragraphs — the
 * TreeWalker sees "end of para.Start of next para" with no separator. MyST's
 * flowed DOM does insert \n between block elements. Normalizing to single
 * spaces lets annotations saved under either renderer re-anchor under either.
 */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function getContext(sel: Selection, charsBefore = 30, charsAfter = 30) {
  const range = sel.getRangeAt(0);
  const selectedText = normalizeWhitespace(range.toString());
  const preRange = document.createRange();
  const container = range.startContainer.parentElement?.closest('.vellum-prose') ?? document.body;
  preRange.setStart(container, 0);
  preRange.setEnd(range.startContainer, range.startOffset);
  const contextBefore = normalizeWhitespace(preRange.toString()).slice(-charsBefore);

  const postRange = document.createRange();
  postRange.setStart(range.endContainer, range.endOffset);
  postRange.setEnd(container, container.childNodes.length);
  const contextAfter = normalizeWhitespace(postRange.toString()).slice(0, charsAfter);

  return { selectedText, contextBefore, contextAfter };
}

/**
 * Build the raw text stream from the prose DOM and a parallel mapping from
 * normalized-string offsets to raw-string offsets. The normalized stream
 * collapses whitespace runs so that annotations saved from either renderer
 * match the current DOM.
 *
 * Returns:
 *   - `raw`: concatenated text-node content (used for Range offset math)
 *   - `normalized`: whitespace-collapsed version of `raw`
 *   - `normToRaw`: for each index in `normalized`, the corresponding index in `raw`
 *   - `textNodes`: per-node start offsets into `raw`
 */
function buildTextIndex(prose: HTMLElement) {
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  let raw = '';
  const textNodes: { node: Text; start: number }[] = [];

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    textNodes.push({ node, start: raw.length });
    raw += node.textContent ?? '';
  }

  // Build normalized string and the offset map in a single pass.
  const normToRaw: number[] = [];
  let normalized = '';
  let inSpace = false;
  // Skip leading whitespace (mirrors trim()).
  let started = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const isWs = /\s/.test(ch);
    if (!started) {
      if (isWs) continue;
      started = true;
    }
    if (isWs) {
      inSpace = true;
    } else {
      if (inSpace) {
        normToRaw.push(i - 1); // map the collapsed space to the last ws char
        normalized += ' ';
        inSpace = false;
      }
      normToRaw.push(i);
      normalized += ch;
    }
  }

  return { raw, normalized, normToRaw, textNodes };
}

function findAnnotationInDom(prose: HTMLElement, ann: Annotation): Range | null {
  const { raw, normalized, normToRaw, textNodes } = buildTextIndex(prose);
  if (textNodes.length === 0) return null;

  const needle = normalizeWhitespace(ann.selectedText);
  if (needle.length === 0) return null;

  let searchFrom = 0;
  let bestIdx = -1;

  const normContext = (s: string | undefined) => s ? normalizeWhitespace(s) : '';

  while (true) {
    const idx = normalized.indexOf(needle, searchFrom);
    if (idx === -1) break;

    if (ann.contextBefore || ann.contextAfter) {
      const before = normalized.slice(Math.max(0, idx - 30), idx);
      const after = normalized.slice(idx + needle.length, idx + needle.length + 30);
      const normBefore = normContext(ann.contextBefore);
      const normAfter = normContext(ann.contextAfter);
      const matchScore =
        (normBefore && before.endsWith(normBefore.slice(-15)) ? 1 : 0) +
        (normAfter && after.startsWith(normAfter.slice(0, 15)) ? 1 : 0);

      if (matchScore > 0 || bestIdx === -1) {
        bestIdx = idx;
        if (matchScore > 0) break;
      }
    } else {
      bestIdx = idx;
      break;
    }

    searchFrom = idx + 1;
  }

  if (bestIdx === -1) return null;

  // Map normalized offsets back to raw offsets.
  const rawStart = normToRaw[bestIdx];
  const rawEnd = bestIdx + needle.length < normToRaw.length
    ? normToRaw[bestIdx + needle.length]!
    : raw.length;
  if (rawStart == null) return null;

  let startNode: Text | null = null;
  let startNodeOffset = 0;
  let endNode: Text | null = null;
  let endNodeOffset = 0;

  for (const tn of textNodes) {
    const nodeEnd = tn.start + (tn.node.textContent?.length ?? 0);
    if (!startNode && rawStart < nodeEnd) {
      startNode = tn.node;
      startNodeOffset = rawStart - tn.start;
    }
    if (rawEnd <= nodeEnd) {
      endNode = tn.node;
      endNodeOffset = rawEnd - tn.start;
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
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [selectionContext, setSelectionContext] = useState<{
    selectedText: string;
    contextBefore: string;
    contextAfter: string;
  } | null>(null);
  const [marks, setMarks] = useState<AnnotationMark[]>([]);
  const [activePopover, setActivePopover] = useState<{
    annotation: Annotation;
    rect: DOMRect;
  } | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const prose = proseRef.current;
    if (!prose) return;
    const proseEl = prose;

    function handleMouseUp() {
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!proseEl.contains(range.commonAncestorContainer)) return;

        const selectedText = sel.toString().trim();
        if (selectedText.length < 3) return;

        setSelectionRect(range.getBoundingClientRect());
        setShowCommentBox(false);
        setCommentText('');
        setSelectionContext(getContext(sel));
      });
    }

    prose.addEventListener('mouseup', handleMouseUp);
    return () => prose.removeEventListener('mouseup', handleMouseUp);
  }, [proseRef]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('.ann-toolbar') || target.closest('.ann-popover')) return;
      if (target.closest('.ann-highlight')) return;
      if (target.closest('.ann-margin-note')) return;
      setSelectionRect(null);
      setShowCommentBox(false);
      setActivePopover(null);
      setEditingComment(null);
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    const prose = proseRef.current;
    const wrapper = wrapperRef.current;
    if (!prose || !wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const newMarks: AnnotationMark[] = [];
    const allMarkEls: HTMLElement[] = [];

    // Same approach as MarginCitations: read each mark's enclosing
    // pretext line and use its `data-pretext-line-top` attribute as
    // the authoritative y. Pretext lays out lines at exact pixel
    // coordinates inside .pretext-prose; reading those coords beats
    // measuring DOM rects (which can drift under reflow, scroll, or
    // partial layout) and matches the strategy used by every other
    // marginalia stack so glyphs and notes stay aligned the same way.
    const pretextBox = prose.querySelector<HTMLElement>('.pretext-prose');
    const pretextOriginTop = pretextBox
      ? pretextBox.getBoundingClientRect().top - wrapperRect.top
      : null;
    const topForMark = (mark: HTMLElement): number => {
      const line = mark.closest<HTMLElement>('[data-pretext-line-top]');
      if (line && pretextOriginTop != null) {
        return pretextOriginTop + Number(line.dataset['pretextLineTop']);
      }
      return mark.getBoundingClientRect().top - wrapperRect.top;
    };

    for (const ann of annotations) {
      const range = findAnnotationInDom(prose, ann);
      if (!range) continue;

      try {
        const rects = Array.from(range.getClientRects());
        if (rects.length === 0) continue;

        const mark = document.createElement('mark');
        mark.className = 'ann-highlight';
        mark.dataset.annotationId = ann.id;

        try {
          range.surroundContents(mark);
          allMarkEls.push(mark);
          newMarks.push({ annotation: ann, top: topForMark(mark), markEls: [mark] });
        } catch {
          const startContainer = range.startContainer;
          const endContainer = range.endContainer;
          const markEls: HTMLElement[] = [];
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
              nodesToWrap.push({ node: currentNode, start: 0, end: range.endOffset });
              break;
            }
            if (inRange) {
              nodesToWrap.push({ node: currentNode, start: 0, end: currentNode.textContent?.length ?? 0 });
            }
          }

          for (const { node, start, end } of nodesToWrap) {
            if (start === end) continue;
            const subRange = document.createRange();
            subRange.setStart(node, start);
            subRange.setEnd(node, end);
            const nextMark = document.createElement('mark');
            nextMark.className = 'ann-highlight';
            nextMark.dataset.annotationId = ann.id;
            try {
              subRange.surroundContents(nextMark);
              markEls.push(nextMark);
              allMarkEls.push(nextMark);
            } catch {
              // Skip nodes that can't be wrapped.
            }
          }

          if (markEls.length > 0) {
            newMarks.push({ annotation: ann, top: topForMark(markEls[0]!), markEls });
          }
        }
      } catch {
        // Skip annotations that can't be rendered.
      }
    }

    setMarks(newMarks);

    function handleHighlightClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const mark = target.closest('.ann-highlight');
      if (!mark) return;
      const annId = mark.getAttribute('data-annotation-id');
      const ann = annotations.find((annotation) => annotation.id === annId);
      if (!ann) return;
      e.preventDefault();
      e.stopPropagation();
      setActivePopover({ annotation: ann, rect: mark.getBoundingClientRect() });
      setEditingComment(null);
      setSelectionRect(null);
    }

    prose.addEventListener('click', handleHighlightClick, true);

    return () => {
      prose.removeEventListener('click', handleHighlightClick, true);
      for (const el of allMarkEls) {
        const parent = el.parentNode;
        if (!parent) continue;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        parent.normalize();
      }
    };
  }, [annotations, proseRef, wrapperRef]);

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

  const handleUpdate = useCallback(async (id: string, comment: string) => {
    const ann = await updateAnnotation(id, comment);
    if (ann) {
      onAnnotationsChange(annotations.map((annotation) => (annotation.id === id ? ann : annotation)));
      setActivePopover(null);
      setEditingComment(null);
    }
  }, [annotations, onAnnotationsChange]);

  const handleDelete = useCallback(async (id: string) => {
    if (await deleteAnnotation(id)) {
      onAnnotationsChange(annotations.filter((annotation) => annotation.id !== id));
      setActivePopover(null);
    }
  }, [annotations, onAnnotationsChange]);

  const handleDotClick = useCallback((ann: Annotation, mark: AnnotationMark) => {
    const el = mark.markEls[0];
    if (!el) return;
    setActivePopover({ annotation: ann, rect: el.getBoundingClientRect() });
    setEditingComment(null);
    setSelectionRect(null);
  }, []);

  useEffect(() => {
    if (showCommentBox && commentInputRef.current) commentInputRef.current.focus();
  }, [showCommentBox]);

  const positionedMarks = (() => {
    const MIN_GAP = 16;
    let lastTop = -999;
    return marks.map((mark) => {
      const displayTop = Math.max(mark.top, lastTop + MIN_GAP);
      lastTop = displayTop;
      return { ...mark, displayTop };
    });
  })();

  return (
    <>
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
                void handleSubmit();
              }
              if (e.key === 'Escape') {
                setShowCommentBox(false);
                setSelectionRect(null);
              }
            }}
            rows={2}
          />
          <div className="ann-toolbar__actions">
            <button className="ann-toolbar__submit" disabled={!commentText.trim()} onClick={() => void handleSubmit()}>
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

      {positionedMarks.map((mark) => {
        // Hovering a margin note flashes the highlighted passage so
        // the reader sees the link between the note and what it
        // annotates — addresses the "where in the text is this?"
        // question without forcing them to scan.
        const setActive = (active: boolean) => {
          for (const el of mark.markEls) {
            el.classList.toggle('ann-highlight--active', active);
          }
        };
        return (
          <div
            key={mark.annotation.id}
            className="ann-margin-note"
            style={{ top: mark.displayTop }}
            onClick={() => handleDotClick(mark.annotation, mark)}
            onMouseEnter={() => setActive(true)}
            onMouseLeave={() => setActive(false)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleDotClick(mark.annotation, mark)}
            title={mark.annotation.comment}
          >
            <span className="ann-margin-note__body">{mark.annotation.comment}</span>
          </div>
        );
      })}

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
              ? `${activePopover.annotation.selectedText.slice(0, 60)}…`
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
                    void handleUpdate(activePopover.annotation.id, editingComment);
                  }
                  if (e.key === 'Escape') setEditingComment(null);
                }}
                rows={2}
                autoFocus
              />
              <div className="ann-toolbar__actions">
                <button className="ann-toolbar__submit" onClick={() => void handleUpdate(activePopover.annotation.id, editingComment)}>
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
              <button className="ann-popover__btn" onClick={() => setEditingComment(activePopover.annotation.comment)}>
                Edit
              </button>
            )}
            <button
              className="ann-popover__btn ann-popover__btn--delete"
              onClick={() => void handleDelete(activePopover.annotation.id)}
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
