/**
 * FileViewerPage — top-level vellum page for displaying a single project file.
 *
 * Fetches a `FileContent` through the active adapter and delegates rendering
 * to `FileReader`. Handles loading, empty, and error states; lets the host
 * frame the page (title bar, close button, keyboard shortcuts, routing).
 * Hosts pass the path and an optional originId; vellum has no opinion about
 * where a file lives on disk.
 *
 * When `editable` is true and the file is text/markdown, the page mounts a
 * mutable editor with a save toolbar. Save calls `adapter.saveFile` and
 * reports status in-toolbar. Non-text kinds ignore `editable`.
 *
 * This is the React surface that will eventually replace portolan's
 * FileViewerModal. During the absorption it can be mounted inside the
 * existing modal shell so hotkeys and positioning stay with portolan until
 * the dust settles.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdapter } from '../contexts/AdapterContext';
import type { Annotation, AnnotationAction, FileContent } from '../utils/content-types';
import { FileReader } from '../components/FileReader';

export interface FileViewerPageProps {
  path: string;
  originId?: string;
  cacheBust?: boolean;
  /** When true, text/markdown files open in an editor with save toolbar. */
  editable?: boolean;
  /** 1-indexed line to select and scroll into view once the file loads. */
  jumpToLine?: number;
  /** Navigate to another project file without leaving file mode. */
  onNavigateToFile?: (path: string, opts?: { jumpToLine?: number }) => void;
  /**
   * Host-defined actions on each annotation (e.g. "send to worker", "save as
   * fiber"). Rendered inside the annotation click-popover. Optional; omit on
   * hosts that don't route annotations anywhere.
   */
  annotationActions?: AnnotationAction[];
  /**
   * Suppress the built-in save toolbar. Use when a parent shell (modal
   * header, pin-card chrome) renders its own bar — avoids two stacked bars.
   * Pair with `onDirtyChange` / `onSaveStateChange` / `onSaveReady` so the
   * host can show dirty/status/Save in its own chrome.
   */
  hideToolbar?: boolean;
  /** Fires whenever the document's dirty bit flips. Host renders its own dirty dot. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Fires whenever save state transitions (idle/saving/saved/error). */
  onSaveStateChange?: (state: SaveState) => void;
  /**
   * Handed a save trigger once the page is ready to accept one. Fires with
   * `null` when the page unmounts so the host can clear its bar. Host wires
   * its own Save button to this.
   */
  onSaveReady?: (save: (() => Promise<void>) | null) => void;
  /** Fires whenever the annotation list for this file changes. Host uses this
   * to show/hide bulk action buttons in its own chrome. Receives the
   * "visible" set — anchor-resolved annotations actually rendered as
   * marks — which drives `scope: 'visible'` bulk actions (Send,
   * Save-as-fiber). */
  onAnnotationsChange?: (annotations: Annotation[]) => void;
  /** Fires whenever the on-disk annotation list for this file changes.
   * Drives `scope: 'stored'` bulk actions (Clear) in the host chrome —
   * the visible set under-counts when the document has drifted past
   * existing annotation anchors, and Clear should still be able to
   * sweep those zombies. Falls back to `onAnnotationsChange`'s set
   * downstream when this isn't wired. */
  onStoredAnnotationsChange?: (annotations: Annotation[]) => void;
  /** Increment to force a re-fetch of annotations from the adapter without
   * remounting the file (cursor, scroll, editor state are preserved). Use
   * after a bulk mutation (mark-sent, bulk-delete). */
  annotationRefreshKey?: number;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; file: FileContent };

export type SaveState = 'idle' | 'saving' | 'saved' | { error: string };

/**
 * What should pressing "Done" do given the current dirty state?
 *
 * `'flip-readonly'` flips the editor back to read view immediately;
 * `'ask-discard'` means the local buffer would lose work, so the host
 * needs to confirm before discarding. The branch used to live inline as
 * `!window.confirm(...)` — but Tauri's macOS WKWebView silently no-ops
 * `window.confirm`, so the button looked dead in the native shell. Now
 * the dialog is rendered as an in-component overlay; this helper keeps
 * the decision shape testable.
 */
export type DoneIntent = 'flip-readonly' | 'ask-discard';

export function resolveDoneIntent(dirty: boolean): DoneIntent {
  return dirty ? 'ask-discard' : 'flip-readonly';
}

