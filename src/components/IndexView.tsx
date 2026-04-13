/**
 * IndexView — auto-generated listing of all top-level fibers.
 *
 * Renders at `/` as the virtual root of the fiber tree. Every
 * top-level fiber can navigate here via `← index` in the thumb index.
 * Sorted by status bucket, then reverse chronological within each bucket.
 */

import { useMemo } from 'react';
import type { GraphNode, GraphLink } from '~/utils/content-types';
import { statusGlyph } from '~/utils/fiber-status';

const STATUS_PRIORITY: Record<string, number> = {
  active: 0, open: 1, closed: 2, suspended: 3,
};

interface IndexViewProps {
  nodes: GraphNode[];
  links: GraphLink[];
  onNavigate: (slug: string) => void;
}

export function IndexView({ nodes, links, onNavigate }: IndexViewProps) {
  const rootFibers = useMemo(() => {
    const parentedIds = new Set(
      links.filter((l) => l.kind === 'contains').map((l) => l.target),
    );
    return nodes
      .filter((n) => !parentedIds.has(n.id))
      .sort((a, b) => {
        const sp = (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
        if (sp !== 0) return sp;
        const ta = a.createdAt ? Date.parse(a.createdAt) : Number.NaN;
        const tb = b.createdAt ? Date.parse(b.createdAt) : Number.NaN;
        const aHasTime = Number.isFinite(ta);
        const bHasTime = Number.isFinite(tb);
        if (aHasTime && bHasTime && ta !== tb) return tb - ta;
        if (aHasTime !== bHasTime) return aHasTime ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
  }, [nodes, links]);

  const active = rootFibers.filter((n) => n.status === 'active' || n.status === 'open');
  const closed = rootFibers.filter((n) => n.status !== 'active' && n.status !== 'open');

  return (
    <div className="index-view">
      <h1 className="index-view__title">Index</h1>
      <p className="index-view__count">{rootFibers.length} fibers</p>

      {active.length > 0 && (
        <section className="index-view__section">
          {active.map((node) => (
            <button
              key={node.id}
              className="index-view__item"
              onClick={() => onNavigate(node.slug)}
            >
              <span className="index-view__glyph">{statusGlyph(node.status)}</span>
              <span className="index-view__label">{node.label}</span>
              {node.verdict && (
                <span className="index-view__verdict">{node.verdict}</span>
              )}
            </button>
          ))}
        </section>
      )}

      {closed.length > 0 && (
        <section className="index-view__section index-view__section--closed">
          <h2 className="index-view__section-title">Closed</h2>
          {closed.map((node) => (
            <button
              key={node.id}
              className="index-view__item index-view__item--closed"
              onClick={() => onNavigate(node.slug)}
            >
              <span className="index-view__glyph">{statusGlyph(node.status)}</span>
              <span className="index-view__label">{node.label}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
