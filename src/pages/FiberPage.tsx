import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAdapter } from '~/contexts/AdapterContext';
import { ContextCardLayer } from '~/components/ContextCardLayer';
import { DeltaView } from '~/components/DeltaView';
import { FloatingIsland } from '~/components/FloatingIsland';
import { HotReloadListener, type ReloadEvent } from '~/components/HotReloadListener';
import { IndexView } from '~/components/IndexView';
import { useCollection } from '~/contexts/CollectionContext';
import { NarrativeView } from '~/components/NarrativeView';
import { WorkspaceView } from '~/components/WorkspaceView';
import { Canvas } from '~/components/Canvas';
import { CanvasDivider } from '~/components/CanvasDivider';
import { WorkspaceAnatomy } from '~/components/WorkspaceAnatomy';
import { useMode, type Mode } from '~/contexts/ModeContext';
import { useTheme } from '~/contexts/ThemeContext';
import { useDelta } from '~/utils/use-delta';
import { FILE_TARGET_ROUTE, useFileTarget, type FileTarget } from '~/contexts/FileTargetContext';
import { useWorkspaceSlot } from '~/contexts/WorkspaceSlotContext';
import { FileViewerPage, isAstraPath, type SaveState } from './FileViewerPage';
import type { Annotation, AnnotationBulkAction, AstraGraph, FiberContent } from '~/utils/content-types';

const MODE_KEYS: Record<string, Mode> = {
  '1': 'narrative',
  '2': 'workspace',
  '3': 'delta',
};

function saveStatusText(s: SaveState): string {
  if (s === 'saving') return 'Saving…';
  if (s === 'saved') return 'Saved';
  if (typeof s === 'object') return `Error: ${s.error}`;
  return '';
}