export function chromeAnnotationsForFileViewer(
  fileKind: FileContent['kind'] | null,
  annotations: Annotation[],
  visibleAnnotations: Annotation[] | null,
): Annotation[] {
  if (fileKind == null) return [];
  if (fileKind === 'text' || fileKind === 'markdown') return visibleAnnotations ?? [];
  return annotations;
}

function visibleLineStorageKey(path: string, originId?: string): string {
  return `vellum:file-visible-line:${originId ?? 'local'}:${path}`;
}

function visiblePageStorageKey(path: string, originId?: string): string {
  return `vellum:file-visible-page:${originId ?? 'local'}:${path}`;
}

function loadVisibleLine(path: string, originId?: string): number | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(visibleLineStorageKey(path, originId));
    const line = raw ? Number(raw) : NaN;
    return Number.isFinite(line) && line > 0 ? line : undefined;
  } catch {
    return undefined;
  }
}

function loadVisiblePage(path: string, originId?: string): number | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(visiblePageStorageKey(path, originId));
    const page = raw ? Number(raw) : NaN;
    return Number.isFinite(page) && page > 0 ? page : undefined;
  } catch {
    return undefined;
  }
}

function saveVisibleLine(path: string, originId: string | undefined, line: number): void {
  if (typeof window === 'undefined' || !Number.isFinite(line) || line < 1) return;
  try {
    window.sessionStorage.setItem(visibleLineStorageKey(path, originId), String(Math.floor(line)));
  } catch {
    // Best-effort scroll restoration; private windows may deny storage.
  }
}

function saveVisiblePage(path: string, originId: string | undefined, page: number): void {
  if (typeof window === 'undefined' || !Number.isFinite(page) || page < 1) return;
  try {
    window.sessionStorage.setItem(visiblePageStorageKey(path, originId), String(Math.floor(page)));
  } catch {
    // Best-effort scroll restoration; private windows may deny storage.
  }
}

export function FileViewerPage(props: FileViewerPageProps) {
  return <FileViewerContent {...props} />;
}

