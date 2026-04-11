/**
 * Splat route — catches all content URLs.
 *
 * URL slug maps directly to the MySTRA content server slug:
 *   /vellum-reader         → /content/vellum-reader.json
 *   /vellum-reader/margins → /content/vellum-reader/margins.json
 */

import { useEffect, useState } from 'react';
import type { LoaderFunction, V2_MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useNavigate, useRouteError, isRouteErrorResponse } from '@remix-run/react';
import { getFiberContent, getAstraGraph } from '~/utils/content-server';
import type { FiberContent, AstraGraph } from '~/utils/content-types';
import { ColumnHeader } from '~/components/ColumnHeader';
import { NarrativeView } from '~/components/NarrativeView';
import { WorkspaceView } from '~/components/WorkspaceView';
import { MapView } from '~/components/MapView';
import { DeltaView } from '~/components/DeltaView';
import { OutlinePalette } from '~/components/OutlinePalette';
import { useMode } from '~/contexts/ModeContext';
import type { Mode } from '~/contexts/ModeContext';
import { useDelta } from '~/utils/use-delta';

interface LoaderData {
  slug: string;
  content: FiberContent | null;
  graph: AstraGraph;
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Vellum' }];
  const title = (data as LoaderData).content?.frontmatter?.title ?? (data as LoaderData).slug;
  return [{ title: `${title} — Vellum` }];
};

export const loader: LoaderFunction = async ({ params }) => {
  const slug = (params['*'] ?? '').replace(/\/+$/, ''); // strip trailing slash
  if (!slug) {
    return json({ slug: '', content: null, graph: { nodes: [], links: [] } });
  }

  const [content, graph] = await Promise.all([
    getFiberContent(slug),
    getAstraGraph(),
  ]);

  return json<LoaderData>({ slug, content, graph });
};

const MODE_KEYS: Record<string, Mode> = { '1': 'narrative', '2': 'workspace', '3': 'map', '4': 'delta' };

export default function ContentPage() {
  const { slug, content, graph } = useLoaderData<LoaderData>();
  const { mode, setMode } = useMode();
  const navigate = useNavigate();
  const { deltaEvents, changedIds, since, dismissed, acknowledge } = useDelta();
  const [outlineOpen, setOutlineOpen] = useState(false);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || (e.target as HTMLElement).isContentEditable;

      // Escape works everywhere — blur search, dismiss overlays
      if (e.key === 'Escape') {
        const active = document.activeElement as HTMLElement;
        if (active?.tagName === 'INPUT') active.blur();
        return;
      }

      // All other shortcuts only when not editing
      if (isEditing) return;

      // / — focus search
      if (e.key === '/') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('.vellum-column-header__search input');
        input?.focus();
        return;
      }

      // 1/2/3 — switch modes
      const newMode = MODE_KEYS[e.key];
      if (newMode) {
        setMode(newMode);
        return;
      }

      // t — toggle outline palette
      if (e.key === 't') {
        setOutlineOpen((prev) => !prev);
        return;
      }

      // [ — navigate back
      if (e.key === '[') {
        navigate(-1);
        return;
      }

      // ] — navigate forward
      if (e.key === ']') {
        navigate(1);
        return;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setMode, navigate]);

  // Build breadcrumb for nested slugs (e.g. vellum-reader/margins)
  const parts = slug.split('/');
  const breadcrumb = parts.length > 1
    ? parts.slice(0, -1).map((part, i) => ({
        label: part,
        slug: parts.slice(0, i + 1).join('/'),
      }))
    : [];

  // Unique changed fiber count for the Delta tab badge
  const deltaCount = new Set(deltaEvents.map((e) => e.fiberId)).size;

  return (
    <div className="vellum-page">
      <ColumnHeader deltaCount={dismissed ? 0 : deltaCount} />

      {mode === 'narrative' && content?.mdast && (
        <NarrativeView
          content={content}
          graphNodes={graph.nodes}
          graphLinks={graph.links}
          breadcrumb={breadcrumb}
          changedIds={changedIds}
        />
      )}

      {mode === 'narrative' && !content?.mdast && (
        <div className="vellum-error">
          Fiber <em>{slug}</em> not found. Is the content server running?
        </div>
      )}

      {mode === 'workspace' && (
        <WorkspaceView
          nodes={graph.nodes}
          links={graph.links}
          currentSlug={slug}
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
          events={dismissed ? [] : deltaEvents}
          since={since}
          onAcknowledge={acknowledge}
        />
      )}

      <OutlinePalette open={outlineOpen} onClose={() => setOutlineOpen(false)} />
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <div className="vellum-page">
      <ColumnHeader />
      <div className="vellum-error">
        {isRouteErrorResponse(error)
          ? `${error.status}: ${error.statusText}`
          : 'An unexpected error occurred.'}
      </div>
    </div>
  );
}
