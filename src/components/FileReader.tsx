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

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
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
import { TextAnnotationLayer } from './TextAnnotationLayer';
import { AnnotationPopover } from './AnnotationPopover';
import { useAnnotationComposer } from '../hooks/useAnnotationComposer';
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
  /** Navigate to another project file without leaving file mode. */
  onNavigateToFile?: (path: string, opts?: { jumpToLine?: number }) => void;
  /** 1-indexed PDF page to scroll into view on mount. */
  jumpToPage?: number;
  /** Reports the first visible 1-indexed source line in CodeMirror text views. */
  onVisibleLineChange?: (line: number) => void;
  /** Reports the most visible 1-indexed PDF page. */
  onVisiblePageChange?: (page: number) => void;
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

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function decodeHrefPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function normalizeSlashPath(path: string): string {
  const absolute = path.startsWith('/');
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }
  return `${absolute ? '/' : ''}${parts.join('/')}`;
}

function parseJumpLine(hash: string): number | undefined {
  const match = hash.match(/^#L(\d+)(?:\b|$|-)/i);
  if (!match) return undefined;
  const line = Number(match[1]);
  return Number.isFinite(line) && line > 0 ? line : undefined;
}

export function resolveRelativeFileHref(baseFilePath: string, href: string): { path: string; jumpToLine?: number } | null {
  if (!href || href.startsWith('#') || href.startsWith('/') || href.startsWith('//')) return null;
  if (URL_SCHEME_RE.test(href)) return null;
  const hashIndex = href.indexOf('#');
  const queryIndex = href.indexOf('?');
  const pathEnd = Math.min(
    ...[hashIndex, queryIndex].filter((idx) => idx >= 0),
    href.length,
  );
  const hrefPath = href.slice(0, pathEnd);
  if (!hrefPath) return null;
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : '';
  const baseDir = baseFilePath.includes('/') ? baseFilePath.slice(0, baseFilePath.lastIndexOf('/')) : '';
  return {
    path: normalizeSlashPath(`${baseDir}/${decodeHrefPath(hrefPath)}`),
    jumpToLine: parseJumpLine(hash),
  };
}

export function buildFileModeHref(currentHref: string, path: string): string {
  const url = new URL(currentHref);
  url.pathname = '/';
  url.search = '';
  const params = new URLSearchParams(url.hash.replace(/^#/, ''));
  params.set('mode', 'narrative');
  params.delete('fiber');
  params.set('file', path);
  url.hash = params.toString();
  return `${url.pathname}${url.search}${url.hash}`;
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
  onVisibleLineChange,
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
  const onVisibleLineChangeRef = useRef(onVisibleLineChange);
  onDocChangeRef.current = onDocChange;
  onSaveRef.current = onSave;
  onVisibleLineChangeRef.current = onVisibleLineChange;

  const adapter = useAdapter();
  const canAnnotate = !!(annotationSlug && onAnnotationsChange);
  const annotationsRef = useRef<Annotation[]>(annotations ?? []);
  annotationsRef.current = annotations ?? [];
  const onAnnotationsChangeRef = useRef(onAnnotationsChange);
  onAnnotationsChangeRef.current = onAnnotationsChange;

  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [popover, setPopover] = useState<PopoverInfo | null>(null);

  // Substrate-agnostic composer state — text, open/dismiss, keyboard
  // handling. The hook fires our `onSubmit`, which enriches the create
  // payload with CodeMirror-specific char-offset/line metadata before
  // dispatching to the adapter; on truthy result it resets text + open.
  // Selection-clearing and popover-dismissal stay here because they're
  // substrate-bound (CodeMirror selection / wrapper-relative popover
  // positioning).
  const composer = useAnnotationComposer({
    onSubmit: async (text) => {
      if (!selection || !annotationSlug) return null;
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
          comment: text,
          from: selection.from,
          to: selection.to,
          line,
          endLine,
        });
        if (!created) return null;
        onAnnotationsChangeRef.current?.([...annotationsRef.current, created]);
        setSelection(null);
        view?.dispatch({ selection: EditorSelection.cursor(selection.to) });
        return created;
      } catch (err) {
        console.error('createAnnotation failed', err);
        return null;
      }
    },
  });

  // `dismissAll` is the catch-all the legacy code used to wipe every
  // composer/popover surface back to baseline. The composer hook owns
  // its own dismiss; we layer the substrate-bound resets on top
  // (selection, popover). Kept as a stable callback because it's
  // referenced from effect deps.
  const dismissAll = useCallback(() => {
    setSelection(null);
    composer.dismiss();
    setPopover(null);
  }, [composer.dismiss]);

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
      EditorView.lineWrapping,
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
      EditorView.updateListener.of((update) => {
        if (!update.viewportChanged && !update.docChanged) return;
        const line = update.state.doc.lineAt(update.view.viewport.from).number;
        onVisibleLineChangeRef.current?.(line);
      }),
    ];

    if (editable) {
      extensions.push(
        vim(),
        history(),
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
            composer.dismiss();
            return;
          }
          const text = update.state.doc.sliceString(sel.from, sel.to);
          if (text.trim().length < 2) {
            setSelection(null);
            composer.dismiss();
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
    onVisibleLineChangeRef.current?.(view.state.doc.lineAt(view.viewport.from).number);
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
    // `composer.dismiss` is referentially stable (useCallback with empty
    // deps in the hook), so including it in the deps doesn't trigger
    // editor re-mounts on every composer state flip.
  }, [file.path, file.content, file.language, editable, jumpToLine, canAnnotate, coordsRelativeToWrapper, composer.dismiss]);

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
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [canAnnotate]);

  // useAnnotationComposer auto-focuses inputRef when `composer.open`
  // flips true; FileReader binds composer.inputRef to the textarea
  // below, so no extra focus effect needed here.

  // Popover Edit handler — adapter call + upstream list update; the
  // shared <AnnotationPopover/> owns its own editing UI/state and
  // closes itself on resolve via onClose.
  const handleEdit = useCallback(
    async (annotationId: string, next: string) => {
      try {
        const updated = await adapter.updateAnnotation(annotationId, next);
        if (!updated) return;
        const list = annotationsRef.current.map((a) =>
          a.id === updated.id ? updated : a,
        );
        onAnnotationsChangeRef.current?.(list);
      } catch (err) {
        console.error('updateAnnotation failed', err);
      }
    },
    [adapter],
  );

  // Popover Delete handler — symmetric to handleEdit. The popover
  // calls onClose after this resolves; we clear our `popover` state
  // there so the surface unmounts cleanly.
  const handleDelete = useCallback(
    async (annotationId: string) => {
      try {
        const ok = await adapter.deleteAnnotation(annotationId);
        if (!ok) return;
        onAnnotationsChangeRef.current?.(
          annotationsRef.current.filter((a) => a.id !== annotationId),
        );
      } catch (err) {
        console.error('deleteAnnotation failed', err);
      }
    },
    [adapter],
  );

  return (
    <div ref={wrapperRef} className="vellum-text-reader-wrapper">
      <div
        ref={hostRef}
        className={`vellum-file-reader vellum-file-reader--text${editable ? ' vellum-file-reader--editable' : ''}`}
      />
      {canAnnotate && selection && !composer.open && (
        <div
          className="ann-toolbar"
          style={{ position: 'absolute', top: Math.max(0, selection.top - 36), left: selection.left }}
        >
          <button
            type="button"
            className="ann-toolbar__btn"
            onClick={(e) => {
              e.stopPropagation();
              composer.start();
            }}
          >
            + Note
          </button>
        </div>
      )}
      {canAnnotate && selection && composer.open && (
        <div
          className="ann-toolbar ann-toolbar--comment"
          style={{ position: 'absolute', top: selection.top + 24, left: selection.left }}
        >
          <textarea
            ref={composer.inputRef as React.RefObject<HTMLTextAreaElement>}
            className="ann-toolbar__input"
            placeholder="Add a note..."
            value={composer.text}
            onChange={(e) => composer.setText(e.target.value)}
            onKeyDown={composer.keyDown}
            rows={2}
          />
          <div className="ann-toolbar__actions">
            <button
              type="button"
              className="ann-toolbar__submit"
              disabled={!composer.text.trim()}
              onClick={() => void composer.submit()}
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
        <AnnotationPopover
          annotation={popover.annotation}
          top={popover.top}
          left={popover.left}
          positionStrategy="absolute"
          onEdit={(next) => handleEdit(popover.annotation.id, next)}
          onDelete={() => handleDelete(popover.annotation.id)}
          actions={annotationActions}
          onClose={() => setPopover(null)}
        />
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
function MarkdownReader({
  file,
  jumpToLine,
  onNavigateToFile,
  annotations,
  annotationSlug,
  onAnnotationsChange,
}: FileReaderProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  // proseRef is what TextAnnotationLayer scopes selection-tracking and highlight
  // hit-testing to; we mount it on an <article> sibling of the layer so the
  // ThemePicker / FiberHeader chrome at the top of the wrapper stays out of the
  // selection range. Same shape as NarrativeView's vellum-prose-wrapper /
  // vellum-prose pair.
  const proseRef = useRef<HTMLElement | null>(null);
  const [proseEl, setProseEl] = useState<HTMLElement | null>(null);
  const [contentWidth, setContentWidth] = useState<number>(MARKDOWN_INITIAL_CONTENT_WIDTH);
  const bindProseRef = useCallback((el: HTMLElement | null) => {
    proseRef.current = el;
    setProseEl(el);
  }, []);

  // Observe the prose element's content-box inline size — same pattern as
  // NarrativeView. `.vellum-prose` carries 3.5rem horizontal padding, so
  // observing the wrapper and subtracting only the wrapper's own padding
  // double-counts: PretextProse would lay out ~112px wider than the prose
  // content box, and lines run past the right edge as the canvas divider
  // narrows the column. `contentBoxSize.inlineSize` already excludes padding,
  // so PretextProse receives the actual layout width the browser will use to
  // wrap text.
  useLayoutEffect(() => {
    if (!proseEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const boxes = entry.contentBoxSize;
        let inline: number | null = null;
        if (boxes) {
          const box = Array.isArray(boxes) ? boxes[0] : boxes;
          inline = box?.inlineSize ?? null;
        }
        if (inline == null) {
          inline = entry.contentRect?.width ?? null;
        }
        if (inline != null && inline > 0) {
          const next = Math.max(120, inline);
          setContentWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
        }
      }
    });
    observer.observe(proseEl);
    return () => observer.disconnect();
  }, [proseEl]);

  // Annotation surfacing is gated on the host wiring up `annotationSlug` +
  // `onAnnotationsChange` — the same contract TextReader uses — so a host
  // that doesn't route annotations (read-only static viewer, etc.) skips
  // the layer entirely and pays nothing.
  const annotationsEnabled = !!annotationSlug && !!onAnnotationsChange;
  const keyedMdast = file.mdast ? assignMdastKeys(file.mdast, `file:${file.path}`) : file.mdast;
  const handleProseClick = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      if (!onNavigateToFile || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]');
      const href = anchor?.dataset['originalHref'] ?? anchor?.getAttribute('href') ?? '';
      const target = anchor?.getAttribute('target');
      if (!href || target === '_blank') return;
      const resolved = resolveRelativeFileHref(file.path, href);
      if (!resolved) return;
      e.preventDefault();
      onNavigateToFile(resolved.path, { jumpToLine: resolved.jumpToLine });
    },
    [file.path, onNavigateToFile],
  );
  const resolveRenderedHref = useCallback(
    (href: string) => {
      const resolved = resolveRelativeFileHref(file.path, href);
      if (!resolved) return href;
      return buildFileModeHref(window.location.href, resolved.path);
    },
    [file.path],
  );
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
          {/* Wrap PretextProse in an <article> so TextAnnotationLayer's
              selection scope stays inside the prose body (not the chrome above).
              Mirrors NarrativeView.vellum-prose ↔ TextAnnotationLayer pairing. */}
          <article ref={bindProseRef} className="vellum-prose vellum-prose--pretext" onClick={handleProseClick}>
            <PretextProse
              mdast={keyedMdast}
              contentWidth={contentWidth}
              resolveHref={resolveRenderedHref}
              jumpToLine={jumpToLine}
            />
          </article>
          {annotationsEnabled && proseEl && (
            <TextAnnotationLayer
              slug={annotationSlug!}
              annotations={annotations ?? []}
              proseRef={proseRef}
              wrapperRef={wrapperRef as React.RefObject<HTMLElement>}
              onAnnotationsChange={onAnnotationsChange!}
            />
          )}
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

