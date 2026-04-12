import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getAstraGraph, getFiberContent } from '~/api';
import { DeltaView } from '~/components/DeltaView';
import { FloatingIsland } from '~/components/FloatingIsland';
import { HotReloadListener, type ReloadEvent } from '~/components/HotReloadListener';
import { IndexView } from '~/components/IndexView';
import { MapView } from '~/components/MapView';
import { NarrativeView } from '~/components/NarrativeView';
import { WorkspaceView } from '~/components/WorkspaceView';
import { Canvas } from '~/components/Canvas';
import { CanvasDivider } from '~/components/CanvasDivider';
import { WorkspaceAnatomy } from '~/components/WorkspaceAnatomy';
import { useMode, type Mode } from '~/contexts/ModeContext';
import { useDelta } from '~/utils/use-delta';
import type { AstraGraph, FiberContent } from '~/utils/content-types';

const MODE_KEYS: Record<string, Mode> = {
  '1': 'narrative',
  '2': 'workspace',
  '3': 'map',
  '4': 'delta',
};

export function FiberPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { mode, setMode } = useMode();
  const { deltaEvents, changedIds, since, acknowledge } = useDelta();
  const slug = location.pathname.replace(/^\/+|\/+$/g, '');
  const [content, setContent] = useState<FiberContent | null>(null);
  const [graph, setGraph] = useState<AstraGraph>({ nodes: [], links: [] });
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

    (slug ? getFiberContent(slug) : Promise.resolve(null)).then((nextContent) => {
      if (cancelled) return;
      setContent(nextContent);
      setContentLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [slug, contentVersion]);

  useEffect(() => {
    let cancelled = false;

    getAstraGraph().then((nextGraph) => {
      if (cancelled) return;
      setGraph(nextGraph);
    });

    return () => {
      cancelled = true;
    };
  }, [graphVersion]);

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
  }, [navigate, setMode]);

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
    <div className="vellum-page">
      <HotReloadListener onReload={reloadCurrentFiber} />
      <CanvasDivider />
      {/* The right side of every tab. The draggable divider and this aside
          are always on screen, but what fills the aside is decided by the
          active tab: Narrative leaves it empty for now, Workspace will show
          the selected fiber's decomposition (decisions, findings, inputs,
          outputs) as a column of cards, and Map is not built yet. */}
      <Canvas>
        {mode === 'workspace' && anatomyNode ? (
          <WorkspaceAnatomy
            node={anatomyNode}
            onNavigate={(s) => navigate(`/${s}`)}
          />
        ) : null}
      </Canvas>
      <FloatingIsland
        currentNode={currentNode}
        graphNodes={graph.nodes}
        graphLinks={graph.links}
        backlinkCount={citingBacklinks.length}
        backlinkNodes={citingBacklinks}
        deltaCount={deltaCount}
        onNavigate={(s) => navigate(`/${s}`)}
      />

      {mode === 'narrative' && contentLoading && (
        <div className="vellum-loading">Loading <em>{slug || 'fiber'}</em>…</div>
      )}

      {mode === 'narrative' && !contentLoading && content?.mdast && (
        <NarrativeView
          content={content}
          graphNodes={graph.nodes}
          graphLinks={graph.links}
          breadcrumb={breadcrumb}
          changedIds={changedIds}
          onEditingChange={setIsEditing}
        />
      )}

      {mode === 'narrative' && !contentLoading && !slug && (
        <IndexView nodes={graph.nodes} links={graph.links} onNavigate={(s) => navigate(`/${s}`)} />
      )}

      {mode === 'narrative' && !contentLoading && slug && !content?.mdast && (
        <div className="vellum-error">
          Fiber <em>{slug}</em> not found. Is mystra running on port 3100?
        </div>
      )}

      {mode === 'workspace' && (
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

      {mode === 'map' && (
        <MapView
          nodes={graph.nodes}
          links={graph.links}
          currentSlug={slug}
          changedIds={changedIds}
        />
      )}

      {mode === 'delta' && (
        <DeltaView
          events={deltaEvents}
          since={since}
          onAcknowledge={acknowledge}
        />
      )}
    </div>
  );
}
