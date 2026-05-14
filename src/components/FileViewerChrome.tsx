import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { SaveState } from '../pages/FileViewerPage';
import type { Annotation, AnnotationBulkAction } from '../utils/content-types';

export interface FileViewerChromeProps {
  path: string;
  pathId?: string;
  dirty: boolean;
  saveState: SaveState;
  save: (() => Promise<void>) | null;
  /** The "visible" set — anchor-resolved annotations actually rendered
   *  as marks in the prose. Drives `scope: 'visible'` actions (default
   *  for Send / Save-as-fiber). */
  annotations: Annotation[];
  annotationsRef: RefObject<Annotation[]>;
  /** The "stored" set — every annotation persisted on disk for this
   *  path/slug, including zombies whose anchors no longer resolve.
   *  Drives `scope: 'stored'` actions (Clear). Falls back to
   *  `annotations` when omitted, preserving legacy callers. */
  storedAnnotations?: Annotation[];
  storedAnnotationsRef?: RefObject<Annotation[]>;
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
  const [storedAnnotations, setStoredAnnotations] = useState<Annotation[]>([]);
  const storedAnnotationsRef = useRef<Annotation[]>([]);
  storedAnnotationsRef.current = storedAnnotations;

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
    storedAnnotations,
    storedAnnotationsRef,
    setDirty,
    setSaveState,
    handleSaveReady,
    setAnnotations,
    setStoredAnnotations,
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
  storedAnnotations,
  storedAnnotationsRef,
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
  // Stored set defaults to the visible set so legacy callers (chrome
  // hosts that haven't started threading storedAnnotations) keep their
  // existing single-list semantics.
  const storedList = storedAnnotations ?? annotations;

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
        {headerAnnotationActions?.map((action: AnnotationBulkAction) => {
          // 'stored' actions reach into the on-disk set (Clear nukes
          // everything, including zombies whose anchors don't resolve);
          // 'visible' actions only see anchor-resolved marks (Send /
          // Fiber, where operating on an unrendered annotation is
          // nonsense). Each action gates independently on its own
          // applicable count — no outer length gate, so a 'stored'
          // Clear stays reachable when zero anchors resolve but the
          // store still has rows.
          const source = action.scope === 'stored' ? storedList : annotations;
          const applicable = action.applicableTo
            ? source.filter(action.applicableTo)
            : source;
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
                const sourceRef =
                  action.scope === 'stored'
                    ? (storedAnnotationsRef?.current ?? annotationsRef.current ?? [])
                    : (annotationsRef.current ?? []);
                const matched = action.applicableTo
                  ? sourceRef.filter(action.applicableTo)
                  : sourceRef;
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
