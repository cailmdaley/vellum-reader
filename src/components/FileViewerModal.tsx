/**
 * FileViewerModal — vellum's portable modal shell around FileViewerPage.
 *
 * The host mounts this inside a full-viewport container (e.g. a React root
 * attached to a <div> appended to document.body). The modal covers the
 * viewport with a scrim, renders a titled inner panel, and exposes:
 *
 *   - Close (× button, click on the scrim backdrop, Escape key)
 *   - Refresh (↻ button — re-fetches the file via a cacheBust token)
 *   - Path label in the header
 *
 * This is deliberately minimal. The host still owns *when* to mount/unmount
 * and any cross-cutting integration (hash routing, annotations UI, fiber
 * context sidebar). Those will arrive in follow-ups as the portolan
 * FileViewerModal absorption progresses.
 */

import { useCallback, useEffect, useState } from 'react';
import { FileViewerPage } from '../pages/FileViewerPage';
import type { AnnotationAction } from '../utils/content-types';

export interface FileViewerModalProps {
  path: string;
  originId?: string;
  cityId?: string;
  editable?: boolean;
  /** 1-indexed line to jump to when the file opens. */
  jumpToLine?: number;
  /** Host-defined actions on each annotation; forwarded to FileViewerPage. */
  annotationActions?: AnnotationAction[];
  /** Fires when the user dismisses the modal (× / Esc / scrim click). */
  onClose: () => void;
}

export function FileViewerModal({
  path,
  originId,
  editable,
  jumpToLine,
  annotationActions,
  onClose,
}: FileViewerModalProps) {
  const [cacheBustKey, setCacheBustKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setCacheBustKey((n) => n + 1);
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
          </span>
          <div className="vellum-modal-actions">
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
          />
        </div>
      </div>
    </div>
  );
}
