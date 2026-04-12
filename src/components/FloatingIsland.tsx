/**
 * FloatingIsland — fixed chrome panel in the right margin.
 *
 * All navigation chrome lives here; the prose column is pure text.
 *
 * Layout (top to bottom):
 *   1. Header: wordmark + mode tabs (single-letter) + search icon
 *   2. Parent: ← link to containing fiber
 *   3. Siblings: horizontal wrap, current in gold, peers by status
 *   4. Children: vertical list, indented, smaller — structurally
 *      distinct from siblings through layout direction
 *   5. Counts: backlink badge with popover
 *
 * Positioning: fixed top-right, left edge tracks the prose column's
 * right edge via --page-margin-left + --prose-width. Width is whatever
 * space remains to the viewport edge.
 *
 * Progressive disclosure by width:
 *   Wide (>280px): everything, full labels
 *   Medium (140–280px): truncated siblings, parent only
 *   Narrow (<140px): mode glyphs, parent arrow, search
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMode, type Mode } from '~/contexts/ModeContext';
import type { SearchHit, GraphNode, GraphLink } from '~/utils/content-types';
import { searchFibers } from '~/api';
import { statusGlyph } from '~/utils/fiber-status';
import { PretextNav, type NavItem } from './PretextNav';

const MODES: { id: Mode; letter: string; full: string }[] = [
  { id: 'narrative', letter: 'N', full: 'Narrative' },
  { id: 'workspace', letter: 'W', full: 'Workspace' },
  { id: 'map', letter: 'M', full: 'Map' },
  { id: 'delta', letter: 'Δ', full: 'Delta' },
];

/**
 * Width tier for progressive disclosure. Measured via ResizeObserver
 * on the thumb-index root element.
 *   wide   (>350px): full mode labels (Narrative, Workspace…), all nav
 *   medium (200–350px): short labels (N, W, M, Δ), parent + proximal siblings
 *   narrow (<200px): letters only, parent arrow, search icon
 */
type WidthTier = 'wide' | 'medium' | 'narrow';
function tierFromWidth(w: number): WidthTier {
  if (w > 350) return 'wide';
  if (w > 200) return 'medium';
  return 'narrow';
}

const STATUS_PRIORITY: Record<string, number> = {
  active: 0, open: 1, closed: 2, suspended: 3,
};

function shortLabel(node: GraphNode): string {
  const tail = node.slug.split('/').pop() ?? node.slug;
  return tail.replace(/-/g, ' ');
}

interface FloatingIslandProps {
  currentNode?: GraphNode;
  graphNodes: GraphNode[];
  graphLinks: GraphLink[];
  backlinkCount: number;
  backlinkNodes: GraphNode[];
  deltaCount?: number;
  onNavigate: (slug: string) => void;
}

