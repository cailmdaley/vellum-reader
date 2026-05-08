/**
 * FileViewerModal — vellum's portable modal shell around FileViewerPage.
 *
 * Single top bar: path + dirty dot + save status + Save + refresh + close.
 * The inner FileViewerPage is told `hideToolbar`; its dirty/save state is
 * lifted to this modal via callbacks, so there is only one bar.
 */

import { useEffect } from 'react';
import { FileViewerPage } from '../pages/FileViewerPage';
import type { AnnotationAction, AnnotationBulkAction } from '../utils/content-types';
import { FileViewerChrome, useFileViewerChromeState } from './FileViewerChrome';

export interface FileViewerModalProps {
  path: string;
  originId?: string;
  collectionId?: string;
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

export function FileViewerModal({
  path,
  originId,
  editable,
  jumpToLine,
  annotationActions,
  headerAnnotationActions,
  onClose,
}: FileViewerModalProps) {
  const {
    cacheBustKey,
    annotationRefreshKey,
    dirty,
    saveState,
    save,
    annotations,
    annotationsRef,
    setDirty,
    setSaveState,
    handleSaveReady,
    setAnnotations,
    handleRefresh,
    refreshAnnotations,
  } = useFileViewerChromeState();

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
        <FileViewerChrome
          path={path}
          pathId="vellum-file-modal-path"
          dirty={dirty}
          saveState={saveState}
          save={save}
          annotations={annotations}
          annotationsRef={annotationsRef}
          headerAnnotationActions={headerAnnotationActions}
          refreshAnnotations={refreshAnnotations}
          onRefresh={handleRefresh}
          onClose={onClose}
          toolbarClassName="vellum-modal-header"
          pathClassName="vellum-modal-path"
          actionsClassName="vellum-modal-actions"
        />
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
