/**
 * FileViewerModal — vellum's portable modal shell around FileViewerPage.
 *
 * Single top bar: path + dirty dot + save status + Save + refresh + close.
 * The inner FileViewerPage is told `hideToolbar`; its dirty/save state is
 * lifted to this modal via callbacks, so there is only one bar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileViewerPage, type SaveState } from '../pages/FileViewerPage';
import type { Annotation, AnnotationAction, AnnotationBulkAction } from '../utils/content-types';

export interface FileViewerModalProps {
  path: string;
  originId?: string;
  cityId?: string;
  editable?: boolean;
  /** 1-indexed line to jump to when the file opens. */
  jumpToLine?: number;
  /** Host-defined actions on each annotation; forwarded to FileViewerPage. */
  annotationActions?: AnnotationAction[];
  /** Host-defined bulk actions shown in the modal header when ≥1 annotation
   * is present. Receive the current annotation list plus the anchor element. */
  headerAnnotationActions?: AnnotationBulkAction[];
  /** Fires when the user dismisses the modal (× / Esc / scrim click). */
  onClose: () => void;
}

function saveStatusText(s: SaveState): string {
  if (s === 'saving') return 'Saving…';
  if (s === 'saved') return 'Saved';
  if (typeof s === 'object') return `Error: ${s.error}`;
  return '';
}

export function FileViewerModal({
  path,
  originId,
  editable,
  jumpToLine,
  annotationActions,
  headerAnnotationActions,
  onClose,
}: FileViewerModalProps) {
  const [cacheBustKey, setCacheBustKey] = useState(0);
  const [annotationRefreshKey, setAnnotationRefreshKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [save, setSave] = useState<(() => Promise<void>) | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const annotationsRef = useRef<Annotation[]>([]);
  annotationsRef.current = annotations;

  const handleRefresh = useCallback(() => {
    setCacheBustKey((n) => n + 1);
  }, []);

  const refreshAnnotations = useCallback(() => {
    setAnnotationRefreshKey((n) => n + 1);
  }, []);

  const handleSaveReady = useCallback((fn: (() => Promise<void>) | null) => {
    setSave(() => fn);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't swallow Escape while focus is inside a CodeMirror editor —
      // vim needs it to exit insert mode, finish search, cancel completion,
      // etc. Click-outside and the X button still close the modal.
      const target = e.target;
      if (target instanceof Element && target.closest('.cm-editor')) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const canSave = !!save && dirty && saveState !== 'saving';
  const statusText = saveStatusText(saveState);

  return (
    <div
      className="vellum-modal-scrim"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="vellum-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vellum-file-modal-path"
      >
        <header className="vellum-modal-header">
          <span className="vellum-modal-path" id="vellum-file-modal-path" title={path}>
            {path}
            {dirty && <span className="vellum-file-viewer-page__dirty" aria-hidden="true"> •</span>}
          </span>
          {statusText && (
            <span className="vellum-file-viewer-page__status">{statusText}</span>
          )}
          <div className="vellum-modal-actions">
            {annotations.length > 0 && headerAnnotationActions?.map((action) => {
              // `applicableTo` prefilters: the button renders only when at
              // least one annotation matches, and `onInvoke` receives just
              // the matching subset. Without filtering, hosts (e.g.
              // portolan's "Clear sent") would receive every annotation
              // and act on annotations the user did not target.
              const applicable = action.applicableTo
                ? annotations.filter(action.applicableTo)
                : annotations;
              if (applicable.length === 0) return null;
              return (
                <button
                  key={action.id}
                  type="button"
                  className="vellum-modal-btn vellum-modal-btn--bulk"
                  title={action.title ?? action.label}
                  aria-label={`${action.label}, ${applicable.length} ${
                    applicable.length === 1 ? 'annotation' : 'annotations'
                  }`}
                  onClick={(e) => {
                    const matched = action.applicableTo
                      ? annotationsRef.current.filter(action.applicableTo)
                      : annotationsRef.current;
                    // Pass `refreshAnnotations` (annotation-only refetch)
                    // not `handleRefresh` (full file reload) so a bulk
                    // mutation can re-read annotations without losing
                    // editor state — cursor, scroll, search, vim mode.
                    void action.onInvoke(matched, {
                      anchor: e.currentTarget as HTMLElement,
                      refreshAnnotations,
                    });
                  }}
                >
                  {action.label}
                  <span className="vellum-modal-btn__count" aria-hidden="true">{applicable.length}</span>
                </button>
              );
            })}
            {save && (
              <button
                type="button"
                className="vellum-file-viewer-page__save"
                onClick={() => { void save(); }}
                disabled={!canSave}
              >
                Save
              </button>
            )}
            <button
              type="button"
              className="vellum-modal-btn"
              onClick={handleRefresh}
              title="Refresh"
              aria-label="Refresh"
            >
              ↻
            </button>
            <button
              type="button"
              className="vellum-modal-btn vellum-modal-close"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </header>
        <div className="vellum-modal-body">
          <FileViewerPage
            key={cacheBustKey}
            path={path}
            originId={originId}
            cacheBust={cacheBustKey > 0}
            editable={editable}
            jumpToLine={jumpToLine}
            annotationActions={annotationActions}
            hideToolbar
            onDirtyChange={setDirty}
            onSaveStateChange={setSaveState}
            onSaveReady={handleSaveReady}
            onAnnotationsChange={setAnnotations}
            annotationRefreshKey={annotationRefreshKey}
          />
        </div>
      </div>
    </div>
  );
}