export function FloatingIsland({
  currentNode,
  graphNodes,
  graphLinks,
  backlinkCount,
  backlinkNodes,
  deltaCount = 0,
  onNavigate,
}: FloatingIslandProps) {
  const { mode, setMode } = useMode();
  const navigate = useNavigate();

  /* ── Width tier (progressive disclosure) + raw pixel width ── */
  const rootRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const [tier, setTier] = useState<WidthTier>('wide');
  const [navWidth, setNavWidth] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentBoxSize
          ? (Array.isArray(entry.contentBoxSize) ? entry.contentBoxSize[0] : entry.contentBoxSize).inlineSize
          : entry.contentRect.width;
        setTier(tierFromWidth(w));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Measure the nav section separately — its content width is what
  // pretext should lay into, not the root (which includes padding).
  // Re-run when currentNode changes since the nav div is conditionally rendered.
  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentBoxSize
          ? (Array.isArray(entry.contentBoxSize) ? entry.contentBoxSize[0] : entry.contentBoxSize).inlineSize
          : entry.contentRect.width;
        setNavWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentNode]);

  /* ── Search ── */
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  /* ── Backlink popover ── */
  const [popoverOpen, setPopoverOpen] = useState(false);
  const backlinkBadgeRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const nodeById = useMemo(
    () => new Map(graphNodes.map((n) => [n.id, n])),
    [graphNodes],
  );

  /* ── Tree derivations ── */
  const parentNode = useMemo(() => {
    if (!currentNode) return undefined;
    const link = graphLinks.find(
      (l) => l.kind === 'contains' && l.target === currentNode.id,
    );
    return link ? nodeById.get(link.source) : undefined;
  }, [currentNode, graphLinks, nodeById]);

  const allSiblings = useMemo(() => {
    if (!currentNode) return [];
    if (parentNode) {
      // Normal case: siblings are other children of the same parent
      return graphLinks
        .filter((l) => l.kind === 'contains' && l.source === parentNode.id)
        .map((l) => nodeById.get(l.target))
        .filter((n): n is GraphNode => !!n)
        .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99));
    }
    // Root fiber: treat other parentless nodes as top-level peers
    const parentedIds = new Set(
      graphLinks.filter((l) => l.kind === 'contains').map((l) => l.target),
    );
    return graphNodes
      .filter((n) => !parentedIds.has(n.id))
      .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99));
  }, [parentNode, currentNode, graphLinks, graphNodes, nodeById]);

  // Show all siblings and children — the scrollable line handles overflow.
  const allChildNodes = useMemo(() => {
    if (!currentNode) return [];
    return graphLinks
      .filter((l) => l.kind === 'contains' && l.source === currentNode.id)
      .map((l) => nodeById.get(l.target))
      .filter((n): n is GraphNode => !!n)
      .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99));
  }, [currentNode, graphLinks, nodeById]);

  /* ── Search logic ── */
  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const hits = await searchFibers(q);
      setResults(hits);
      setShowResults(true);
      setSelectedIdx(-1);
    }, q ? 200 : 0);
  }, []);

  function handleSearchInput(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    doSearch(q);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setShowResults(false);
      setQuery('');
      setSearchExpanded(false);
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (!showResults || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = results[selectedIdx >= 0 ? selectedIdx : 0];
      if (hit) {
        setShowResults(false);
        setQuery('');
        setSearchExpanded(false);
        setMode('narrative');
        navigate(`/${hit.id}`);
      }
    }
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
        if (!query) setSearchExpanded(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [query]);

  useEffect(() => {
    if (searchExpanded) {
      searchInputRef.current?.focus();
      doSearch(query);
    }
  }, [searchExpanded]);

  /* ── Backlink popover dismiss ── */
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

  const handleNav = useCallback(
    (slug: string) => {
      setPopoverOpen(false);
      onNavigate(slug);
    },
    [onNavigate],
  );

  return (
    <div className={`thumb-index thumb-index--${tier}`} ref={rootRef} role="navigation" aria-label="Vellum navigation">
      {/* ── Header row: modes · search ── */}
      <div className="thumb-index__header">
        <nav className="thumb-index__modes" aria-label="View mode">
          {MODES.map(({ id, letter, full }) => (
            <button
              key={id}
              className={`thumb-index__mode thumb-index__mode--${id}${mode === id ? ' thumb-index__mode--active' : ''}`}
              onClick={() => setMode(id)}
              title={`${full} (${MODES.indexOf(MODES.find(m => m.id === id)!) + 1})`}
              aria-current={mode === id ? 'true' : undefined}
            >
              <span className="thumb-index__mode-full">{full}</span>
              <span className="thumb-index__mode-short">{letter}</span>
              {id === 'delta' && deltaCount > 0 && (
                <span className="thumb-index__delta-badge">{deltaCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="thumb-index__search-wrap" ref={searchRef}>
          {searchExpanded ? (
            <input
              ref={searchInputRef}
              type="search"
              className="thumb-index__search-input"
              placeholder="Search…"
              value={query}
              onChange={handleSearchInput}
              onKeyDown={handleSearchKeyDown}
              onBlur={() => {
                if (!query) setTimeout(() => setSearchExpanded(false), 150);
              }}
              aria-label="Search fibers"
            />
          ) : (
            <button
              className="thumb-index__search-btn"
              onClick={() => setSearchExpanded(true)}
              title="Search (/ )"
              aria-label="Open search"
            >
              ⌕
            </button>
          )}
          {showResults && searchExpanded && results.length > 0 && (
            <div className="search-results thumb-index__search-results">
              {results.slice(0, 12).map((hit, i) => (
                <a
                  key={hit.id}
                  href={`/${hit.id}`}
                  className={`search-result${i === selectedIdx ? ' search-result--selected' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setShowResults(false);
                    setQuery('');
                    setSearchExpanded(false);
                    setMode('narrative');
                    navigate(`/${hit.id}`);
                  }}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  <span className="search-result__glyph">{statusGlyph(hit.status)}</span>
                  <span className="search-result__body">
                    <span className="search-result__title">{hit.title}</span>
                    {hit.outcome && <span className="search-result__outcome">{hit.outcome}</span>}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Navigation: parent / siblings / children / backlinks ── */}
      {currentNode && (
        <div className="thumb-index__nav" ref={navRef}>
          {/* Parent — up-link. Root fibers link to / (the index). */}
          {parentNode ? (
            <button
              className="thumb-index__parent"
              onClick={() => handleNav(parentNode.slug)}
              title={parentNode.label}
            >
              <span className="thumb-index__arrow">←</span>
              {shortLabel(parentNode)}
            </button>
          ) : (
            <button
              className="thumb-index__parent"
              onClick={() => onNavigate('')}
              title="Index — all top-level fibers"
            >
              <span className="thumb-index__arrow">←</span>
              index
            </button>
          )}

          {/* Siblings — labeled scrollable line */}
          {allSiblings.length > 0 && (
            <div className="thumb-index__nav-row">
              <span className="thumb-index__nav-label">{allSiblings.length} siblings</span>
              <div className="thumb-index__nav-scroll">
                <PretextNav
                  items={allSiblings.map((sib): NavItem => ({
                    label: shortLabel(sib),
                    slug: sib.slug,
                    isCurrent: sib.id === currentNode.id,
                    statusGlyph: statusGlyph(sib.status),
                  }))}
                  width={navWidth}
                  onNavigate={handleNav}
                />
              </div>
            </div>
          )}

          {/* Children — labeled scrollable line */}
          {allChildNodes.length > 0 && (
            <div className="thumb-index__nav-row">
              <span className="thumb-index__nav-label">{allChildNodes.length} children</span>
              <div className="thumb-index__nav-scroll">
                <PretextNav
                  items={allChildNodes.map((child): NavItem => ({
                    label: shortLabel(child),
                    slug: child.slug,
                    statusGlyph: statusGlyph(child.status),
                  }))}
                  width={navWidth}
                  onNavigate={handleNav}
                />
              </div>
            </div>
          )}

          {/* Backlinks */}
          {backlinkCount > 0 && (
            <div className="thumb-index__backlinks">
              <button
                ref={backlinkBadgeRef}
                className="thumb-index__backlink-badge"
                onClick={() => setPopoverOpen((v) => !v)}
                aria-expanded={popoverOpen}
                aria-haspopup="true"
              >
                {backlinkCount} ↩
              </button>
              {popoverOpen && (
                <div ref={popoverRef} className="thumb-index__popover">
                  {backlinkNodes.map((node) => (
                    <button
                      key={node.id}
                      className="thumb-index__popover-item"
                      onClick={() => handleNav(node.slug)}
                    >
                      <span className="thumb-index__status-dot">{statusGlyph(node.status)}</span>
                      {node.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
