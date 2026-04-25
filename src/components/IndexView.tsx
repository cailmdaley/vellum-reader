/**
 * IndexView — auto-generated listing of top-of-tree fibers.
 *
 * Renders at `/` as the virtual root of the fiber tree. Every
 * top-level fiber can navigate here via `← index` in the thumb index.
 *
 * Filter: slug shape, not graph shape. A fiber is "top of tree" iff its
 * slug has no `/` — meaning it lives at `.felt/<slug>.md` (entry-point)
 * or `.felt/<slug>/<slug>.md` (top folder fiber). Anything deeper has a
 * slash in its id, no matter whether its intermediate parent has its
 * own `<dir>/<dir>.md` file. The earlier graph-based "no `contains`
 * parent" rule let depth-2+ orphans surface here when the intermediate
 * directory wasn't itself a fiber, which is exactly the loom case
 * (`~/loom/.felt/portolan/vellum-dogfood/some-leaf` with no
 * `portolan/vellum-dogfood/vellum-dogfood.md` to parent it).
 *
 * One section, status-blind. Active and open first by status priority;
 * closed and suspended sink to the bottom; createdAt desc within each
 * bucket. The `--closed` row modifier lets the CSS recede non-live rows
 * so live work stays the figure.
 */

import { useMemo } from 'react';
import type { GraphNode, GraphLink } from '~/utils/content-types';
import { statusGlyph, cleanVerdict } from '~/utils/fiber-status';

const STATUS_PRIORITY: Record<string, number> = {
  active: 0, open: 1, closed: 2, suspended: 3,
};

const QUIET_STATUSES = new Set(['closed', 'suspended']);

interface IndexViewProps {
  nodes: GraphNode[];
  links: GraphLink[];
  onNavigate: (slug: string) => void;
  /** Optional eyebrow above the "Index" title — typically the collection or
   *  city name. When omitted, the eyebrow space collapses; the CSS rule on
   *  `.index-view__title:not([data-eyebrow])::before` removes the pseudo
   *  entirely so there's no stray gap. */
  eyebrow?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function IndexView({ nodes, links: _links, onNavigate, eyebrow }: IndexViewProps) {
  const rootFibers = useMemo(() => {
    return nodes
      .filter((n) => !n.slug.includes('/'))
      .sort((a, b) => {
        // Status-undefined sorts with `open` (priority 1), not at the very
        // end — missing status is a stub-shape, not a closed-shape.
        const sp = (STATUS_PRIORITY[a.status] ?? 1) - (STATUS_PRIORITY[b.status] ?? 1);
        if (sp !== 0) return sp;
        const ta = a.createdAt ? Date.parse(a.createdAt) : Number.NaN;
        const tb = b.createdAt ? Date.parse(b.createdAt) : Number.NaN;
        const aHasTime = Number.isFinite(ta);
        const bHasTime = Number.isFinite(tb);
        if (aHasTime && bHasTime && ta !== tb) return tb - ta;
        if (aHasTime !== bHasTime) return aHasTime ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
  }, [nodes]);

  return (
    <div className="index-view">
      <h1 className="index-view__title" data-eyebrow={eyebrow || undefined}>Index</h1>
      <p className="index-view__count">{rootFibers.length} {rootFibers.length === 1 ? 'fiber' : 'fibers'}</p>

      {rootFibers.length > 0 && (
        <section className="index-view__section">
          {rootFibers.map((node) => {
            const quiet = QUIET_STATUSES.has(node.status);
            // cleanVerdict strips the leading blockquote `> ` and inline
            // markdown markers (** _ ` …) so the lede previews don't
            // show as raw markdown literals visually OR in the button's
            // accessible name. Without this, a ledel like
            // "**Purpose**" rendered as the literal asterisks both
            // on-screen and in screen-reader output.
            const verdict = cleanVerdict(node.verdict);
            return (
              <button
                key={node.id}
                className={`index-view__item${quiet ? ' index-view__item--closed' : ''}`}
                onClick={() => onNavigate(node.slug)}
              >
                <span className="index-view__glyph" aria-hidden="true">{statusGlyph(node.status)}</span>
                <span className="index-view__label">{node.label}</span>
                {verdict && (
                  <span className="index-view__verdict">{verdict}</span>
                )}
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}