export function FiberPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { mode, setMode } = useMode();
  const { themeId } = useTheme();
  const { eyebrow } = useCollection();
  const adapter = useAdapter();
  const { deltaEvents, changedIds, since, dismissFiber, refresh: refreshDelta } = useDelta();
  const fileTarget = useFileTarget();
  const workspaceSlot = useWorkspaceSlot();
  // File mode: the workspace was opened with `initialFilePath` and the URL
  // is parked at the FILE_TARGET_ROUTE marker. Once the user navigates to a
  // slug (wikilink, search, ↑ to the index), pathname changes and the
  // workspace reverts to fiber mode for the rest of this mount's life.
  const isFileMode = location.pathname === FILE_TARGET_ROUTE && !!fileTarget;
  const slug = isFileMode ? '' : location.pathname.replace(/^\/+|\/+$/g, '');
  // Embedding hosts (portolan's kanban-in-vellum) override the Workspace tab
  // body via WorkspaceSlotContext. When the slot is set and the user is on
  // the Workspace tab, FiberPage renders the slot in place of
  // `<WorkspaceView>`, suppresses `<WorkspaceAnatomy>` in the Canvas, and
  // adds `vellum-page--workspace-slot` so CSS can drop --canvas-width to 0
  // (mirroring the delta-mode treatment).
  const useWorkspaceSlotRender = !isFileMode && mode === 'workspace' && workspaceSlot.slot !== null;

  // File-mode toolbar state — same lift pattern FileViewerModal uses, just
  // surfaced inside the workspace shell instead of a free-standing modal.
  const [fileCacheBustKey, setFileCacheBustKey] = useState(0);
  const [fileAnnotationRefreshKey, setFileAnnotationRefreshKey] = useState(0);
  const [fileDirty, setFileDirty] = useState(false);
  const [fileSaveState, setFileSaveState] = useState<SaveState>('idle');
  const [fileSave, setFileSave] = useState<(() => Promise<void>) | null>(null);
  const [fileAnnotations, setFileAnnotations] = useState<Annotation[]>([]);
  const fileAnnotationsRef = useRef<Annotation[]>([]);
  fileAnnotationsRef.current = fileAnnotations;
  const handleFileRefresh = useCallback(() => {
    setFileCacheBustKey((n) => n + 1);
  }, []);
  const refreshFileAnnotations = useCallback(() => {
    setFileAnnotationRefreshKey((n) => n + 1);
  }, []);
  const handleFileSaveReady = useCallback((fn: (() => Promise<void>) | null) => {
    setFileSave(() => fn);
  }, []);

  // Force narrative mode while a file is loaded — Workspace and Delta are
  // fiber-collection concepts. The mode buttons are also disabled in
  // FloatingIsland (see useFileTarget there); this is the belt for the
  // suspenders, in case mode was already 2/3 when the file mounted.
  useEffect(() => {
    if (isFileMode && mode !== 'narrative') setMode('narrative');
  }, [isFileMode, mode, setMode]);
  const [content, setContent] = useState<FiberContent | null>(null);
  const [graph, setGraph] = useState<AstraGraph>({ nodes: [], links: [] });
  const [graphLoading, setGraphLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(true);
  const [contentVersion, setContentVersion] = useState(0);
  const [graphVersion, setGraphVersion] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [pendingContentReload, setPendingContentReload] = useState(false);

  const reloadCurrentFiber = useCallback((event: ReloadEvent) => {
    setGraphVersion((version) => version + 1);

    if (event.slug && event.slug !== slug) return;
    if (isEditing) {
      setPendingContentReload(true);
      return;
    }

    setContentVersion((version) => version + 1);
  }, [isEditing, slug]);

  useEffect(() => {
    let cancelled = false;
    setContentLoading(true);

    (slug ? adapter.getFiberContent(slug) : Promise.resolve(null)).then((nextContent) => {
      if (cancelled) return;
      setContent(nextContent);
      setContentLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [adapter, slug, contentVersion]);

  useEffect(() => {
    let cancelled = false;
    setGraphLoading(true);

    adapter.getAstraGraph().then((nextGraph) => {
      if (cancelled) return;
      setGraph(nextGraph);
      setGraphLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [adapter, graphVersion]);

  useEffect(() => {
    if (isEditing || !pendingContentReload) return;
    setPendingContentReload(false);
    setContentVersion((version) => version + 1);
  }, [isEditing, pendingContentReload]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;

      if (e.key === 'Escape') {
        const active = document.activeElement as HTMLElement | null;
        if (active?.tagName === 'INPUT') active.blur();
        return;
      }
      if (isEditing) return;

      if (e.key === '/') {
        e.preventDefault();
        // Expand search in the thumb index then focus
        const btn = document.querySelector<HTMLButtonElement>('.thumb-index__search-btn');
        if (btn) btn.click();
        else document.querySelector<HTMLInputElement>('.thumb-index__search-input')?.focus();
        return;
      }

      const nextMode = MODE_KEYS[e.key];
      if (nextMode) {
        // File mode locks out Workspace + Delta (no fiber graph context to
        // populate them); only `1` (narrative) is meaningful, and that's
        // already where we are.
        if (isFileMode && nextMode !== 'narrative') return;
        setMode(nextMode);
        return;
      }

      if (e.key === '[') {
        navigate(-1);
        return;
      }

      if (e.key === ']') {
        navigate(1);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigate, setMode, isFileMode]);

  const breadcrumb = useMemo(() => {
    const parts = slug.split('/').filter(Boolean);
    if (parts.length <= 1) return [];
    return parts.slice(0, -1).map((part, i) => ({
      label: part,
      slug: parts.slice(0, i + 1).join('/'),
    }));
  }, [slug]);

  const deltaCount = useMemo(() => new Set(deltaEvents.map((event) => event.fiberId)).size, [deltaEvents]);

  const currentNode = useMemo(
    () => graph.nodes.find((n) => n.slug === slug),
    [graph.nodes, slug],
  );

  // Workspace: the right-side anatomy is driven by this selection, not the
  // URL slug. Clicking a row in WorkspaceView's list picks which fiber is
  // decomposed into cards on the right, without navigating away. The default
  // is whatever fiber the URL points at.
  const [anatomySlug, setAnatomySlug] = useState<string | null>(null);
  useEffect(() => {
    setAnatomySlug(slug || null);
  }, [slug]);

  // Carry the Workspace anatomy selection across mode switches: leaving
  // Workspace, if the user picked a different fiber in the right panel than
  // the URL points at, promote that selection to the URL so Narrative
  // focuses on it too.
  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current === 'workspace' && mode !== 'workspace' && anatomySlug && anatomySlug !== slug) {
      navigate(`/${anatomySlug}`);
    }
    prevMode.current = mode;
  }, [mode, anatomySlug, slug, navigate]);
  const anatomyNode = useMemo(
    () => graph.nodes.find((n) => n.slug === (anatomySlug ?? slug)),
    [graph.nodes, anatomySlug, slug],
  );

  const citingBacklinks = useMemo(() => {
    if (!currentNode || !graph.links) return [];
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    return graph.links
      .filter((l) => l.kind !== 'contains' && l.target === currentNode.id)
      .map((l) => nodeById.get(l.source))
      .filter((n): n is import('~/utils/content-types').GraphNode => !!n);
  }, [currentNode, graph.links, graph.nodes]);

  return (
    <div
      className={`vellum-page${mode === 'delta' ? ' vellum-page--delta' : ''}${useWorkspaceSlotRender ? ' vellum-page--workspace-slot' : ''}`}
      role="region"
      aria-label={currentNode ? `Vellum — ${currentNode.label}` : 'Vellum'}
    >
      <HotReloadListener onReload={reloadCurrentFiber} />
      {/* Canvas + drag rail are presentation chrome for the margin/personal
          themes. Under lightcone-linear the whole right-side reservation
          goes away — the theme centers a single prose column — so we don't
          mount the components at all. Keeping them mounted was reserving
          ~420px of viewport via --canvas-width and leaving the prose
          stranded in the left half. */}
      {themeId !== 'lightcone-linear' && (
        <>
          <CanvasDivider />
          {/* The right side of every tab. The draggable divider and this aside
              are always on screen, but what fills the aside is decided by the
              active tab: Narrative leaves it empty for now, and Workspace shows
              the selected fiber's decomposition (decisions, findings, inputs,
              outputs) as a column of cards. */}
          <Canvas>
            {mode === 'workspace' && anatomyNode && !useWorkspaceSlotRender ? (
              <WorkspaceAnatomy
                node={anatomyNode}
                onNavigate={(s) => navigate(`/${s}`)}
              />
            ) : null}
          </Canvas>
        </>
      )}
      <FloatingIsland
        currentNode={currentNode}
        graphNodes={graph.nodes}
        graphLinks={graph.links}
        backlinkCount={citingBacklinks.length}
        backlinkNodes={citingBacklinks}
        deltaCount={deltaCount}
        onNavigate={(s) => navigate(`/${s}`)}
      />

      {isFileMode && fileTarget && (
        <FileModeView
          target={fileTarget}
          cacheBustKey={fileCacheBustKey}
          annotationRefreshKey={fileAnnotationRefreshKey}
          dirty={fileDirty}
          saveState={fileSaveState}
          save={fileSave}
          annotations={fileAnnotations}
          annotationsRef={fileAnnotationsRef}
          onDirtyChange={setFileDirty}
          onSaveStateChange={setFileSaveState}
          onSaveReady={handleFileSaveReady}
          onAnnotationsChange={setFileAnnotations}
          onRefresh={handleFileRefresh}
          refreshAnnotations={refreshFileAnnotations}
        />
      )}

      {!isFileMode && mode === 'narrative' && contentLoading && (
        // role="status" + aria-live="polite" so AT users hear the
        // transition without it interrupting their current focus. Without
        // a role the loading text gets absorbed into the outer wrapper's
        // auto-computed accessible name (same pattern that swallowed the
        // 404 message before role="alert" landed above).
        <div className="vellum-loading" role="status" aria-live="polite">
          Loading <em>{slug || 'fiber'}</em>…
        </div>
      )}

      {!isFileMode && mode === 'narrative' && !contentLoading && content?.mdast && (
        <NarrativeView
          content={content}
          graphNodes={graph.nodes}
          graphLinks={graph.links}
          breadcrumb={breadcrumb}
          changedIds={changedIds}
          onEditingChange={setIsEditing}
        />
      )}

      {!isFileMode && mode === 'narrative' && !contentLoading && !slug && (
        <IndexView nodes={graph.nodes} links={graph.links} onNavigate={(s) => navigate(`/${s}`)} eyebrow={eyebrow} />
      )}

      {!isFileMode && mode === 'narrative' && !contentLoading && slug && !content?.mdast && (
        // role="alert" so AT announces the miss instead of leaving the
        // user on a near-empty page with no signal — without it the only
        // a11y-tree node carrying the error text was the outer page
        // wrapper, and the message got swallowed into the chrome's
        // auto-computed accessible name (verified in agent-browser snapshot
        // for the 404 route, where the e1 generic absorbed "Fiber X not
        // found in this collection." with no landmark of its own).
        <div className="vellum-error" role="alert">
          Fiber <em>{slug}</em> not found in this collection.
        </div>
      )}

      {/* Embedding hosts (portolan's kanban-in-vellum) own the workspace tab
          body when they provide a slot. Render the slot directly — the host
          carries its own loading/error states, so we don't gate on
          graphLoading the way the built-in WorkspaceView does. */}
      {useWorkspaceSlotRender && workspaceSlot.slot}

      {/* Workspace consumes the AstraGraph. While it's still loading,
          WorkspaceView's `nodeBySlug.get(currentSlug)` lookup misses and
          the view renders "Fiber X not found" — a transient flash that
          looks like a real error. Show a loading indicator until the graph
          lands; the "not found" branch then signals a genuine miss. */}
      {!isFileMode && mode === 'workspace' && !useWorkspaceSlotRender && graphLoading && (
        <div className="vellum-loading" role="status" aria-live="polite">
          Loading <em>{slug || 'workspace'}</em>…
        </div>
      )}

      {!isFileMode && mode === 'workspace' && !useWorkspaceSlotRender && !graphLoading && (
        <WorkspaceView
          nodes={graph.nodes}
          links={graph.links}
          currentSlug={slug}
          selectedSlug={anatomySlug ?? slug}
          onSelect={setAnatomySlug}
          onOpenInNarrative={(s) => {
            navigate(`/${s}`);
            setMode('narrative');
          }}
          changedIds={changedIds}
        />
      )}

      {/* Pinned cards are a Narrative-only affordance — they're anchored
          to prose line-y coordinates that don't exist in other modes, so
          rendering them on Delta/Workspace looks like ghost UI. */}
      {!isFileMode && mode === 'narrative' && <ContextCardLayer onNavigate={(s) => navigate(`/${s}`)} />}

      {!isFileMode && mode === 'delta' && (
        <DeltaView
          events={deltaEvents}
          since={since}
          onDismissFiber={dismissFiber}
          onRefresh={refreshDelta}
        />
      )}
    </div>
  );
}

/**
 * FileModeView — workspace's file-mode rendering. Mirrors FileViewerModal's
 * lift pattern (path · dirty · status · bulk-actions · Save · ↻ at the top;
 * FileViewerPage inside with `hideToolbar`) but lives inside the workspace
 * shell instead of a free-standing modal scrim. The host modal supplies the
 * close button.
 */
interface FileModeViewProps {
  target: FileTarget;
  cacheBustKey: number;
  annotationRefreshKey: number;
  dirty: boolean;
  saveState: SaveState;
  save: (() => Promise<void>) | null;
  annotations: Annotation[];
  annotationsRef: { current: Annotation[] };
  onDirtyChange: (dirty: boolean) => void;
  onSaveStateChange: (state: SaveState) => void;
  onSaveReady: (fn: (() => Promise<void>) | null) => void;
  onAnnotationsChange: (annotations: Annotation[]) => void;
  onRefresh: () => void;
  refreshAnnotations: () => void;
}

function FileModeView({
  target,
  cacheBustKey,
  annotationRefreshKey,
  dirty,
  saveState,
  save,
  annotations,
  annotationsRef,
  onDirtyChange,
  onSaveStateChange,
  onSaveReady,
  onAnnotationsChange,
  onRefresh,
  refreshAnnotations,
}: FileModeViewProps) {
  const canSave = !!save && dirty && saveState !== 'saving';
  const statusText = saveStatusText(saveState);
  // Astra-only chrome: the source toggle. The picker (paper-view / linear /
  // personal) lives inline as content inside AstraFilePanel — content, not
  // chrome — but the source toggle structurally owns the body (replaces the
  // rendered prose with raw YAML), which is chrome behavior. Lift state up
  // so the toggle lives in this file-mode toolbar; AstraFilePanel becomes
  // controlled. Modal-only by intent: card mounts route through
  // mountVellumFileSurface, which never lifts state, so cards stay
  // toggle-free per `vellum-reader/vellum-native-astra-renderer`.
  const isAstra = isAstraPath(target.path);
  const [astraRenderMode, setAstraRenderMode] = useState<'rendered' | 'source'>('rendered');
  // Reset to rendered when the file path changes — opening a different
  // astra.yaml shouldn't inherit the previous file's source-mode state.
  useEffect(() => {
    setAstraRenderMode('rendered');
  }, [target.path]);
  // The toggle hides until AstraFilePanel reports the adapter exposes
  // raw-text source. Default `false`: static deploys without
  // getAstraSource never grow a toggle.
  const [astraSourceSupported, setAstraSourceSupported] = useState(false);
  return (
    <div className="vellum-file-mode">
      <header className="vellum-file-mode__toolbar">
        <span className="vellum-file-mode__path" title={target.path}>
          {target.path}
          {dirty && <span className="vellum-file-viewer-page__dirty" aria-hidden="true"> •</span>}
        </span>
        {statusText && (
          <span className="vellum-file-viewer-page__status">{statusText}</span>
        )}
        <div className="vellum-file-mode__actions">
          {annotations.length > 0 && target.headerAnnotationActions?.map((action: AnnotationBulkAction) => {
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
          {isAstra && astraSourceSupported && (
            <button
              type="button"
              className={`vellum-modal-btn vellum-file-viewer-page__source-toggle${
                astraRenderMode === 'source' ? ' vellum-file-viewer-page__source-toggle--on' : ''
              }`}
              aria-pressed={astraRenderMode === 'source'}
              onClick={() =>
                setAstraRenderMode((m) => (m === 'source' ? 'rendered' : 'source'))
              }
              title="Toggle YAML source view"
              aria-label="Toggle YAML source view"
            >
              source
            </button>
          )}
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
        </div>
      </header>
      <div className="vellum-file-mode__body">
        <FileViewerPage
          key={cacheBustKey}
          path={target.path}
          originId={target.originId}
          cacheBust={cacheBustKey > 0}
          editable={target.editable}
          jumpToLine={target.jumpToLine}
          annotationActions={target.annotationActions}
          hideToolbar
          astraRenderMode={isAstra ? astraRenderMode : undefined}
          onAstraRenderModeChange={isAstra ? setAstraRenderMode : undefined}
          onAstraSourceSupportChange={isAstra ? setAstraSourceSupported : undefined}
          onDirtyChange={onDirtyChange}
          onSaveStateChange={onSaveStateChange}
          onSaveReady={onSaveReady}
          onAnnotationsChange={onAnnotationsChange}
          annotationRefreshKey={annotationRefreshKey}
        />
      </div>
    </div>
  );
}