/**
 * Imperative handle for `<PdfReader>`. Today: 1-indexed `scrollToPage`.
 *
 * Mirrors `paper-viewer.js`'s `scrollToPage` so the in-modal "Evidence ·
 * page <n>" link behaves the same in both renderers — see the
 * vellum-native astra renderer constitution at
 * `vellum-reader/vellum-native-astra-renderer`. Calls before the PDF
 * finishes loading are queued and replayed once the requested page
 * lands; calls for a non-existent page are no-ops.
 */
export interface PdfReaderHandle {
  scrollToPage(pageNum: number): void;
}

export const PdfReader = forwardRef<PdfReaderHandle, FileReaderProps>(function PdfReader(
  { file, jumpToPage, onVisiblePageChange },
  handleRef,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onVisiblePageChangeRef = useRef(onVisiblePageChange);
  onVisiblePageChangeRef.current = onVisiblePageChange;
  // Holds the per-page wrapper divs in 1..N order. Wrappers are
  // pre-created up-front (with the correct viewport-derived height) so
  // the document occupies its final scroll height before any page has
  // rasterized — that lets `scrollIntoView` land on the right Y even
  // when the target canvas is still blank, and lets the render loop
  // fill canvases out of order without the rest of the document shifting.
  // 1-indexed semantics: caller passes `n`, we resolve `pageElsRef.current[n - 1]`.
  const pageElsRef = useRef<HTMLDivElement[]>([]);
  // If `scrollToPage` is called before the wrappers have been mounted
  // (the brief window before pre-creation finishes), stash the target
  // so the loop can replay the scroll once the wrappers exist.
  const pendingPageRef = useRef<number | null>(null);
  // "Render this page next, jumping the queue." Set on every
  // `scrollToPage` call so the render loop can re-prioritize away from
  // its serial 1..N order — without this, jumping to page 23 of a
  // 30-page PDF would wait for pages 1..22 to render serially before
  // the user sees content (~6 s in the wild). The loop drains this
  // before every step. See fiber:
  // `vellum-reader/astra-paper-modal-page-jump-render-wait`.
  const requestedPageRef = useRef<number | null>(null);

  const scrollToPage = useCallback((pageNum: number) => {
    if (!Number.isFinite(pageNum) || pageNum < 1) return;
    // Always tell the render loop "this is the page the user wants" so
    // it can jump the serial queue. Cheap and idempotent — the loop
    // only acts on it when the page isn't yet rendered.
    requestedPageRef.current = pageNum;
    const els = pageElsRef.current;
    const el = els[pageNum - 1];
    if (!el) {
      // Wrappers not mounted yet. Queue the scroll for replay; the
      // render loop replays once pre-creation lands the wrappers.
      pendingPageRef.current = pageNum;
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('vellum-file-reader__pdf-page--highlight');
    // Force reflow so the keyframe restarts even if the class was just removed.
    void el.offsetWidth;
    el.classList.add('vellum-file-reader__pdf-page--highlight');
    window.setTimeout(() => {
      el.classList.remove('vellum-file-reader__pdf-page--highlight');
    }, 1800);
  }, []);

  useImperativeHandle(handleRef, () => ({ scrollToPage }), [scrollToPage]);

  useEffect(() => {
    if (!hostRef.current || !file.url) return;
    const container = hostRef.current;
    container.innerHTML = '';
    pageElsRef.current = [];
    let cancelled = false;
    let loadingTask: { destroy: () => void } | null = null;
    let pageObserver: IntersectionObserver | null = null;

    (async () => {
      const pdfjs = await loadPdfJs();
      if (cancelled) return;
      const task = pdfjs.getDocument(file.url!);
      loadingTask = task;
      const doc = await task.promise;
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const containerWidth = container.clientWidth || 800;

      // Phase 1 — pre-create all per-page wrappers, in DOM order, sized
      // to each page's final viewport. Page metadata fetches in
      // parallel so this stays cheap on big papers (single pdfjs worker
      // serializes most of it under the hood, but pipelining still
      // beats fully-serial awaits). After this phase the document
      // occupies its full scroll height even though every canvas is
      // still blank — `scrollToPage(N)` lands on the right Y
      // immediately, and the render loop in phase 2 can fill canvases
      // out of order without making the document jump.
      type RenderJob = {
        page: Awaited<ReturnType<typeof doc.getPage>>;
        canvas: HTMLCanvasElement;
        viewport: ReturnType<Awaited<ReturnType<typeof doc.getPage>>['getViewport']>;
        rendered: boolean;
      };
      const pages = await Promise.all(
        Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
      );
      if (cancelled) return;
      const jobs: RenderJob[] = pages.map((page) => {
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = (containerWidth * dpr) / unscaledViewport.width;
        const viewport = page.getViewport({ scale });
        // Wrap each canvas in a div so we can scope the highlight pulse
        // to the targeted page (paper-viewer.js does the same with
        // `pv-paper-modal__pdf-page`). Tagging with `data-page` lets
        // tests / downstream code reach a specific page if needed.
        const wrap = document.createElement('div');
        wrap.className = 'vellum-file-reader__pdf-page';
        wrap.dataset.page = String(page.pageNumber);
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.display = 'block';
        wrap.appendChild(canvas);
        container.appendChild(wrap);
        pageElsRef.current.push(wrap);
        return { page, canvas, viewport, rendered: false };
      });
      if (cancelled) return;
      if (typeof IntersectionObserver !== 'undefined' && onVisiblePageChangeRef.current) {
        const visiblePages = new Map<number, IntersectionObserverEntry>();
        pageObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const page = Number((entry.target as HTMLElement).dataset.page);
              if (!Number.isFinite(page)) continue;
              if (entry.isIntersecting && entry.intersectionRatio > 0) {
                visiblePages.set(page, entry);
              } else {
                visiblePages.delete(page);
              }
            }
            const best = Array.from(visiblePages.entries())
              .sort(([, a], [, b]) =>
                b.intersectionRatio - a.intersectionRatio ||
                Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top),
              )[0];
            if (best) onVisiblePageChangeRef.current?.(best[0]);
          },
          { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
        );
        for (const el of pageElsRef.current) pageObserver.observe(el);
      }

      // Wrappers exist now. If a scroll was queued before the user even
      // got here, replay it — the wrapper for the target is in the DOM
      // (canvas blank), so the scroll lands on the right Y immediately.
      // The replay also re-asserts requestedPageRef so phase 2 picks up
      // the priority below.
      const queued = jumpToPage ?? pendingPageRef.current;
      if (queued != null && queued >= 1 && queued <= jobs.length) {
        pendingPageRef.current = null;
        scrollToPage(queued);
      }

      // Phase 2 — render with priority. Drain `requestedPageRef`
      // before every step, so any scrollToPage call (queued at
      // mount, fired by a focus-insight effect, or triggered by a
      // user click on an evidence-page button mid-render) jumps the
      // serial queue. Then advance the serial pointer through
      // already-rendered pages.
      const renderJob = async (i: number): Promise<void> => {
        const job = jobs[i - 1];
        if (!job || job.rendered) return;
        const ctx = job.canvas.getContext('2d');
        if (!ctx) {
          job.rendered = true;
          return;
        }
        await job.page.render({
          canvas: job.canvas,
          canvasContext: ctx,
          viewport: job.viewport,
        }).promise;
        job.rendered = true;
        // Mark the wrapper rendered so tests / agent-browser can verify
        // priority-render behavior without inspecting canvas pixels. Same
        // shape as paper-viewer.js's post-render class hook.
        const wrap = pageElsRef.current[i - 1];
        if (wrap) wrap.dataset.rendered = '1';
      };

      let i = 1;
      while (i <= jobs.length) {
        if (cancelled) break;
        const requested = requestedPageRef.current;
        if (
          requested != null &&
          requested >= 1 &&
          requested <= jobs.length &&
          !jobs[requested - 1].rendered
        ) {
          requestedPageRef.current = null;
          await renderJob(requested);
          continue;
        }
        if (!jobs[i - 1].rendered) {
          await renderJob(i);
        }
        i++;
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
      pageObserver?.disconnect();
      container.innerHTML = '';
      pageElsRef.current = [];
      pendingPageRef.current = null;
      requestedPageRef.current = null;
    };
  }, [file.url, jumpToPage, scrollToPage]);

  if (!file.url) {
    return (
      <div className="vellum-file-reader vellum-file-reader--pdf">
        <p>No URL supplied for {file.path}.</p>
      </div>
    );
  }
  return <div ref={hostRef} className="vellum-file-reader vellum-file-reader--pdf" />;
});

export function FileReader(props: FileReaderProps) {
  const { file, editable } = props;
  switch (file.kind) {
    case 'image':
      return <ImageReader file={file} />;
    case 'html':
      return <HtmlReader file={file} />;
    case 'pdf':
      return <PdfReader file={file} jumpToPage={props.jumpToPage} onVisiblePageChange={props.onVisiblePageChange} />;
    case 'markdown':
      // Editable mode always uses the source-view text reader so the user can
      // actually type. Read-mode renders through the canvas (PretextProse via
      // MarkdownReader) so non-fiber markdown gets the same substrate as a
      // fiber body — see ai-futures/portolan/vellum-reader/markdown-and-fibers-share-canvas.
      // jumpToLine is forwarded so a deep link can land the canvas reader on
      // the source paragraph without flipping to the editor.
      if (!editable && file.mdast) {
        return <MarkdownReader {...props} />;
      }
      return <TextReader {...props} />;
    case 'text':
    default:
      return <TextReader {...props} />;
  }
}
