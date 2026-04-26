/**
 * FileReader — renders a `FileContent` payload as prose or code.
 *
 * Vellum's read surface for arbitrary project files. The host supplies content
 * via `adapter.getFile(path)` and hands the resulting `FileContent` here.
 * Kinds are dispatched to distinct renderers:
 *
 *   - `text`/`markdown` — CodeMirror editor. Readonly by default; pass
 *     `editable` to enable writes. When editable, `onDocChange` fires on every
 *     doc change and `onSave` fires on `Mod-s` / `:w`. Markdown with a parsed
 *     `mdast` tree renders via myst-to-react in readonly mode; editable mode
 *     always uses the CodeMirror source view.
 *   - `image` — <img src={url}>.
 *   - `html` — <iframe src={url}> in a sandboxed frame.
 *   - `pdf` — all pages rendered to canvas via pdfjs-dist, lazy-loaded on
 *     first use so lightcone (fiber-only) does not pay for it.
 *
 * PDF worker note: vellum resolves the worker URL via
 * `pdfjs-dist/build/pdf.worker.min.mjs?url`, which relies on a Vite-style
 * `?url` asset import. Non-Vite hosts will need to supply their own
 * `GlobalWorkerOptions.workerSrc` before mounting.
 *
 * This is the read + edit surface of the portolan FileViewerModal absorption.
 * Annotations and split markdown preview are deliberately NOT here yet — they
 * follow once the edit path is proven.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html as htmlLang } from '@codemirror/lang-html';
import { vim, Vim } from '@replit/codemirror-vim';
import { ArticleProvider, ThemeProvider, mergeRenderers } from '@myst-theme/providers';
import { DEFAULT_RENDERERS } from 'myst-to-react';
import { useAdapter } from '../contexts/AdapterContext';
import type { Annotation, AnnotationAction, FileContent } from '../utils/content-types';
import { assignMdastKeys } from '../utils/mdast-keys';
import { PretextProse } from './PretextProse';
import { ThemePicker } from './ThemePicker';
import { FiberHeader } from './FiberHeader';
// Static ?url import: Vite resolves this to a string URL at transform time,
// which survives symlinked-package serving via /@fs/. A dynamic import()?url
// goes through a different path where the ?url query gets dropped for
// symlinked deps and Vite returns the worker *module* instead of its URL —
// which leaves GlobalWorkerOptions.workerSrc = undefined and pdfjs throws
// "Invalid workerSrc type" on the first getDocument call.
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface FileReaderProps {
  file: FileContent;
  /** When true, the text/markdown renderer is a mutable editor (vim + history). */
  editable?: boolean;
  /** Fires on every doc change while `editable`. */
  onDocChange?: (content: string) => void;
  /** Fires on Mod-s and vim `:w` while `editable`. */
  onSave?: () => void;
  /** 1-indexed line to select and scroll into view on mount (text/markdown only). */
  jumpToLine?: number;
  /** File-anchored annotations to highlight in the text view. */
  annotations?: Annotation[];
  /**
   * Annotation anchor key (portolan: file path). When provided alongside
   * `onAnnotationsChange`, the text reader enables selection → comment UI
   * and a click-to-edit popover backed by `adapter.createAnnotation` /
   * `updateAnnotation` / `deleteAnnotation`.
   */
  annotationSlug?: string;
  /** Origin forwarded verbatim onto created annotations (portolan: 'local' or remote). */
  annotationOriginId?: string;
  /** Fires after create/update/delete mutations with the new annotation array. */
  onAnnotationsChange?: (next: Annotation[]) => void;
  /**
   * Host-defined actions on an existing annotation. Rendered as buttons in
   * the click-popover alongside Edit/Delete. Each action receives the
   * annotation object when the user invokes it. Used by portolan to route
   * annotations to a worker session or materialize them as felt fibers.
   */
  annotationActions?: AnnotationAction[];
}

function languageExtension(lang: string): Extension | null {
  switch (lang) {
    case 'javascript':
    case 'typescript':
    case 'jsx':
    case 'tsx':
      return javascript({ jsx: lang === 'jsx' || lang === 'tsx', typescript: lang.startsWith('t') });
    case 'python':
      return python();
    case 'markdown':
      return markdown();
    case 'json':
      return json();
    case 'css':
      return css();
    case 'html':
      return htmlLang();
    default:
      return null;
  }
}

