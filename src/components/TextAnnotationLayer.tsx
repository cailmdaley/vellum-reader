import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Annotation } from '~/utils/content-types';
import { useAdapter } from '~/contexts/AdapterContext';
import { useAnnotationActions } from '~/contexts/AnnotationActionsContext';
import { useAnnotationComposer } from '~/hooks/useAnnotationComposer';
import { AnnotationPopover } from './AnnotationPopover';

interface TextAnnotationLayerProps {
  slug: string;
  annotations: Annotation[];
  proseRef: React.RefObject<HTMLElement>;
  wrapperRef: React.RefObject<HTMLElement>;
  onAnnotationsChange: (annotations: Annotation[]) => void;
  onVisibleAnnotationsChange?: (annotations: Annotation[]) => void;
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

function annotationDisplayLabel(annotation: Annotation): string {
  return annotation.intent === 'delete' && annotation.comment.trim().toLowerCase() === 'delete'
    ? 'delete'
    : annotation.comment;
}

function annotationHighlightClass(annotation: Annotation): string {
  return annotation.intent === 'delete'
    ? 'ann-highlight ann-highlight--delete'
    : 'ann-highlight';
}

/**
 * Lay out the margin-note waterfall. Each note anchors at its mark's
 * `top` (the y of the highlighted passage in wrapper coordinates) and
 * waterfalls downward to clear the card above it, using each card's
 * *actual rendered height* (resolved via `heightFor`) plus a fixed
 * `gap`. The first-fit collision logic the layer used previously gave
 * every card the same 16px buffer regardless of height, so a tall
 * multi-line note would have the next card overlap it by all but 16px
 * of its body.
 *
 * Returns a Map<annotationId, displayTop>. Exported for unit testing;
 * the layer calls this from a `useLayoutEffect` after measuring each
 * mounted card via `offsetHeight`.
 */
export function computeMarginNoteLayout(
  marks: ReadonlyArray<{ annotation: { id: string }; top: number }>,
  heightFor: (id: string) => number,
  gap: number,
): Map<string, number> {
  const next = new Map<string, number>();
  let prevBottom = -Infinity;
  for (const mark of marks) {
    const top = Math.max(mark.top, prevBottom + gap);
    next.set(mark.annotation.id, top);
    prevBottom = top + heightFor(mark.annotation.id);
  }
  return next;
}

/**
 * Build the {selectedText, contextBefore, contextAfter} triple that anchors a
 * fresh annotation. `proseEl` is the prose root the layer is mounted over —
 * pass `proseRef.current`. The container bounds the context-slice so the
 * text-before / text-after stays inside the article rather than spilling into
 * page chrome (toolbar, sidebar, modal scrim). Falls back to `document.body`
 * if the caller can't supply a container, mirroring the previous
 * `closest('.vellum-prose')` behaviour for callers that haven't been updated.
 */
function getContext(
  sel: Selection,
  proseEl: HTMLElement | null,
  charsBefore = 30,
  charsAfter = 30,
) {
  const range = sel.getRangeAt(0);
  const selectedText = normalizeWhitespace(range.toString());
  const preRange = document.createRange();
  const container =
    proseEl ??
    range.startContainer.parentElement?.closest<HTMLElement>('.vellum-prose') ??
    document.body;
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

export function focusAnnotationDraftInput(input: Pick<HTMLElement, 'focus'>) {
  input.focus({ preventScroll: true });
}

export function annotationRailLeft(args: {
  wrapperLeft: number;
  wrapperWidth: number;
  viewportWidth: number;
  canvasWidth: number;
}) {
  return annotationRailGeometry(args).left;
}

export function annotationRailGeometry(args: {
  wrapperLeft: number;
  wrapperWidth: number;
  viewportWidth: number;
  canvasWidth: number;
}) {
  const { wrapperLeft, wrapperWidth, viewportWidth, canvasWidth } = args;
  const gap = 12;
  const desiredWidth = 336;
  if (canvasWidth > 0) {
    return {
      left: Math.max(0, viewportWidth - canvasWidth - wrapperLeft + gap),
      width: Math.max(120, canvasWidth - 24),
    };
  }
  const available = viewportWidth - wrapperLeft - wrapperWidth - gap - 12;
  const width = Math.max(120, Math.min(desiredWidth, available));
  return {
    left: available >= 120
      ? wrapperWidth + gap
      : Math.max(0, viewportWidth - wrapperLeft - width - 12),
    width,
  };
}

export function TextAnnotationLayer({
  slug,
  annotations,
  proseRef,
  wrapperRef,
  onAnnotationsChange,
  onVisibleAnnotationsChange,
}: TextAnnotationLayerProps) {
  const adapter = useAdapter();
  const navigate = useNavigate();
  // Per-selection actions ("+ Fiber" — promote the live selection into a
  // new draft fiber). Bulk actions surface elsewhere via
  // `NarrativeAnnotationActionsBar`; the toolbar here only sees the
  // single-selection variant. Empty in published vellum-demos and any
  // other host that didn't register actions, so the toolbar collapses
  // back to "+ Note" only — no harm done.
  const { singleActions } = useAnnotationActions();
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [selectionContext, setSelectionContext] = useState<{
    selectedText: string;
    contextBefore: string;
    contextAfter: string;
  } | null>(null);
  const [marks, setMarks] = useState<AnnotationMark[]>([]);
  const [railGeometry, setRailGeometry] = useState({ left: 0, width: 336 });
  const [activePopover, setActivePopover] = useState<{
    annotation: Annotation;
    rect: DOMRect;
  } | null>(null);

  // Substrate-agnostic composer state — text, open/dismiss, keyboard
  // handling. The hook fires our `onSubmit` (which extracts the
  // selection-context triple and calls the adapter); on truthy result
  // it resets text + open. We layer prose-specific concerns on top:
  // `draftTop` for in-margin positioning, `draftInputRef` for the
  // contentEditable element (so we can place the caret at end after
  // focus), and clearing the browser's native selection on success.
  const composer = useAnnotationComposer({
    onSubmit: async (text) => {
      if (!selectionContext) return null;
      const ann = await adapter.createAnnotation({
        slug,
        intent: 'note',
        selectedText: selectionContext.selectedText,
        contextBefore: selectionContext.contextBefore,
        contextAfter: selectionContext.contextAfter,
        comment: text,
      });
      if (!ann) return null;
      onAnnotationsChange([...annotations, ann]);
      setSelectionRect(null);
      setSelectionContext(null);
      setDraftTop(null);
      window.getSelection()?.removeAllRanges();
      return ann;
    },
  });

  const saveDeletionMark = useCallback(async () => {
    if (!selectionContext) return;
    const ann = await adapter.createAnnotation({
      slug,
      intent: 'delete',
      selectedText: selectionContext.selectedText,
      contextBefore: selectionContext.contextBefore,
      contextAfter: selectionContext.contextAfter,
      comment: 'delete',
    });
    if (!ann) return;
    onAnnotationsChange([...annotations, ann]);
    setSelectionRect(null);
    setSelectionContext(null);
    setDraftTop(null);
    window.getSelection()?.removeAllRanges();
  }, [adapter, annotations, onAnnotationsChange, selectionContext, slug]);

  // ContentEditable div for the in-margin draft. Using a div (not textarea)
  // so it inherits .ann-margin-note__body styling verbatim — italic
  // Garamond, the gold gutter rule, line-clamping — and the user's
  // typed text looks identical to the persisted note while they're
  // composing it. Save/Cancel sit below. Owned locally (not via
  // composer.inputRef) so we can place the caret at end after focus —
  // a contentEditable-specific gesture the substrate-agnostic hook
  // shouldn't carry.
  const draftInputRef = useRef<HTMLDivElement>(null);
  // Top coordinate (wrapper-relative) where the draft margin note should
  // anchor. Computed once when "+ Note" is clicked from the captured
  // selection rect; avoids re-reading selection on every render (the
  // browser's native selection clears as soon as the user clicks our
  // button or focuses the contentEditable).
  const [draftTop, setDraftTop] = useState<number | null>(null);
  // Bumped whenever the prose reflows (divider drag, viewport resize, theme
  // swap, lazy-image load) so the mark-creation effect re-runs and re-anchors
  // every highlight. Without this, dragging CanvasDivider rebuilds the
  // pretext layout's per-line DOM via React reconciliation and silently
  // destroys the imperatively-inserted `<mark>` elements that
  // `range.surroundContents()` placed earlier — highlights and their margin
  // notes vanish until the next re-render is triggered some other way.
  const [reanchorTick, setReanchorTick] = useState(0);

  const measureRailLeft = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof window === 'undefined') return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const rawCanvasWidth = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--canvas-width'),
    );
    const canvasWidth = Number.isFinite(rawCanvasWidth) && rawCanvasWidth > 0 ? rawCanvasWidth : 0;
    const next = annotationRailGeometry({
      wrapperLeft: wrapperRect.left,
      wrapperWidth: wrapperRect.width,
      viewportWidth: window.innerWidth,
      canvasWidth,
    });
    setRailGeometry((prev) => (
      Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.width - next.width) < 0.5
        ? prev
        : next
    ));
  }, [wrapperRef]);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    measureRailLeft();
    if (!wrapper) return;
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measureRailLeft())
      : null;
    observer?.observe(wrapper);
    window.addEventListener('resize', measureRailLeft);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureRailLeft);
    };
  }, [measureRailLeft, wrapperRef]);

  useEffect(() => {
    const prose = proseRef.current;
    if (!prose || typeof ResizeObserver === 'undefined') return;
    // Observe the prose element directly. Catches every reflow source we
    // care about (divider drag → --canvas-width change → prose width
    // change; window resize; theme swap; deferred image/figure load) with
    // one mechanism. The dedup happens via `setMarks(...)`'s identity
    // comparison in the consuming effect — duplicate ticks are cheap.
    let lastWidth = prose.getBoundingClientRect().width;
    let lastHeight = prose.getBoundingClientRect().height;
    const observer = new ResizeObserver(() => {
      const rect = prose.getBoundingClientRect();
      if (rect.width === lastWidth && rect.height === lastHeight) return;
      lastWidth = rect.width;
      lastHeight = rect.height;
      // RAF defers the re-anchor until the layout pass that triggered the
      // resize has settled — pretext rebuilds its per-line DOM inside the
      // same frame as the width change, so we want our mark wrappers to
      // land after that DOM exists, not against a half-torn-down tree.
      requestAnimationFrame(() => setReanchorTick((n) => n + 1));
    });
    observer.observe(prose);
    return () => observer.disconnect();
  }, [proseRef]);

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
        // A new selection supersedes any in-flight composer; the user
        // is signalling "I want to comment on this passage instead".
        composer.dismiss();
        setSelectionContext(getContext(sel, proseEl));
      });
    }

    prose.addEventListener('mouseup', handleMouseUp);
    return () => prose.removeEventListener('mouseup', handleMouseUp);
    // `composer.dismiss` is referentially stable (useCallback with empty
    // deps in the hook), so the captured closure is safe across renders.
  }, [proseRef, composer.dismiss]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('.ann-toolbar') || target.closest('.ann-popover')) return;
      if (target.closest('.ann-highlight')) return;
      if (target.closest('.ann-margin-note')) return;
      setSelectionRect(null);
      setActivePopover(null);
      setDraftTop(null);
      composer.dismiss();
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [composer.dismiss]);

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

      // Screen-reader name for the mark element. Without this, AT users
      // hear the *visual* substring covered by the mark, which is often a
      // mid-word fragment (the highlight aligns with the original
      // selection, not word boundaries). Naming the mark with its comment
      // gives AT a meaningful label to announce instead of a fragment like
      // "arkdown files. One fiber is one directory and one".
      const annLabel = ann.comment?.trim()
        ? `${ann.intent === 'delete' ? 'Deletion' : 'Annotation'}: ${ann.comment.trim()}`
        : ann.intent === 'delete' ? 'Deletion' : 'Annotation';

      try {
        const rects = Array.from(range.getClientRects());
        if (rects.length === 0) continue;

        const mark = document.createElement('mark');
        mark.className = annotationHighlightClass(ann);
        mark.dataset.annotationId = ann.id;
        mark.setAttribute('aria-label', annLabel);

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
            nextMark.className = annotationHighlightClass(ann);
            nextMark.dataset.annotationId = ann.id;
            nextMark.setAttribute('aria-label', annLabel);
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
    onVisibleAnnotationsChange?.(newMarks.map((mark) => mark.annotation));

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
      setSelectionRect(null);
    }

    prose.addEventListener('click', handleHighlightClick, true);

    return () => {
      prose.removeEventListener('click', handleHighlightClick, true);
      onVisibleAnnotationsChange?.([]);
      for (const el of allMarkEls) {
        const parent = el.parentNode;
        if (!parent) continue;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        parent.normalize();
      }
    };
    // `reanchorTick` re-runs this effect after a prose reflow (CanvasDivider
    // drag, viewport resize, etc.), which is when pretext's per-line DOM
    // gets rebuilt and our imperative `<mark>` wrappers vanish along with
    // it. The cleanup above unwraps any stale marks before the new pass
    // wraps fresh ones — see the ResizeObserver effect above for the
    // tick source.
  }, [annotations, proseRef, wrapperRef, reanchorTick, onVisibleAnnotationsChange]);

  const handleUpdate = useCallback(async (id: string, comment: string) => {
    const ann = await adapter.updateAnnotation(id, comment);
    if (ann) {
      onAnnotationsChange(annotations.map((annotation) => (annotation.id === id ? ann : annotation)));
    }
  }, [adapter, annotations, onAnnotationsChange]);

  const handleDelete = useCallback(async (id: string) => {
    if (await adapter.deleteAnnotation(id)) {
      onAnnotationsChange(annotations.filter((annotation) => annotation.id !== id));
      setActivePopover(null);
    }
  }, [adapter, annotations, onAnnotationsChange]);

  const handleDotClick = useCallback((ann: Annotation, mark: AnnotationMark) => {
    const el = mark.markEls[0];
    if (!el) return;
    setActivePopover({ annotation: ann, rect: el.getBoundingClientRect() });
    setSelectionRect(null);
  }, []);

  useEffect(() => {
    if (composer.open && draftInputRef.current) {
      focusAnnotationDraftInput(draftInputRef.current);
      // Place caret at the end so subsequent typing appends rather than
      // pre-pending (matters when the placeholder is replaced by typing).
      const range = document.createRange();
      range.selectNodeContents(draftInputRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [composer.open]);

  const handleSingleAction = useCallback(
    async (actionId: string) => {
      if (!selectionContext) return;
      const action = singleActions.find((a) => a.id === actionId);
      if (!action) return;
      // Snapshot the selection up front: invoking the action may close
      // the toolbar (reset via `setSelectionRect(null)` below) and the
      // browser's native selection clears as soon as the user clicks our
      // button. Pass the captured triple to the handler so even an
      // async-after-await read sees the same text the user picked.
      const sel = { ...selectionContext };
      setSelectionRect(null);
      composer.dismiss();
      setSelectionContext(null);
      window.getSelection()?.removeAllRanges();
      try {
        await action.onInvoke(sel, { currentSlug: slug, navigate });
      } catch (err) {
        // Handler-internal errors (network, alert) are the action's
        // responsibility; this catch keeps a thrown handler from
        // blowing up the layer.
        console.error(`[annotation-action ${actionId}] threw`, err);
      }
    },
    [singleActions, selectionContext, slug, navigate],
  );

  // Margin-note waterfall. Each note anchors at its mark's `top` and
  // is then pushed downward to clear the card above it — measuring the
  // *actual rendered height* of the previous note, not just its anchor
  // Y. The old single-pass formula (`max(top, prevTop + 16)`) gave
  // every card the same 16px buffer regardless of height, so a tall
  // multi-line note would have the next card overlapping it by all but
  // 16px of its body.
  //
  // Two-pass layout:
  //  1. Render at the anchor Y (first paint). Cards may overlap here
  //     for a single frame; the alternative is to render off-screen
  //     and FLIP into place, which costs more than it saves.
  //  2. After commit, measure each card's `offsetHeight` and waterfall
  //     down: `displayTop = max(anchorTop, prevBottom + GAP)`. Commit
  //     the new positions via state so React re-renders with corrected
  //     `top`s. The position cache (`noteLayout`) is keyed by
  //     annotation id, so identity-stable across re-renders avoids
  //     full layout thrash when one note resizes.
  //
  // We re-run on `marks` (anchor set changes) and `reanchorTick` (a
  // prose reflow refreshed anchor Ys). Notes themselves don't change
  // height after mount under the current CSS (line-clamp caps body at
  // 4 lines), so no per-note ResizeObserver is needed; if line-clamp
  // is ever loosened, add one here.
  const NOTE_GAP = 12;
  const noteRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setNoteRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) noteRefs.current.set(id, el);
    else noteRefs.current.delete(id);
  }, []);
  const [noteLayout, setNoteLayout] = useState<Map<string, number>>(new Map());
  const positionedMarks = marks.map((mark) => ({
    ...mark,
    displayTop: noteLayout.get(mark.annotation.id) ?? mark.top,
  }));
  useLayoutEffect(() => {
    if (marks.length === 0) {
      if (noteLayout.size > 0) setNoteLayout(new Map());
      return;
    }
    const next = computeMarginNoteLayout(
      marks,
      (id) => noteRefs.current.get(id)?.offsetHeight ?? 0,
      NOTE_GAP,
    );
    // Skip the setState if nothing meaningful changed — re-rendering
    // on every layout pass would loop, since the effect runs after
    // every render the state update itself causes.
    if (next.size !== noteLayout.size) {
      setNoteLayout(next);
      return;
    }
    for (const [id, top] of next) {
      const prev = noteLayout.get(id);
      if (prev === undefined || Math.abs(prev - top) > 0.5) {
        setNoteLayout(next);
        return;
      }
    }
  }, [marks, noteLayout]);

  return (
    <>
      {selectionRect && !composer.open && (
        <div
          className="ann-toolbar ann-toolbar--actions"
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
              // Capture the wrapper-relative top of the selection so the
              // draft margin note anchors at the same y as the highlighted
              // passage. Read once now — once the user focuses the
              // contentEditable below, the browser's native selection
              // clears and selectionRect would no longer match the
              // highlighted text's position. Falls back to 0 if the
              // wrapper isn't available (defensive; shouldn't happen).
              const wrapper = wrapperRef.current;
              if (wrapper && selectionRect) {
                const wrapperRect = wrapper.getBoundingClientRect();
                setDraftTop(selectionRect.top - wrapperRect.top);
              } else {
                setDraftTop(0);
              }
              composer.start();
            }}
          >
            + Note
          </button>
          <button
            className="ann-toolbar__btn"
            title="Mark selection as a suggested deletion"
            onClick={(e) => {
              e.stopPropagation();
              void saveDeletionMark();
            }}
          >
            Strike
          </button>
          {/*
            Host-supplied single-selection actions render to the right of
            "+ Note" so the canonical commenting affordance keeps its
            position and any host extensions stack alongside it. The
            order in `singleActions` controls left-to-right order — a
            host that registers `+ Fiber` first sees it adjacent to the
            note button.
          */}
          {singleActions.map((action) => (
            <button
              key={action.id}
              className="ann-toolbar__btn"
              title={action.title ?? action.label}
              onClick={(e) => {
                e.stopPropagation();
                void handleSingleAction(action.id);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {composer.open && draftTop !== null && (
        // In-margin draft: the contentEditable IS a margin note, styled
        // identically (italic Garamond, gold gutter rule). Saving makes
        // the persisted note swap in below this draft with no visual
        // jump — what you typed is already what you'll see. Save/Cancel
        // tuck under the body so they don't compete with the prose.
        // Anchors at the wrapper-relative draft top captured at "+ Note"
        // click time; same coordinate space as the persisted marks.
        // The composer hook owns text + open + keyboard; we own the
        // contentEditable + caret-end positioning + draftTop.
        <div
          className="ann-margin-note ann-margin-note--draft"
          style={{ top: draftTop, left: railGeometry.left, width: railGeometry.width }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ann-margin-note__compose">
            <div
              ref={draftInputRef}
              className="ann-margin-note__body ann-margin-note__body--editable"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Add a note"
              data-placeholder="Add a note…"
              onInput={(e) => composer.setText(e.currentTarget.textContent ?? '')}
              onKeyDown={(e) => {
                // The composer's keyDown handles Enter (submit) and
                // Escape (dismiss); we only need to clear the prose-
                // specific extras (selectionRect + draftTop) on
                // dismiss. Wrap to do both.
                if (e.key === 'Escape') {
                  setSelectionRect(null);
                  setDraftTop(null);
                }
                composer.keyDown(e);
              }}
              // Stop bubbling so the document-level mousedown handler
              // (which closes the toolbar on outside clicks) doesn't
              // dismiss our draft when the user clicks into it.
              onMouseDown={(e) => e.stopPropagation()}
            />
            <div className="ann-margin-note__actions">
              <button
                type="button"
                className="ann-margin-note__btn ann-margin-note__btn--save"
                disabled={!composer.text.trim()}
                onClick={() => void composer.submit()}
              >
                save
              </button>
              <button
                type="button"
                className="ann-margin-note__btn ann-margin-note__btn--cancel"
                onClick={() => {
                  setSelectionRect(null);
                  setDraftTop(null);
                  composer.dismiss();
                }}
              >
                cancel
              </button>
            </div>
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
            ref={setNoteRef(mark.annotation.id)}
            className={`ann-margin-note${mark.annotation.intent === 'delete' ? ' ann-margin-note--delete' : ''}`}
            style={{ top: mark.displayTop, left: railGeometry.left, width: railGeometry.width }}
            onClick={() => handleDotClick(mark.annotation, mark)}
            onMouseEnter={() => setActive(true)}
            onMouseLeave={() => setActive(false)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleDotClick(mark.annotation, mark)}
            title={annotationDisplayLabel(mark.annotation)}
          >
            <span className="ann-margin-note__body">{annotationDisplayLabel(mark.annotation)}</span>
          </div>
        );
      })}

      {activePopover && (
        <AnnotationPopover
          annotation={activePopover.annotation}
          top={activePopover.rect.bottom + 8}
          left={activePopover.rect.left}
          positionStrategy="fixed"
          onEdit={(next) => handleUpdate(activePopover.annotation.id, next)}
          onDelete={() => handleDelete(activePopover.annotation.id)}
          onClose={() => setActivePopover(null)}
        />
      )}
    </>
  );
}
