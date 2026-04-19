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
}

type FetchState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; file: FileContent };

export type SaveState = 'idle' | 'saving' | 'saved' | { error: string };

export function FileViewerPage({
  path,
  originId,
  cacheBust,
  editable,
  jumpToLine,
  annotationActions,
  hideToolbar,
  onDirtyChange,
  onSaveStateChange,
  onSaveReady,
}: FileViewerPageProps) {
  const adapter = useAdapter();
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const draftRef = useRef<string>('');
  const savedToastRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setDirty(false);
    setSaveState('idle');
    setAnnotations([]);
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
  useEffect(() => {
    let cancelled = false;
    adapter
      .getAnnotations(path, { kind: 'text' })
      .then((rows) => {
        if (cancelled) return;
        setAnnotations(rows.filter((a) => typeof a.from === 'number' && typeof a.to === 'number'));
      })
      .catch(() => {
        if (cancelled) return;
        setAnnotations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, path, cacheBust]);

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

  const showToolbar =
    !hideToolbar && editable &&
    (state.file.kind === 'text' || state.file.kind === 'markdown');

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
          <button
            type="button"
            className="vellum-file-viewer-page__save"
            onClick={doSave}
            disabled={!dirty || saveState === 'saving'}
          >
            Save
          </button>
        </div>
      )}
      <FileReader
        file={state.file}
        editable={editable}
        jumpToLine={jumpToLine}
        annotations={annotations}
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
    </div>
  );
}
