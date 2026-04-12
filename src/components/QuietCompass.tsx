/**
 * QuietCompass — a sticky two-line orientation bar for fiber navigation.
 *
 * Line 1: ← parent | sibling · sibling · [current] · sibling  (counts at far right)
 * Line 2: child · child · child  (only when children exist)
 *
 * All JetBrains Mono, no italic, no status glyphs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode, GraphLink } from '~/utils/content-types';
import { statusGlyph } from '~/utils/fiber-status';

interface QuietCompassProps {
  currentNode: GraphNode;
  graphNodes: GraphNode[];
  graphLinks: GraphLink[];
  backlinkCount: number;
  backlinkNodes: GraphNode[];
  onNavigate: (slug: string) => void;
}

const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  open: 1,
  closed: 2,
  suspended: 3,
};

/** Extract the last path segment from a slug for compact display. */
function shortLabel(node: GraphNode): string {
  const tail = node.slug.split('/').pop() ?? node.slug;
  return tail.replace(/-/g, ' ');
}

export function QuietCompass({
  currentNode,
  graphNodes,
  graphLinks,
  backlinkCount,
  backlinkNodes,
  onNavigate,
}: QuietCompassProps) {
  const siblingRowRef = useRef<HTMLDivElement>(null);
  const currentSiblingRef = useRef<HTMLButtonElement>(null);
  const backlinkBadgeRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const nodeById = new Map(graphNodes.map((n) => [n.id, n]));

  // Derive parent
  const parentLink = graphLinks.find(
    (l) => l.kind === 'contains' && l.target === currentNode.id,
  );
  const parentNode = parentLink ? nodeById.get(parentLink.source) : undefined;

  // Derive children
  const childNodes = useMemo(() => {
    const childIds = graphLinks
      .filter((l) => l.kind === 'contains' && l.source === currentNode.id)
      .map((l) => l.target);
    return childIds
      .map((id) => nodeById.get(id))
      .filter((n): n is GraphNode => !!n)
      .sort((a, b) => {
        const pa = STATUS_PRIORITY[a.status] ?? 99;
        const pb = STATUS_PRIORITY[b.status] ?? 99;
        return pa - pb;
      });
  }, [currentNode.id, graphLinks, graphNodes]);

  // Derive siblings (including current node)
  const siblings = useMemo(() => {
    if (!parentNode) return [];
    const siblingIds = graphLinks
      .filter((l) => l.kind === 'contains' && l.source === parentNode.id)
      .map((l) => l.target);
    return siblingIds
      .map((id) => nodeById.get(id))
      .filter((n): n is GraphNode => !!n)
      .sort((a, b) => {
        const pa = STATUS_PRIORITY[a.status] ?? 99;
        const pb = STATUS_PRIORITY[b.status] ?? 99;
        return pa - pb;
      });
  }, [parentNode, graphLinks, graphNodes]);

  // Count children for badge
  const childCount = childNodes.length;

  // Scroll current sibling into view on mount and node change
  useEffect(() => {
    currentSiblingRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
    });
  }, [currentNode.id]);

  // Dismiss popover on outside click or Escape
  useEffect(() => {
    if (!popoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        backlinkBadgeRef.current &&
        !backlinkBadgeRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [popoverOpen]);

  const handleNavigate = useCallback(
    (slug: string) => {
      setPopoverOpen(false);
      onNavigate(slug);
    },
    [onNavigate],
  );

  return (
    <nav className="quiet-compass" aria-label="Fiber navigation">
      {/* Line 1: parent link | siblings row … counts */}
      <div className="quiet-compass__line1">
        {parentNode && (
          <>
            <button
              className="quiet-compass__link"
              onClick={() => handleNavigate(parentNode.slug)}
            >
              <span className="quiet-compass__arrow">←</span> {shortLabel(parentNode)}
            </button>
            <span className="quiet-compass__pipe">|</span>
          </>
        )}
        <div className="quiet-compass__siblings" ref={siblingRowRef}>
          {siblings.map((sib, i) => (
            <span key={sib.id} style={{ display: 'contents' }}>
              {i > 0 && <span className="quiet-compass__dot">·</span>}
              <button
                ref={sib.id === currentNode.id ? currentSiblingRef : undefined}
                className={
                  'quiet-compass__sibling' +
                  (sib.id === currentNode.id ? ' quiet-compass__sibling--current' : '')
                }
                onClick={() => handleNavigate(sib.slug)}
                aria-current={sib.id === currentNode.id ? 'page' : undefined}
              >
                {shortLabel(sib)}
              </button>
            </span>
          ))}
        </div>
        <div className="quiet-compass__counts">
          {childCount > 0 && (
            <span className="quiet-compass__badge">
              {childCount}↓
            </span>
          )}
          {backlinkCount > 0 && (
            <span className="quiet-compass__backlink-wrap">
              <button
                ref={backlinkBadgeRef}
                className="quiet-compass__badge quiet-compass__badge--clickable"
                onClick={() => setPopoverOpen((v) => !v)}
                aria-expanded={popoverOpen}
                aria-haspopup="true"
              >
                {backlinkCount}↩
              </button>
              {popoverOpen && (
                <div ref={popoverRef} className="quiet-compass__popover">
                  {backlinkNodes.map((node) => (
                    <button
                      key={node.id}
                      className="quiet-compass__popover-item"
                      onClick={() => handleNavigate(node.slug)}
                    >
                      <span className="quiet-compass__glyph">
                        {statusGlyph(node.status)}
                      </span>
                      {node.label}
                    </button>
                  ))}
                </div>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Line 2: children (only when present) */}
      {childNodes.length > 0 && (
        <div className="quiet-compass__line2">
          {childNodes.map((child, i) => (
            <span key={child.id} style={{ display: 'contents' }}>
              {i > 0 && <span className="quiet-compass__dot">·</span>}
              <button
                className="quiet-compass__sibling"
                onClick={() => handleNavigate(child.slug)}
              >
                {shortLabel(child)}
              </button>
            </span>
          ))}
        </div>
      )}
    </nav>
  );
}