const saveEffect = StateEffect.define<null>();

/**
 * Annotation decorations.
 *
 * Portolan annotations carry CodeMirror char offsets (`from`, `to`) and
 * 1-indexed line numbers (`line`, `endLine`). We render each as a range
 * highlight (Decoration.mark) with a `title` tooltip showing the comment.
 * Gutter markers and a dedicated side panel are deliberate follow-ups.
 */
const setAnnotationsEffect = StateEffect.define<Annotation[]>();

const annotationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const eff of tr.effects) {
      if (eff.is(setAnnotationsEffect)) {
        next = buildAnnotationDecorations(tr.state.doc.length, eff.value);
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function buildAnnotationDecorations(docLength: number, annotations: Annotation[]): DecorationSet {
  const sorted = [...annotations]
    .filter((a) => typeof a.from === 'number' && typeof a.to === 'number')
    .sort((a, b) => (a.from ?? 0) - (b.from ?? 0) || (a.to ?? 0) - (b.to ?? 0));
  const builder = new RangeSetBuilder<Decoration>();
  for (const a of sorted) {
    const from = Math.max(0, Math.min(docLength, a.from ?? 0));
    const to = Math.max(from, Math.min(docLength, a.to ?? from));
    if (from === to) continue;
    // Sent annotations get a modifier class so hosts can mute them — the
    // annotation is still there, but the visual "pending work" weight is
    // reduced. Title still shows the comment so hover inspection works.
    const cls = a.sentAt
      ? 'vellum-annotation-mark vellum-annotation-mark--sent'
      : 'vellum-annotation-mark';
    builder.add(
      from,
      to,
      Decoration.mark({
        class: cls,
        attributes: { title: a.comment, 'data-annotation-id': a.id },
      }),
    );
  }
  return builder.finish();
}

let vimSaveRegistered = false;
function registerVimSave() {
  if (vimSaveRegistered) return;
  vimSaveRegistered = true;
  Vim.defineEx('write', 'w', (cm: unknown) => {
    const view = (cm as { cm6?: EditorView }).cm6;
    if (!view) return;
    view.dispatch({ effects: saveEffect.of(null) });
  });
}

interface SelectionInfo {
  from: number;
  to: number;
  text: string;
  top: number;
  left: number;
}

interface PopoverInfo {
  annotation: Annotation;
  top: number;
  left: number;
}

function TextReader({
  file,
  editable,
  onDocChange,
  onSave,
  jumpToLine,
  annotations,
  annotationSlug,
  annotationOriginId,
  onAnnotationsChange,
  annotationActions,
}: FileReaderProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onDocChangeRef = useRef(onDocChange);
  const onSaveRef = useRef(onSave);
  onDocChangeRef.current = onDocChange;
  onSaveRef.current = onSave;

  const adapter = useAdapter();
  const canAnnotate = !!(annotationSlug && onAnnotationsChange);
  const annotationsRef = useRef<Annotation[]>(annotations ?? []);
  annotationsRef.current = annotations ?? [];
  const onAnnotationsChangeRef = useRef(onAnnotationsChange);
  onAnnotationsChangeRef.current = onAnnotationsChange;

  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [popover, setPopover] = useState<PopoverInfo | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  const dismissAll = useCallback(() => {
    setSelection(null);
    setShowCommentBox(false);
    setCommentDraft('');
    setPopover(null);
    setEditingComment(null);
  }, []);

  const coordsRelativeToWrapper = useCallback(
    (view: EditorView, pos: number): { top: number; left: number } | null => {
      const c = view.coordsAtPos(pos);
      const wrap = wrapperRef.current;
      if (!c || !wrap) return null;
      const rect = wrap.getBoundingClientRect();
      return { top: c.top - rect.top, left: c.left - rect.left };
    },
    [],
  );

  useEffect(() => {
    if (!hostRef.current) return;
    if (editable) registerVimSave();

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      annotationField,
      EditorView.theme({
        '&': { height: '100%', fontSize: '14px' },
        '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)' },
        '.cm-scroller': { overflow: 'auto' },
        '.vellum-annotation-mark': {
          backgroundColor: 'rgba(154, 123, 53, 0.18)',
          borderBottom: '1px dashed rgba(154, 123, 53, 0.6)',
          cursor: 'help',
        },
        // Sent annotations de-emphasized: same hue, much softer. The
        // comment is still hoverable via title; just stops pulling the eye.
        '.vellum-annotation-mark--sent': {
          backgroundColor: 'rgba(154, 123, 53, 0.06)',
          borderBottom: '1px dotted rgba(154, 123, 53, 0.3)',
        },
      }),
    ];

    if (editable) {
      extensions.push(
        vim(),
        history(),
        EditorView.lineWrapping,
        EditorState.allowMultipleSelections.of(true),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          {
            key: 'Mod-s',
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onDocChangeRef.current?.(update.state.doc.toString());
          }
          for (const tr of update.transactions) {
            for (const eff of tr.effects) {
              if (eff.is(saveEffect)) onSaveRef.current?.();
            }
          }
        }),
      );
    } else {
      extensions.push(EditorView.editable.of(false), EditorState.readOnly.of(true));
    }

    if (canAnnotate) {
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (!update.selectionSet && !update.docChanged) return;
          const sel = update.state.selection.main;
          if (sel.empty) {
            setSelection(null);
            setShowCommentBox(false);
            return;
          }
          const text = update.state.doc.sliceString(sel.from, sel.to);
          if (text.trim().length < 2) {
            setSelection(null);
            setShowCommentBox(false);
            return;
          }
          const coords = coordsRelativeToWrapper(update.view, sel.from);
          if (!coords) return;
          setSelection({ from: sel.from, to: sel.to, text, top: coords.top, left: coords.left });
          setPopover(null);
        }),
      );
    }

    const langExt = languageExtension(file.language);
    if (langExt) extensions.push(langExt);

    const state = EditorState.create({ doc: file.content, extensions });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    // Seed annotation decorations once the view is mounted (and the doc has a
    // final length to clamp to).
    if (annotations && annotations.length) {
      view.dispatch({ effects: setAnnotationsEffect.of(annotations) });
    }
    if (jumpToLine && jumpToLine > 0) {
      const lineCount = view.state.doc.lines;
      const targetLine = Math.min(Math.max(1, jumpToLine), lineCount);
      const line = view.state.doc.line(targetLine);
      view.dispatch({
        selection: { anchor: line.from, head: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      });
      if (editable) view.focus();
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [file.path, file.content, file.language, editable, jumpToLine, canAnnotate, coordsRelativeToWrapper]);

  // Keep decorations in sync with incoming annotations without rebuilding the
  // whole editor (which would throw away cursor state on every fetch).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setAnnotationsEffect.of(annotations ?? []) });
  }, [annotations]);

  // Open the popover when the user clicks on an existing annotation mark.
  useEffect(() => {
    if (!canAnnotate) return;
    const host = hostRef.current;
    if (!host) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const mark = target?.closest('.vellum-annotation-mark') as HTMLElement | null;
      if (!mark) return;
      const id = mark.dataset.annotationId;
      const ann = annotationsRef.current.find((a) => a.id === id);
      if (!ann) return;
      e.preventDefault();
      e.stopPropagation();
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const rect = mark.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      setPopover({
        annotation: ann,
        top: rect.bottom - wrapRect.top + 4,
        left: rect.left - wrapRect.left,
      });
      setSelection(null);
      setEditingComment(null);
    };
    host.addEventListener('click', onClick, true);
    return () => host.removeEventListener('click', onClick, true);
  }, [canAnnotate]);

  // Dismiss popover / toolbar on background mousedown (outside annotation UI).
  useEffect(() => {
    if (!canAnnotate) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.ann-toolbar') || target.closest('.ann-popover')) return;
      if (target.closest('.vellum-annotation-mark')) return;
      // Click inside the editor that's not on a mark — let the selection
      // listener refresh the toolbar, but close any open popover.
      setPopover(null);
      setEditingComment(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [canAnnotate]);

  useEffect(() => {
    if (showCommentBox) commentInputRef.current?.focus();
  }, [showCommentBox]);

  const submitNew = useCallback(async () => {
    if (!selection || !annotationSlug) return;
    const comment = commentDraft.trim();
    if (!comment) return;
    const view = viewRef.current;
    const doc = view?.state.doc;
    const line = doc ? doc.lineAt(selection.from).number : 1;
    const endLine = doc ? doc.lineAt(selection.to).number : line;
    const content = doc?.toString() ?? '';
    const contextBefore = content.slice(Math.max(0, selection.from - 30), selection.from);
    const contextAfter = content.slice(selection.to, Math.min(content.length, selection.to + 30));
    try {
      const created = await adapter.createAnnotation({
        slug: annotationSlug,
        kind: 'text',
        filePath: annotationSlug,
        originId: annotationOriginId,
        selectedText: selection.text,
        originalText: selection.text,
        contextBefore,
        contextAfter,
        comment,
        from: selection.from,
        to: selection.to,
        line,
        endLine,
      });
      if (!created) return;
      onAnnotationsChangeRef.current?.([...annotationsRef.current, created]);
      dismissAll();
      view?.dispatch({ selection: EditorSelection.cursor(selection.to) });
    } catch (err) {
      console.error('createAnnotation failed', err);
    }
  }, [adapter, annotationSlug, annotationOriginId, commentDraft, dismissAll, selection]);

  const submitEdit = useCallback(async () => {
    if (!popover || editingComment == null) return;
    const next = editingComment.trim();
    if (!next) return;
    try {
      const updated = await adapter.updateAnnotation(popover.annotation.id, next);
      if (!updated) return;
      const list = annotationsRef.current.map((a) => (a.id === updated.id ? updated : a));
      onAnnotationsChangeRef.current?.(list);
      setPopover({ ...popover, annotation: updated });
      setEditingComment(null);
    } catch (err) {
      console.error('updateAnnotation failed', err);
    }
  }, [adapter, editingComment, popover]);

  const submitDelete = useCallback(async () => {
    if (!popover) return;
    try {
      const ok = await adapter.deleteAnnotation(popover.annotation.id);
      if (!ok) return;
      onAnnotationsChangeRef.current?.(annotationsRef.current.filter((a) => a.id !== popover.annotation.id));
      setPopover(null);
      setEditingComment(null);
    } catch (err) {
      console.error('deleteAnnotation failed', err);
    }
  }, [adapter, popover]);

  return (
    <div ref={wrapperRef} className="vellum-text-reader-wrapper">
      <div
        ref={hostRef}
        className={`vellum-file-reader vellum-file-reader--text${editable ? ' vellum-file-reader--editable' : ''}`}
      />
      {canAnnotate && selection && !showCommentBox && (
        <div
          className="ann-toolbar"
          style={{ position: 'absolute', top: Math.max(0, selection.top - 36), left: selection.left }}
        >
          <button
            type="button"
            className="ann-toolbar__btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowCommentBox(true);
              setCommentDraft('');
            }}
          >
            + Note
          </button>
        </div>
      )}
      {canAnnotate && selection && showCommentBox && (
        <div
          className="ann-toolbar ann-toolbar--comment"
          style={{ position: 'absolute', top: selection.top + 24, left: selection.left }}
        >
          <textarea
            ref={commentInputRef}
            className="ann-toolbar__input"
            placeholder="Add a note..."
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submitNew();
              } else if (e.key === 'Escape') {
                dismissAll();
              }
            }}
            rows={2}
          />
          <div className="ann-toolbar__actions">
            <button
              type="button"
              className="ann-toolbar__submit"
              disabled={!commentDraft.trim()}
              onClick={() => void submitNew()}
            >
              Save
            </button>
            <button type="button" className="ann-toolbar__cancel" onClick={dismissAll}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {canAnnotate && popover && (
        <div
          className="ann-popover"
          style={{ position: 'absolute', top: popover.top, left: popover.left }}
        >
          <div className="ann-popover__selected">
            "{popover.annotation.selectedText.length > 60
              ? `${popover.annotation.selectedText.slice(0, 60)}…`
              : popover.annotation.selectedText}"
          </div>
          {editingComment !== null ? (
            <div className="ann-popover__edit">
              <textarea
                className="ann-popover__input"
                value={editingComment}
                onChange={(e) => setEditingComment(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submitEdit();
                  } else if (e.key === 'Escape') {
                    setEditingComment(null);
                  }
                }}
                rows={2}
                autoFocus
              />
              <div className="ann-toolbar__actions">
                <button type="button" className="ann-toolbar__submit" onClick={() => void submitEdit()}>
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
            <div className="ann-popover__comment">{popover.annotation.comment}</div>
          )}
          <div className="ann-popover__actions">
            {editingComment === null && (
              <button
                type="button"
                className="ann-popover__btn"
                onClick={() => setEditingComment(popover.annotation.comment)}
              >
                Edit
              </button>
            )}
            {editingComment === null &&
              annotationActions?.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="ann-popover__btn ann-popover__btn--action"
                  title={action.title ?? action.label}
                  onClick={() => {
                    void action.onInvoke(popover.annotation);
                  }}
                >
                  {action.label}
                </button>
              ))}
            <button
              type="button"
              className="ann-popover__btn ann-popover__btn--delete"
              onClick={() => void submitDelete()}
            >
              Delete
            </button>
          </div>
          {popover.annotation.createdAt ? (
            <div className="ann-popover__time">
              {new Date(popover.annotation.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const MARKDOWN_RENDERERS = mergeRenderers([DEFAULT_RENDERERS], true);

/**
 * Permissive predicate: does this frontmatter look like it belongs above a
 * masthead lockup? Any markdown file with a `name` or `title` in its
 * frontmatter qualifies — same fields FiberHeader resolves first. Files
 * with config-shaped frontmatter (no name/title — e.g. build config YAML
 * embedded in a doc) skip the header and stand on the canvas alone.
 *
 * Liberal on purpose: the cost of a stray header on a non-fiber doc is
 * small (a single h1 lockup); the cost of suppressing one on a fiber-by-path
 * is the inconsistency the unification was meant to remove.
 */
function hasFiberShape(frontmatter: Record<string, unknown>): boolean {
  const name = frontmatter.name;
  const title = frontmatter.title;
  return (
    (typeof name === 'string' && name.trim().length > 0) ||
    (typeof title === 'string' && title.trim().length > 0)
  );
}

/**
 * Initial column width before the host's `.vellum-file-reader--markdown`
 * element has been measured. Matches the prose default in NarrativeView so
 * the first paint approximates the steady-state column width.
 */
const MARKDOWN_INITIAL_CONTENT_WIDTH = 720 - 63 * 2;

/**
 * Canvas-mode reader for markdown files. Renders through `PretextProse` —
 * the same renderer fiber narratives use — so a non-fiber markdown file
 * (README, prose note, anything ending in `.md`) lands in the same canvas
 * substrate as a fiber body. The PretextProse compat-island fallback still
 * needs MyST renderers in scope for tables/admonitions/figures, so the
 * Article + Theme providers wrap as before.
 *
 * `jumpToLine` is consumed via the source-line position map inside
 * PretextProse — caller passes a 1-indexed source line and the canvas scrolls
 * to the matching block once layout settles.
 */
function MarkdownReader({ file, jumpToLine }: FileReaderProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState<number>(MARKDOWN_INITIAL_CONTENT_WIDTH);

  // Measure the wrapper's inner width (content box minus any horizontal
  // padding). Pretext lays out from this width — keeping the observer cheap
  // matters because every wrapper-resize triggers a full re-layout.
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const updateWidth = () => {
      const cs = window.getComputedStyle(wrapper);
      const padX = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
      const next = Math.max(120, wrapper.clientWidth - padX);
      setContentWidth(next);
    };
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  const keyedMdast = file.mdast ? assignMdastKeys(file.mdast, `file:${file.path}`) : file.mdast;
  return (
    <ThemeProvider theme={null} setTheme={() => {}} renderers={MARKDOWN_RENDERERS}>
      <ArticleProvider
        kind={'Article' as any}
        frontmatter={{} as any}
        references={{ cite: {}, footnotes: {} } as any}
      >
        <div
          ref={wrapperRef}
          className="vellum-file-reader vellum-file-reader--markdown vellum-file-reader--markdown-canvas"
        >
          {/* ThemePicker mirrors the fiber-side narrative: lightcone-linear
              hides the FloatingIsland on the right, so any chrome that should
              be visible in every theme has to live inside the prose column.
              Without this the picker disappeared when files moved out of the
              FileViewerModal. */}
          <ThemePicker />
          {/* FiberHeader for fiber-shaped frontmatter (name or title present).
              Permissive detection: any markdown file with a name/title in its
              frontmatter renders the masthead lockup, so a fiber opened by
              path looks identical to one opened by slug. Frontmatter without
              that signature (build configs, tool YAML headers) skips the
              header — the canvas stands on its own. */}
          {file.frontmatter && hasFiberShape(file.frontmatter) && (
            <FiberHeader frontmatter={file.frontmatter as Record<string, any>} />
          )}
          <PretextProse
            mdast={keyedMdast}
            contentWidth={contentWidth}
            jumpToLine={jumpToLine}
          />
        </div>
      </ArticleProvider>
    </ThemeProvider>
  );
}

function ImageReader({ file }: FileReaderProps) {
  return (
    <div className="vellum-file-reader vellum-file-reader--image">
      <img src={file.url} alt={file.path} />
    </div>
  );
}

function HtmlReader({ file }: FileReaderProps) {
  return (
    <iframe
      className="vellum-file-reader vellum-file-reader--html"
      src={file.url}
      sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
      title={file.path}
    />
  );
}

type PdfJsModule = typeof import('pdfjs-dist');
let pdfJsPromise: Promise<PdfJsModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    pdfJsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
      }
      return pdfjs;
    })();
  }
  return pdfJsPromise;
}