function FileViewerContent({
  path,
  originId,
  cacheBust,
  editable: editableProp,
  jumpToLine,
  onNavigateToFile,
  annotationActions,
  hideToolbar,
  onDirtyChange,
  onSaveStateChange,
  onSaveReady,
  onAnnotationsChange,
  onStoredAnnotationsChange,
  annotationRefreshKey,
}: FileViewerPageProps) {
  const adapter = useAdapter();
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [visibleAnnotations, setVisibleAnnotations] = useState<Annotation[] | null>(null);
  const draftRef = useRef<string>('');
  const savedToastRef = useRef<number | null>(null);
  const visibleLineRef = useRef<number | undefined>(jumpToLine ?? loadVisibleLine(path, originId));
  const [mountJumpLine, setMountJumpLine] = useState<number | undefined>(visibleLineRef.current);
  const visiblePageRef = useRef<number | undefined>(jumpToLine ?? loadVisiblePage(path, originId));
  const [mountJumpPage, setMountJumpPage] = useState<number | undefined>(visiblePageRef.current);
  // `editable` is local state so the user can flip to source mode without
  // remounting the modal page. When the host passes no explicit override,
  // non-markdown text defaults editable; parsed markdown defaults read/Pretext.
  // An explicit host value (or the toolbar Edit/Done button) takes
  // precedence after each file load.
  const [editable, setEditable] = useState<boolean>(false);
  // Tauri's macOS WKWebView silently no-ops `window.confirm`, so a
  // sync-dialog flow can't gate "Done while dirty". Track the confirm
  // step in React state and render an inline modal instead. See
  // constitution-native-desktop-portolan/gotcha-tauri-webview-sync-dialogs.
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  useEffect(() => {
    // Close any pending confirm dialog when the document state itself
    // resolves the question (file reloaded, dirty cleared via save, host
    // forces read mode). Keeping it open across those transitions would
    // strand the user behind a no-longer-meaningful prompt.
    if (!dirty || !editable) setDiscardConfirmOpen(false);
  }, [dirty, editable]);
  useEffect(() => {
    if (state.status !== 'ready') return;
    if (editableProp === undefined) {
      setEditable(state.file.kind === 'text' || (state.file.kind === 'markdown' && !state.file.mdast));
      return;
    }
    setEditable(editableProp);
  }, [editableProp, state]);

  useEffect(() => {
    visibleLineRef.current = jumpToLine ?? loadVisibleLine(path, originId);
    setMountJumpLine(visibleLineRef.current);
    visiblePageRef.current = jumpToLine ?? loadVisiblePage(path, originId);
    setMountJumpPage(visiblePageRef.current);
  }, [path, originId, jumpToLine]);

  useEffect(() => {
    setMountJumpLine(visibleLineRef.current);
    setMountJumpPage(visiblePageRef.current);
  }, [cacheBust]);

  const handleVisibleLineChange = useCallback(
    (line: number) => {
      visibleLineRef.current = line;
      saveVisibleLine(path, originId, line);
    },
    [path, originId],
  );

  const handleVisiblePageChange = useCallback(
    (page: number) => {
      visiblePageRef.current = page;
      saveVisiblePage(path, originId, page);
    },
    [path, originId],
  );

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setDirty(false);
    setSaveState('idle');
    setAnnotations([]);
    setVisibleAnnotations(null);
    adapter
      .getFile(path, { originId, cacheBust })
      .then((file) => {
        if (cancelled) return;
        if (!file) {
          setState({ status: 'empty' });
          return;
        }
        draftRef.current = file.content;
        setState({ status: 'ready', file });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, path, originId, cacheBust]);

  // Fetch file-anchored annotations alongside the file content. Adapters that
  // don't file-anchor (lightcone) return [] and this becomes a no-op.
  // Keep both CodeMirror-style char-offset annotations and Pretext markdown
  // annotations. Markdown margin notes are anchored by selectedText plus
  // context, not from/to offsets; filtering them here makes them vanish after
  // a refresh even though the store still has them.
  useEffect(() => {
    let cancelled = false;
    setVisibleAnnotations(null);
    adapter
      .getAnnotations(path, { kind: 'text' })
      .then((rows) => {
        if (cancelled) return;
        setAnnotations(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setAnnotations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, path, cacheBust, annotationRefreshKey]);

  const doSave = useCallback(async () => {
    if (state.status !== 'ready') return;
    if (!editable) return;
    setSaveState('saving');
    try {
      await adapter.saveFile(state.file.path, draftRef.current, { originId });
      setDirty(false);
      setSaveState('saved');
      if (savedToastRef.current) window.clearTimeout(savedToastRef.current);
      savedToastRef.current = window.setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveState({ error: message });
    }
  }, [adapter, editable, originId, state]);

  useEffect(() => {
    return () => {
      if (savedToastRef.current) window.clearTimeout(savedToastRef.current);
    };
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onSaveStateChange?.(saveState);
  }, [saveState, onSaveStateChange]);

  const fileKind = state.status === 'ready' ? state.file.kind : null;
  useEffect(() => {
    onAnnotationsChange?.(chromeAnnotationsForFileViewer(fileKind, annotations, visibleAnnotations));
  }, [annotations, fileKind, visibleAnnotations, onAnnotationsChange]);
  // The stored channel is the full adapter-returned set, irrespective
  // of which anchors currently resolve. Drives `scope: 'stored'`
  // actions (Clear). For non-text file kinds the chrome already
  // operates on the full set, so the channels coincide — emitting
  // both keeps the wiring uniform across kinds.
  useEffect(() => {
    onStoredAnnotationsChange?.(annotations);
  }, [annotations, onStoredAnnotationsChange]);

  useEffect(() => {
    if (!onSaveReady) return;
    const canSave = editable && state.status === 'ready' &&
      (state.file.kind === 'text' || state.file.kind === 'markdown');
    onSaveReady(canSave ? doSave : null);
    return () => onSaveReady(null);
  }, [onSaveReady, doSave, editable, state]);

  if (state.status === 'loading') {
    return <div className="vellum-file-viewer-page vellum-file-viewer-page--loading">Loading {path}…</div>;
  }
  if (state.status === 'empty') {
    return (
      <div className="vellum-file-viewer-page vellum-file-viewer-page--empty">
        Could not load <code>{path}</code>.
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="vellum-file-viewer-page vellum-file-viewer-page--error">
        Error loading <code>{path}</code>: {state.message}
      </div>
    );
  }

  // Toolbar shows for any text/markdown file when the host hasn't suppressed
  // it. In read mode it carries an Edit button; in edit mode it carries the
  // dirty + save indicators plus a Done button to flip back. The hideToolbar
  // escape stays available for hosts that want to render their own bar
  // (DomPinLayer's pin chrome, for example).
  const isTextOrMd = state.file.kind === 'text' || state.file.kind === 'markdown';
  const showToolbar = !hideToolbar && isTextOrMd;

  return (
    <div
      className={`vellum-file-viewer-page${editable ? ' vellum-file-viewer-page--editable' : ''}`}
    >
      {showToolbar && (
        <div className="vellum-file-viewer-page__toolbar">
          <span className="vellum-file-viewer-page__path">
            {state.file.path}
            {dirty && <span className="vellum-file-viewer-page__dirty" aria-hidden="true"> •</span>}
          </span>
          <span className="vellum-file-viewer-page__status">
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'Saved'}
            {typeof saveState === 'object' && `Error: ${saveState.error}`}
          </span>
          {editable ? (
            <>
              <button
                type="button"
                className="vellum-file-viewer-page__save"
                onClick={doSave}
                disabled={!dirty || saveState === 'saving'}
              >
                Save
              </button>
              <button
                type="button"
                className="vellum-file-viewer-page__done"
                onClick={() => {
                  // Done flips back to read view. If the buffer is dirty the
                  // canvas would otherwise show stale prose (mdast is parsed
                  // from `file.content` server-side, not the local draft) —
                  // route through an inline confirm so the user doesn't
                  // silently lose work. The previous `window.confirm` call
                  // here silently no-oped in Tauri's WKWebView and the
                  // button looked dead; see resolveDoneIntent + the inline
                  // overlay below.
                  if (resolveDoneIntent(dirty) === 'ask-discard') {
                    setDiscardConfirmOpen(true);
                    return;
                  }
                  setEditable(false);
                }}
                title="Return to read view (asks before discarding unsaved edits)"
              >
                Done
              </button>
            </>
          ) : (
            <button
              type="button"
              className="vellum-file-viewer-page__edit"
              onClick={() => setEditable(true)}
              title="Edit this file"
            >
              Edit
            </button>
          )}
        </div>
      )}
      <FileReader
        file={state.file}
        editable={editable}
        jumpToLine={mountJumpLine}
        jumpToPage={mountJumpPage}
        onNavigateToFile={onNavigateToFile}
        onVisibleLineChange={handleVisibleLineChange}
        onVisiblePageChange={handleVisiblePageChange}
        annotations={annotations}
        onVisibleAnnotationsChange={setVisibleAnnotations}
        annotationSlug={path}
        annotationOriginId={originId}
        annotationActions={annotationActions}
        onAnnotationsChange={setAnnotations}
        onDocChange={(content) => {
          draftRef.current = content;
          setDirty(content !== state.file.content);
        }}
        onSave={doSave}
      />
      {discardConfirmOpen && (
        <DiscardConfirmOverlay
          onCancel={() => setDiscardConfirmOpen(false)}
          onDiscard={() => {
            if (state.status === 'ready') {
              draftRef.current = state.file.content;
              setDirty(false);
            }
            setDiscardConfirmOpen(false);
            setEditable(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * In-component confirm rendered when the user clicks "Done" with an
 * unsaved buffer. The native shell can't show `window.confirm` so the
 * dialog lives in the document; Esc / click-outside cancel, Discard
 * commits.
 */
function DiscardConfirmOverlay({
  onCancel,
  onDiscard,
}: {
  onCancel: () => void;
  onDiscard: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        onDiscard();
      }
    };
    document.addEventListener('keydown', onKey);
    // Focus the destructive action so keyboard-only users can confirm
    // with Enter; Esc still cancels. The cancel-side button is the
    // safe default — Tab can move there in one step.
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-discard-confirm-action="discard"]')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, onDiscard]);

  return (
    <div
      className="vellum-file-viewer-page__discard-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="vellum-file-viewer-page__discard-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="vellum-discard-dialog-title"
        aria-describedby="vellum-discard-dialog-body"
      >
        <h3
          id="vellum-discard-dialog-title"
          className="vellum-file-viewer-page__discard-title"
        >
          Discard unsaved edits?
        </h3>
        <p
          id="vellum-discard-dialog-body"
          className="vellum-file-viewer-page__discard-body"
        >
          Returning to read view will replace your local buffer with the
          file on disk. This can&apos;t be undone.
        </p>
        <div className="vellum-file-viewer-page__discard-actions">
          <button
            type="button"
            className="vellum-file-viewer-page__discard-cancel"
            data-discard-confirm-action="cancel"
            onClick={onCancel}
          >
            Keep editing
          </button>
          <button
            type="button"
            className="vellum-file-viewer-page__discard-confirm"
            data-discard-confirm-action="discard"
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
