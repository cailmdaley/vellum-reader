import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { FileViewerChrome, useFileViewerChromeState } from '~/components/FileViewerChrome';
import { WorkspaceAnatomy } from '~/components/WorkspaceAnatomy';
import { HistoryCard } from '~/components/HistoryCard';
import { readCanvasWidth } from '~/utils/canvas-geometry';
import { useMode, type Mode } from '~/contexts/ModeContext';
import { useTheme } from '~/contexts/ThemeContext';
import { useDelta } from '~/utils/use-delta';
import { FILE_TARGET_ROUTE, useFileTarget, type FileTarget } from '~/contexts/FileTargetContext';
import { useWorkspaceSlot } from '~/contexts/WorkspaceSlotContext';
import { FileViewerPage, isAstraPath, type SaveState } from './FileViewerPage';
import type { Annotation, AstraGraph, FiberContent, HistoryEvent } from '~/utils/content-types';

const MODE_KEYS: Record<string, Mode> = {
  '1': 'narrative',
  '2': 'workspace',
  '3': 'find',
  '4': 'delta',
};

export function FiberPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { mode, setMode } = useMode();
  const { themeId } = useTheme();
  const { eyebrow, onIndexEscalate, onOpenSyntheticNode } = useCollection();
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

  // Synthetic-aware navigate. Slugs starting with `__` are host-emitted
  // gateway nodes for other collections. When the host wired
  // `onOpenSyntheticNode`, route through it so the host can remount on
  // the destination collection and the user gets that destination's full
  // graph + thumb-index. When not wired (vanilla vellum, no synthetic
  // nodes), fall through to ordinary in-mount navigation. Used by
  // FloatingIsland, IndexView, ContextCardLayer, and NarrativeView's
  // wikilink + breadcrumb clicks — every click that picks a node by slug
  // funnels through here.
  const handleNavigateToSlug = useCallback(
    (s: string) => {
      if (s.startsWith('__') && onOpenSyntheticNode) {
        onOpenSyntheticNode(s);
        return;
      }
      navigate(`/${s}`);
    },
    [navigate, onOpenSyntheticNode],
  );
  // Embedding hosts (portolan's kanban-in-vellum, Find-in-vellum) override
  // tab bodies via WorkspaceSlotContext. When a slot is set and the user is
  // on that tab, FiberPage renders the slot in place of the built-in view,
  // suppresses `<WorkspaceAnatomy>` in the Canvas, and adds
  // `vellum-page--workspace-slot` so CSS can hide the canvas body while
  // leaving the adjustable thumb-index reservation in place — same chrome
  // treatment for both workspace and find slots.
  const useWorkspaceSlotRender = !isFileMode && mode === 'workspace' && workspaceSlot.slot !== null;
  const useFindSlotRender = !isFileMode && mode === 'find' && workspaceSlot.findSlot !== null;
  const useTabSlotRender = useWorkspaceSlotRender || useFindSlotRender;
  const [rightRailCollapsed, setRightRailCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('vellum:right-rail-collapsed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('vellum:right-rail-collapsed', rightRailCollapsed ? '1' : '0');
    } catch {
      // Best-effort UI preference only.
    }
  }, [rightRailCollapsed]);
  const showRightRail = themeId !== 'lightcone-linear' && !rightRailCollapsed;

  const fileChrome = useFileViewerChromeState();

  // Force narrative mode while a file is loaded — Workspace and Delta are
  // fiber-collection concepts. The mode buttons are also disabled in
  // FloatingIsland (see useFileTarget there); this is the belt for the
  // suspenders, in case mode was already 2/3 when the file mounted.
  useEffect(() => {
    if (isFileMode && mode !== 'narrative') setMode('narrative');
  }, [isFileMode, mode, setMode]);
  // ── History data — fetched here, shared between the HistoryCard in the
  // Canvas and the ※n count in NarrativeView's FiberHeader. Lifted out of
  // NarrativeView so the card renders inside aside.vellum-canvas (z-index
  // 400) rather than fighting it as a fixed overlay behind it.
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);
  const [historyStatus, setHistoryStatus] = useState<'ok' | 'unavailable'>('ok');
  const [historyReason, setHistoryReason] = useState<'busy' | 'error' | undefined>(undefined);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHistoryEvents([]);
    setHistoryStatus('ok');
    setHistoryReason(undefined);
    setHistoryLoaded(false);
    if (!slug) return;
    adapter.getFiberHistory(slug).then((response) => {
      if (cancelled) return;
      setHistoryEvents(response.events);
      setHistoryStatus(response.status ?? 'ok');
      setHistoryReason(response.reason);
      setHistoryLoaded(true);
    });
    return () => { cancelled = true; };
  }, [adapter, slug]);
  const historyEditorialCount = historyEvents.filter(
    (e) => (e.kind ?? 'editorial') === 'editorial',
  ).length;

  // Canvas width for HistoryCard — rendered inside aside.vellum-canvas
  // which has 16px padding on each side, so subtract 32px (+ 4px slack
  // to match WorkspaceAnatomy). Tracks --canvas-width live so the card
  // reflows when the user drags the divider.
  const [historyCardWidth, setHistoryCardWidth] = useState<number>(() => {
    const cw = readCanvasWidth();
    return cw > 0 ? Math.max(180, cw - 36) : 340;
  });
  useEffect(() => {
    const update = () => {
      const cw = readCanvasWidth();
      setHistoryCardWidth(cw > 0 ? Math.max(180, cw - 36) : 340);
    };
    update();
    window.addEventListener('resize', update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    return () => {
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, []);

  const [content, setContent] = useState<FiberContent | null>(null);
  const [graph, setGraph] = useState<AstraGraph>({ nodes: [], links: [] });
  const [graphLoading, setGraphLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(true);
  const [contentVersion, setContentVersion] = useState(0);
  const [graphVersion, setGraphVersion] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [pendingContentReload, setPendingContentReload] = useState(false);
  const restoreScrollTopRef = useRef<number | null>(null);

  const captureScrollForRefresh = useCallback(() => {
    const scroller = document.scrollingElement ?? document.documentElement;
    restoreScrollTopRef.current = scroller.scrollTop;
  }, []);

  const refreshCurrentFiber = useCallback(() => {
    setGraphVersion((version) => version + 1);

    if (isEditing) {
      setPendingContentReload(true);
      return;
    }

    captureScrollForRefresh();
    setContentVersion((version) => version + 1);
  }, [captureScrollForRefresh, isEditing]);

  const reloadCurrentFiber = useCallback((event: ReloadEvent) => {
    setGraphVersion((version) => version + 1);

    if (event.slug && event.slug !== slug) return;
    if (isEditing) {
      setPendingContentReload(true);
      return;
    }

    captureScrollForRefresh();
    setContentVersion((version) => version + 1);
  }, [captureScrollForRefresh, isEditing, slug]);

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

  useLayoutEffect(() => {
    if (contentLoading || restoreScrollTopRef.current == null) return;
    const top = restoreScrollTopRef.current;
    restoreScrollTopRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top, left: window.scrollX });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [contentLoading, content?.slug]);

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
    if (isFileMode || slug || graphLoading) return;
    const rootSlug = graph.rootSlug;
    if (!rootSlug || !graph.nodes.some((node) => node.slug === rootSlug)) return;
    navigate(`/${rootSlug}`, { replace: true });
  }, [graph.rootSlug, graph.nodes, graphLoading, isFileMode, navigate, slug]);

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
  const currentContent = content?.slug === slug ? content : null;
  const showFiberRefresh = !isFileMode && mode === 'narrative' && !!slug;

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
      className={`vellum-page${mode === 'delta' ? ' vellum-page--delta' : ''}${useTabSlotRender ? ' vellum-page--workspace-slot' : ''}${rightRailCollapsed ? ' vellum-page--right-rail-collapsed' : ''}`}
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
      {showRightRail && (
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
                onNavigate={handleNavigateToSlug}
              />
            ) : mode === 'narrative' && (historyLoaded || historyStatus === 'unavailable') ? (
              <HistoryCard
                events={historyEvents}
                status={historyStatus}
                reason={historyReason}
                width={historyCardWidth}
                onNavigate={handleNavigateToSlug}
              />
            ) : null}
          </Canvas>
        </>
      )}
      {showRightRail && (
        <FloatingIsland
          currentNode={currentNode}
          graphNodes={graph.nodes}
          graphLinks={graph.links}
          backlinkCount={citingBacklinks.length}
          backlinkNodes={citingBacklinks}
          deltaCount={deltaCount}
          onNavigate={handleNavigateToSlug}
          onRefresh={showFiberRefresh ? refreshCurrentFiber : undefined}
          onIndexEscalate={onIndexEscalate}
          onCollapseRightRail={() => setRightRailCollapsed(true)}
        />
      )}
      {rightRailCollapsed && themeId !== 'lightcone-linear' && (
        <button
          type="button"
          className="vellum-right-rail-restore"
          onClick={() => setRightRailCollapsed(false)}
          title="Show side column"
          aria-label="Show side column"
        >
          <span aria-hidden="true">‹</span>
        </button>
      )}

      {isFileMode && fileTarget && (
        <FileModeView
          target={fileTarget}
          cacheBustKey={fileChrome.cacheBustKey}
          annotationRefreshKey={fileChrome.annotationRefreshKey}
          dirty={fileChrome.dirty}
          saveState={fileChrome.saveState}
          save={fileChrome.save}
          annotations={fileChrome.annotations}
          annotationsRef={fileChrome.annotationsRef}
          onDirtyChange={fileChrome.setDirty}
          onSaveStateChange={fileChrome.setSaveState}
          onSaveReady={fileChrome.handleSaveReady}
          onAnnotationsChange={fileChrome.setAnnotations}
          onRefresh={fileChrome.handleRefresh}
          refreshAnnotations={fileChrome.refreshAnnotations}
        />
      )}

      {!isFileMode && mode === 'narrative' && contentLoading && !currentContent && (
        // role="status" + aria-live="polite" so AT users hear the
        // transition without it interrupting their current focus. Without
        // a role the loading text gets absorbed into the outer wrapper's
        // auto-computed accessible name (same pattern that swallowed the
        // 404 message before role="alert" landed above).
        <div className="vellum-loading" role="status" aria-live="polite">
          Loading <em>{slug || 'fiber'}</em>…
        </div>
      )}

      {!isFileMode && mode === 'narrative' && currentContent?.mdast && (
        <NarrativeView
          content={currentContent}
          graphNodes={graph.nodes}
          graphLinks={graph.links}
          breadcrumb={breadcrumb}
          changedIds={changedIds}
          onEditingChange={setIsEditing}
          historyCount={historyEditorialCount}
        />
      )}

      {!isFileMode && mode === 'narrative' && !contentLoading && !slug && (
        <IndexView nodes={graph.nodes} links={graph.links} onNavigate={handleNavigateToSlug} eyebrow={eyebrow} />
      )}

      {!isFileMode && mode === 'narrative' && !contentLoading && slug && !currentContent?.mdast && (
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

      {/* Embedding hosts (portolan's kanban-in-vellum, Find-in-vellum) own
          the tab body when they provide a slot. Render the slot directly —
          the host carries its own loading/error states, so we don't gate on
          graphLoading the way the built-in WorkspaceView does. */}
      {useWorkspaceSlotRender && workspaceSlot.slot}

      {/* Find tab. Default empty state when no slot provided (vellum
          standalone has no Find content of its own — it ships the tab so
          embedding hosts can fill it). When the host provides a findSlot,
          render that. Same hosted chrome treatment as workspaceSlot. */}
      {!isFileMode && mode === 'find' && useFindSlotRender && workspaceSlot.findSlot}
      {!isFileMode && mode === 'find' && !useFindSlotRender && (
        <div className="vellum-loading" role="status" aria-live="polite">
          Find — no surface provided by the embedding host.
        </div>
      )}

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
      {!isFileMode && mode === 'narrative' && <ContextCardLayer onNavigate={handleNavigateToSlug} />}

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
      <FileViewerChrome
        path={target.path}
        dirty={dirty}
        saveState={saveState}
        save={save}
        annotations={annotations}
        annotationsRef={annotationsRef}
        headerAnnotationActions={target.headerAnnotationActions}
        refreshAnnotations={refreshAnnotations}
        onRefresh={onRefresh}
        toolbarClassName="vellum-file-mode__toolbar"
        pathClassName="vellum-file-mode__path"
        actionsClassName="vellum-file-mode__actions"
        extraActions={
          isAstra && astraSourceSupported ? (
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
          ) : null
        }
      />
      <div className="vellum-file-mode__body">
        <FileViewerPage
          key={cacheBustKey}
          path={target.path}
          originId={target.originId}
          cacheBust={cacheBustKey > 0}
          editable={target.editable}
          jumpToLine={target.jumpToLine}
          onNavigateToFile={target.onNavigateToFile}
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
