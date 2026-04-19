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
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [save, setSave] = useState<(() => Promise<void>) | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const annotationsRef = useRef<Annotation[]>([]);
  annotationsRef.current = annotations;

  const handleRefresh = useCallback(() => {
    setCacheBustKey((n) => n + 1);
  }, []);

  const handleSaveReady = useCallback((fn: (() => Promise<void>) | null) => {
    setSave(() => fn);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const canSave = !!save && dirty && saveState !== 'saving';
  const statusText = saveStatusText(saveState);

  return (
    <div
      className="vellum-modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="vellum-modal-shell" role="dialog" aria-modal="true">
        <header className="vellum-modal-header">
          <span className="vellum-modal-path" title={path}>
            {path}
            {dirty && <span className="vellum-file-viewer-page__dirty" aria-hidden="true"> •</span>}
          </span>
          {statusText && (
            <span className="vellum-file-viewer-page__status">{statusText}</span>
          )}
          <div className="vellum-modal-actions">
            {annotations.length > 0 && headerAnnotationActions?.map((action) => (
              <button
                key={action.id}
                type="button"
                className="vellum-modal-btn vellum-modal-btn--bulk"
                title={action.title ?? action.label}
                onClick={(e) => {
                  void action.onInvoke(annotationsRef.current, {
                    anchor: e.currentTarget as HTMLElement,
                  });
                }}
              >
                {action.label}
                <span className="vellum-modal-btn__count">{annotations.length}</span>
              </button>
            ))}
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
          />
        </div>
      </div>
    </div>
  );
}