export function PdfReader({ file }: FileReaderProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current || !file.url) return;
    const container = hostRef.current;
    container.innerHTML = '';
    let cancelled = false;
    let loadingTask: { destroy: () => void } | null = null;

    (async () => {
      const pdfjs = await loadPdfJs();
      if (cancelled) return;
      const task = pdfjs.getDocument(file.url!);
      loadingTask = task;
      const doc = await task.promise;
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const containerWidth = container.clientWidth || 800;
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) break;
        const page = await doc.getPage(i);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = (containerWidth * dpr) / unscaledViewport.width;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.display = 'block';
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      }
    })().catch((err) => {
      if (cancelled) return;
      const msg = err instanceof Error ? err.message : String(err);
      const errEl = document.createElement('div');
      errEl.className = 'vellum-file-reader--pdf-error';
      errEl.textContent = `Failed to render PDF: ${msg}`;
      container.appendChild(errEl);
    });

    return () => {
      cancelled = true;
      try {
        loadingTask?.destroy();
      } catch {}
      container.innerHTML = '';
    };
  }, [file.url]);

  if (!file.url) {
    return (
      <div className="vellum-file-reader vellum-file-reader--pdf">
        <p>No URL supplied for {file.path}.</p>
      </div>
    );
  }
  return <div ref={hostRef} className="vellum-file-reader vellum-file-reader--pdf" />;
}

export function FileReader(props: FileReaderProps) {
  const { file, editable } = props;
  switch (file.kind) {
    case 'image':
      return <ImageReader file={file} />;
    case 'html':
      return <HtmlReader file={file} />;
    case 'pdf':
      return <PdfReader file={file} />;
    case 'markdown':
      // Editable mode always uses the source-view text reader so the user can
      // actually type. Read-mode renders through the canvas (PretextProse via
      // MarkdownReader) so non-fiber markdown gets the same substrate as a
      // fiber body — see ai-futures/portolan/vellum-reader/markdown-and-fibers-share-canvas.
      // jumpToLine is forwarded so a deep link can land the canvas reader on
      // the source paragraph without flipping to the editor.
      if (!editable && file.mdast) {
        return <MarkdownReader file={file} jumpToLine={props.jumpToLine} />;
      }
      return <TextReader {...props} />;
    case 'text':
    default:
      return <TextReader {...props} />;
  }
}
