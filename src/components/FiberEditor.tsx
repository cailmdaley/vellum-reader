/**
 * FiberEditor — the authoring surface for a fiber body.
 *
 * Two modes driven by the pretext refoundation Step 6 brief:
 *
 *   - `projection` (default): prose-first. Serif font at prose size,
 *     prose line-height, no gutter, no line numbers, no visible frame.
 *     Entering edit mode should feel like the page became writable, not
 *     like the app switched tools. The only disciplined divergence from
 *     the reader is that markdown source is shown as source — a live
 *     WYSIWYM preview is a later project. Frontmatter is already omitted
 *     because the raw-fiber endpoint returns body-only.
 *
 *   - `raw`: monospace escape hatch with line numbers and gutter. Still
 *     available behind an explicit keybinding (`Mod-Shift-R`) for the
 *     moments when the user wants the mechanical affordances of a
 *     traditional source editor. Kept as a first-class mode rather than
 *     a dev-only toggle — the projection editor is the default surface,
 *     not a replacement for the raw one.
 *
 * Vim keymap is orthogonal to the mode and toggled with `Mod-Shift-V`.
 * Both preferences persist to localStorage so a user who prefers vim
 * + raw doesn't have to re-configure every fiber.
 *
 * Keybindings:
 *   ⌘S            — save
 *   Esc Esc       — save & exit  (double-escape; single escape stays in
 *                   vim-normal-mode inside vim keymap)
 *   ⌘⇧R           — toggle raw / projection
 *   ⌘⇧M           — toggle vim keymap
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { vim } from '@replit/codemirror-vim';

export type EditorMode = 'projection' | 'raw';

/**
 * Split a fiber file into frontmatter prefix and body. The prefix includes
 * the `---` delimiters and trailing newline so re-joining is just concat.
 */
function splitFrontmatter(raw: string): { prefix: string; body: string } {
  const match = raw.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  if (!match) return { prefix: '', body: raw };
  return { prefix: match[1], body: match[2] };
}

export interface FiberEditorProps {
  initialValue: string;
  onSave: (value: string) => Promise<void>;
  onCancel: () => void;
}

const MODE_STORAGE_KEY = 'vellum:editor-mode';
const VIM_STORAGE_KEY = 'vellum:editor-vim';

function loadMode(): EditorMode {
  if (typeof localStorage === 'undefined') return 'projection';
  const stored = localStorage.getItem(MODE_STORAGE_KEY);
  return stored === 'raw' ? 'raw' : 'projection';
}

function loadVim(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(VIM_STORAGE_KEY) === '1';
}

/**
 * Projection theme. Mirrors `.vellum-prose` body typography — the same
 * EB Garamond stack, the same 18px root, the same 1.78 line-height. The
 * editor is mounted inside `.vellum-prose`, which already supplies
 * 3.5rem of left/right padding, so the editor does not need its own
 * horizontal padding. The caret colour matches reader gold.
 */
const projectionTheme = EditorView.theme(
  {
    '&': {
      fontFamily: "'EB Garamond', Georgia, 'Times New Roman', serif",
      fontSize: '18px',
      color: 'var(--text)',
      backgroundColor: 'transparent',
    },
    '.cm-scroller': {
      fontFamily: "'EB Garamond', Georgia, 'Times New Roman', serif",
      lineHeight: '1.78',
    },
    '.cm-content': {
      caretColor: 'var(--gold)',
      padding: '0',
    },
    '.cm-line': {
      padding: '0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--gold)',
      borderLeftWidth: '2px',
    },
    '.cm-fat-cursor, &:not(.cm-focused) .cm-fat-cursor': {
      // Vim block cursor — tint it with gold instead of CM's default blue.
      background: 'rgba(154, 123, 53, 0.38) !important',
      outline: 'none !important',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground': {
      backgroundColor: 'rgba(90, 123, 123, 0.22) !important',
    },
    '.cm-gutters': {
      display: 'none',
    },
    '&.cm-focused': {
      outline: 'none',
    },
  },
  { dark: false },
);

/**
 * Raw theme. Closer to a traditional source editor — monospace, line
 * numbers, active-line highlighting, modest gutter. Kept as the escape
 * hatch for mechanical edits that want a column-oriented view.
 */
