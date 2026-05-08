import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { SaveState } from '../pages/FileViewerPage';
import type { Annotation, AnnotationBulkAction } from '../utils/content-types';

export interface FileViewerChromeProps {
  path: string;
  pathId?: string;
  dirty: boolean;
  saveState: SaveState;
  save: (() => Promise<void>) | null;
  annotations: Annotation[];
  annotationsRef: RefObject<Annotation[]>;
  headerAnnotationActions?: AnnotationBulkAction[];
  refreshAnnotations: () => void;
  onRefresh: () => void;
  onClose?: () => void;
  extraActions?: ReactNode;
  toolbarClassName: string;
  pathClassName: string;
  actionsClassName: string;
}

export function useFileViewerChromeState() {
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

  return {
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
  };
}

export function saveStatusText(s: SaveState): string {
  if (s === 'saving') return 'Saving…';
  if (s === 'saved') return 'Saved';
  if (typeof s === 'object') return `Error: ${s.error}`;
  return '';
}

export function FileViewerChrome({
  path,
  pathId,
  dirty,
  saveState,
  save,
  annotations,
  annotationsRef,
  headerAnnotationActions,
  refreshAnnotations,
  onRefresh,
  onClose,
  extraActions,
  toolbarClassName,
  pathClassName,
  actionsClassName,
}: FileViewerChromeProps) {
  const canSave = !!save && dirty && saveState !== 'saving';
  const statusText = saveStatusText(saveState);

  return (
    <header className={toolbarClassName}>
      <span className={pathClassName} id={pathId} title={path}>
        {path}
        {dirty && <span className="vellum-file-viewer-page__dirty" aria-hidden="true"> •</span>}
      </span>
      {statusText && (
        <span className="vellum-file-viewer-page__status">{statusText}</span>
      )}
      <div className={actionsClassName}>
        {annotations.length > 0 && headerAnnotationActions?.map((action: AnnotationBulkAction) => {
          const applicable = action.applicableTo
            ? annotations.filter(action.applicableTo)
            : annotations;
          if (applicable.length === 0) return null;
          return (
            <button
              key={action.id}
              type="button"
              className={
                'vellum-modal-btn vellum-modal-btn--bulk' +
                (action.destructive ? ' vellum-modal-btn--destructive' : '')
              }
              title={action.title ?? action.label}
              aria-label={`${action.label}, ${applicable.length} ${
                applicable.length === 1 ? 'annotation' : 'annotations'
              }`}
              onClick={(e) => {
                const current = annotationsRef.current ?? [];
                const matched = action.applicableTo
                  ? current.filter(action.applicableTo)
                  : current;
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
        {extraActions}
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
          onClick={onRefresh}
          title="Refresh"
          aria-label="Refresh"
        >
          ↻
        </button>
        {onClose && (
          <button
            type="button"
            className="vellum-modal-btn vellum-modal-close"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
    </header>
  );
}
