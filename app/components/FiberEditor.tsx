/**
 * FiberEditor — inline CodeMirror 6 editor for a fiber's raw markdown.
 *
 * Mounted by NarrativeView when the user double-clicks the prose column.
 * The component holds its own CM6 instance in a ref, tracks dirty state
 * for the save button + unload guard, and handles the keyboard shortcuts
 * the user is used to from portolan's file viewer:
 *
 *   Double-Escape (within 1s) — save if dirty, then exit (calls onCancel
 *                               after save completes, since the post-save
 *                               revalidation will re-render the prose).
 *   Escape (single)           — no-op (the second press is required), so
 *                               a stray Esc cannot discard unsaved work.
 *   Cmd/Ctrl+S                — save without exiting.
 *
 * The CM6 theme is a small dark-on-cream palette that matches the
 * Weathered Substrate aesthetic — no stark white, gold accents for cursor
 * and active-line, JetBrains Mono at 14px.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';

export interface FiberEditorProps {
  initialValue: string;
  /** Called with the edited value; should resolve when the server write is complete. */
  onSave: (value: string) => Promise<void>;
  /** Called to exit edit mode without saving (or after a save via double-Esc). */
  onCancel: () => void;
}

/**
 * Weathered Substrate CM6 theme — cream background, warm dark text,
 * gold accents. Deliberately restrained: no heavy shadows, no rounded
 * card, and the gutter disappears into the substrate.
 */
const weatheredSubstrateTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
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
      padding: '16px 0',
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
  const lastEscapeRef = useRef<number>(0);
  // onSave/onCancel are likely fresh closures every render; capture via ref
  // so the CM6 keymap and document-level Escape handler always see current.
  const onSaveRef = useRef(onSave);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onSaveRef.current = onSave;
    onCancelRef.current = onCancel;
  }, [onSave, onCancel]);

  // Track dirty against the initialValue for the lifetime of this mount.
  const initialValueRef = useRef(initialValue);

  const doSave = useCallback(async (): Promise<boolean> => {
    const view = viewRef.current;
    if (!view) return false;
    const value = view.state.doc.toString();
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

  // Build the CM6 instance once. Cleans up on unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      EditorState.allowMultipleSelections.of(true),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      highlightActiveLine(),
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
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      weatheredSubstrateTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const current = update.state.doc.toString();
          const isDirty = current !== initialValueRef.current;
          setDirty((prev) => (prev === isDirty ? prev : isDirty));
        }
      }),
    ];

    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions,
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally empty deps: we build the editor exactly once per mount.
    // Changing initialValue after mount would blow away the user's buffer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Double-Escape exit — listens at document level so it fires whether
  // the editor has focus or the toolbar button does.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Only react when our host is in the DOM and owns focus (prevents
      // swallowing Escape in unrelated dialogs).
      const host = hostRef.current;
      if (!host) return;
      const active = document.activeElement;
      if (!host.contains(active) && active !== document.body) return;

      const now = Date.now();
      if (now - lastEscapeRef.current < 1000) {
        // Second press — commit.
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
      // First press: arm the double-tap, swallow it so nothing else
      // reacts (e.g. annotation toolbars). Do NOT exit.
      e.preventDefault();
      e.stopPropagation();
      lastEscapeRef.current = now;
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [doSave]);

  return (
    <div className="fiber-editor" role="region" aria-label="Fiber source editor">
      <div className="fiber-editor__toolbar">
        <span className="fiber-editor__label">
          editing source
          {dirty ? <span className="fiber-editor__dirty" aria-label="unsaved changes"> •</span> : null}
        </span>
        <div className="fiber-editor__actions">
          {errorMsg ? (
            <span className="fiber-editor__error" role="alert">{errorMsg}</span>
          ) : null}
          <button
            type="button"
            className="fiber-editor__button"
            onClick={() => {
              // Cancel without saving — dirty work is discarded by design,
              // but the double-Esc flow is the primary exit. This button
              // gives a deliberate, mouse-driven escape hatch.
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
          <kbd>⌘S</kbd> save · <kbd>Esc Esc</kbd> save &amp; exit
      </div>
    </div>
  );
}