const rawTheme = EditorView.theme(
  {
    '&': {
      fontSize: '14px',
      backgroundColor: 'var(--prose-bg)',
      color: 'var(--text)',
    },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', 'Menlo', 'Consolas', monospace",
      lineHeight: '1.6',
    },
    '.cm-content': {
      caretColor: 'var(--gold)',
      padding: '0.5rem 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--gold)',
      borderLeftWidth: '2px',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--gold-faint)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--gold-faint)',
    },
    '&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground': {
      backgroundColor: 'rgba(90, 123, 123, 0.22) !important',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--text-muted)',
      border: 'none',
      borderRight: '1px solid var(--border-faint)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 10px 0 6px',
      fontVariantNumeric: 'tabular-nums',
    },
    '&.cm-focused': {
      outline: 'none',
    },
  },
  { dark: false },
);

export function FiberEditor({ initialValue, onSave, onCancel }: FiberEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>(() => loadMode());
  const [vimEnabled, setVimEnabled] = useState<boolean>(() => loadVim());
  const lastEscapeRef = useRef<number>(0);
  const onSaveRef = useRef(onSave);
  const onCancelRef = useRef(onCancel);
  const initialValueRef = useRef(initialValue);
  // In projection mode, frontmatter is stripped from the editor and stored here
  // so it can be re-prepended on save without the user seeing it.
  const frontmatterRef = useRef<string>(splitFrontmatter(initialValue).prefix);

  useEffect(() => {
    onSaveRef.current = onSave;
    onCancelRef.current = onCancel;
  }, [onSave, onCancel]);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    }
  }, [mode]);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VIM_STORAGE_KEY, vimEnabled ? '1' : '0');
    }
  }, [vimEnabled]);

  const doSave = useCallback(async (): Promise<boolean> => {
    const view = viewRef.current;
    if (!view) return false;
    const editorContent = view.state.doc.toString();
    // Re-prepend frontmatter that was stripped in projection mode.
    const value = frontmatterRef.current + editorContent;
    setSaving(true);
    setErrorMsg(null);
    try {
      await onSaveRef.current(value);
      initialValueRef.current = value;
      setDirty(false);
      return true;
    } catch (err) {
      setErrorMsg((err as Error).message || 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  // Three compartments let us hot-swap mode, vim keymap, and the
  // gutter-dependent extensions (lineNumbers, highlightActiveLine,
  // highlightActiveLineGutter) without re-creating the view and losing
  // cursor + undo history.
  const modeCompartment = useMemo(() => new Compartment(), []);
  const vimCompartment = useMemo(() => new Compartment(), []);
  const chromeCompartment = useMemo(() => new Compartment(), []);

  const modeExtension = (m: EditorMode): Extension =>
    m === 'projection' ? projectionTheme : rawTheme;

  const chromeExtension = (m: EditorMode): Extension =>
    m === 'projection'
      ? []
      : [lineNumbers(), highlightActiveLineGutter(), highlightActiveLine()];

  const vimExtension = (enabled: boolean): Extension => (enabled ? vim() : []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const initialMode = mode;
    const initialVim = vimEnabled;

    const extensions: Extension[] = [
      // Vim first — its keymap has to beat the default one.
      vimCompartment.of(vimExtension(initialVim)),
      chromeCompartment.of(chromeExtension(initialMode)),
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      EditorState.allowMultipleSelections.of(true),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      markdown(),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            void doSave();
            return true;
          },
        },
        {
          key: 'Mod-Shift-r',
          preventDefault: true,
          run: () => {
            setMode((cur) => (cur === 'projection' ? 'raw' : 'projection'));
            return true;
          },
        },
        {
          key: 'Mod-Shift-m',
          preventDefault: true,
          run: () => {
            setVimEnabled((cur) => !cur);
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      modeCompartment.of(modeExtension(initialMode)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const current = update.state.doc.toString();
          // Compare against the body-only baseline (projection strips frontmatter).
          const baseline = initialMode === 'projection'
            ? splitFrontmatter(initialValueRef.current).body
            : initialValueRef.current;
          const isDirty = current !== baseline;
          setDirty((prev) => (prev === isDirty ? prev : isDirty));
        }
      }),
    ];

    // In projection mode, strip frontmatter so the editor shows only the
    // markdown body. Raw mode shows the full file content.
    const { prefix, body } = splitFrontmatter(initialValueRef.current);
    frontmatterRef.current = prefix;
    const doc = initialMode === 'projection' ? body : initialValueRef.current;

    const state = EditorState.create({
      doc,
      extensions,
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Compartments and doSave are stable refs; we intentionally run this
    // effect once on mount and reconfigure via the compartments below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doSave]);

  // Reconfigure when `mode` or `vimEnabled` changes. When toggling between
  // projection and raw, swap the document content to add/remove frontmatter.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    let newDoc: string | null = null;

    if (mode === 'raw') {
      // Switching TO raw: prepend frontmatter so the user sees the full file.
      if (frontmatterRef.current && !currentDoc.startsWith('---\n')) {
        newDoc = frontmatterRef.current + currentDoc;
      }
    } else {
      // Switching TO projection: strip frontmatter.
      const { prefix, body } = splitFrontmatter(currentDoc);
      if (prefix) {
        frontmatterRef.current = prefix;
        newDoc = body;
      }
    }

    const effects = [
      modeCompartment.reconfigure(modeExtension(mode)),
      chromeCompartment.reconfigure(chromeExtension(mode)),
    ];

    if (newDoc !== null) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: newDoc },
        effects,
      });
    } else {
      view.dispatch({ effects });
    }
  }, [mode, modeCompartment, chromeCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: vimCompartment.reconfigure(vimExtension(vimEnabled)),
    });
  }, [vimEnabled, vimCompartment]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const host = hostRef.current;
      if (!host) return;
      const active = document.activeElement;
      if (!host.contains(active) && active !== document.body) return;

      // Vim uses <Esc> to leave insert mode; we must not eat it while
      // the user is transitioning states inside vim. Only the double-
      // escape path commits + exits the editor.
      const now = Date.now();
      if (now - lastEscapeRef.current < 1000) {
        e.preventDefault();
        e.stopPropagation();
        lastEscapeRef.current = 0;
        const view = viewRef.current;
        if (!view) return;
        const value = view.state.doc.toString();
        const isDirty = value !== initialValueRef.current;
        if (isDirty) {
          void doSave().then((ok) => {
            if (ok) onCancelRef.current();
          });
        } else {
          onCancelRef.current();
        }
        return;
      }

      lastEscapeRef.current = now;
      // We intentionally do NOT preventDefault here — the first escape
      // should still propagate into CM so vim sees it and leaves insert
      // mode. The second escape within 1s commits the double-escape
      // exit path above.
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [doSave]);

  return (
    <div
      className={`fiber-editor fiber-editor--${mode}`}
      role="region"
      aria-label="Fiber editor"
    >
      <div className="fiber-editor__toolbar">
        <span className="fiber-editor__label">
          {mode === 'projection' ? 'editing' : 'editing source'}
          {dirty ? (
            <span className="fiber-editor__dirty" aria-label="unsaved changes">
              {' '}
              •
            </span>
          ) : null}
        </span>
        <div className="fiber-editor__actions">
          {errorMsg ? (
            <span className="fiber-editor__error" role="alert">
              {errorMsg}
            </span>
          ) : null}
          <button
            type="button"
            className={`fiber-editor__toggle${
              vimEnabled ? ' fiber-editor__toggle--on' : ''
            }`}
            onClick={() => setVimEnabled((cur) => !cur)}
            title="Toggle vim keymap (⌘⇧M)"
            aria-pressed={vimEnabled}
          >
            vim
          </button>
          <button
            type="button"
            className={`fiber-editor__toggle${
              mode === 'raw' ? ' fiber-editor__toggle--on' : ''
            }`}
            onClick={() =>
              setMode((cur) => (cur === 'projection' ? 'raw' : 'projection'))
            }
            title="Toggle raw source view (⌘⇧R)"
            aria-pressed={mode === 'raw'}
          >
            raw
          </button>
          <button
            type="button"
            className="fiber-editor__button"
            onClick={() => {
              onCancelRef.current();
            }}
            disabled={saving}
          >
            cancel
          </button>
          <button
            type="button"
            className="fiber-editor__button fiber-editor__button--primary"
            onClick={() => void doSave()}
            disabled={!dirty || saving}
          >
            {saving ? 'saving…' : 'save'}
          </button>
        </div>
      </div>
      <div className="fiber-editor__host" ref={hostRef} />
      <div className="fiber-editor__hint">
        <kbd>⌘S</kbd> save · <kbd>Esc Esc</kbd> save &amp; exit ·{' '}
        <kbd>⌘⇧R</kbd> raw · <kbd>⌘⇧M</kbd> vim
      </div>
    </div>
  );
}
