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
import { useLocation, useNavigate } from 'react-router-dom';
import { useMode, type Mode } from '~/contexts/ModeContext';
import { useAdapter } from '~/contexts/AdapterContext';
import { FILE_TARGET_ROUTE, useFileTarget } from '~/contexts/FileTargetContext';
import { useWorkspaceSlot } from '~/contexts/WorkspaceSlotContext';
import type { SearchHit, GraphNode, GraphLink } from '~/utils/content-types';
import { statusGlyph } from '~/utils/fiber-status';
import { PretextNav, type NavItem } from './PretextNav';

const MODES: { id: Mode; letter: string; full: string }[] = [
  { id: 'narrative', letter: 'N', full: 'Narrative' },
  { id: 'workspace', letter: 'W', full: 'Workspace' },
  { id: 'find',      letter: 'F', full: 'Find' },
  { id: 'delta',     letter: 'Δ', full: 'Delta' },
];

/** Apply WorkspaceSlotContext label/letter overrides to the static MODES
 *  table. Embedding hosts that swap a tab body (portolan's kanban-in-vellum,
 *  Find-in-vellum) typically swap the chrome label too — e.g. "Workspace" →
 *  "Kanban", "W" → "K". Standalone vellum doesn't provide the context, so the
 *  defaults pass through unchanged. */
function applySlotLabelOverrides(
  modes: typeof MODES,
  workspaceLabel: string | null,
  workspaceLetter: string | null,
  findLabel: string | null,
  findLetter: string | null,
): typeof MODES {
  if (
    workspaceLabel === null &&
    workspaceLetter === null &&
    findLabel === null &&
    findLetter === null
  ) {
    return modes;
  }
  return modes.map((m) => {
    if (m.id === 'workspace') {
      return { ...m, full: workspaceLabel ?? m.full, letter: workspaceLetter ?? m.letter };
    }
    if (m.id === 'find') {
      return { ...m, full: findLabel ?? m.full, letter: findLetter ?? m.letter };
    }
    return m;
  });
}

/**
 * Width tier for progressive disclosure. Measured via ResizeObserver
 * on the thumb-index root element.
 *   wide   (>350px): full mode labels (Narrative, Workspace…), all nav
 *   medium (200–350px): short labels (N, W, Δ), parent + proximal siblings
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
  // Synthetic nodes carry their human label in `node.label` and a sentinel
  // slug we don't want to render. Detect by `__` slug prefix and prefer
  // the label in that case.
  if (node.slug.startsWith('__')) return node.label;
  const tail = node.slug.split('/').pop() ?? node.slug;
  return tail.replace(/-/g, ' ');
}

/** Strip MyST wikilink syntax for plain-text previews.
 *  `[[slug]]` → "slug" (with dashes/underscores/slashes humanised);
 *  `[[slug|display]]` → "display". Used in the search-result outcome
 *  preview so screen readers announce "See annotation actions landed"
 *  instead of "See [[annotation-actions-landed]]". */
function stripWikilinks(text: string): string {
  return text.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_, slug: string, display?: string) =>
    display ?? slug.replace(/[-_/]/g, ' ').trim(),
  );
}

interface FloatingIslandProps {
  currentNode?: GraphNode;
  graphNodes: GraphNode[];
  graphLinks: GraphLink[];
  backlinkCount: number;
  backlinkNodes: GraphNode[];
  deltaCount?: number;
  onNavigate: (slug: string) => void;
  /** Optional current-surface refresh. FiberPage wires this for fiber views;
   *  file-mode keeps its path-specific refresh in the file toolbar. */
  onRefresh?: () => void;
  /** Optional host hook fired when the user clicks the `← index` button on
   *  a root fiber (no parent in the local graph). Embedding hosts that
   *  layer a higher-level synthetic collection on top of vellum — e.g.
   *  portolan's "global Vellum index" sitting above each city — pass this
   *  to escape upward one scope level instead of bouncing through the
   *  local rootSlug redirect. Omit to keep the historical local-only
   *  `navigate('')` behaviour. */
  onIndexEscalate?: () => void;
  onCollapseRightRail?: () => void;
}

export function FloatingIsland({
  currentNode,
  graphNodes,
  graphLinks,
  backlinkCount,
  backlinkNodes,
  deltaCount = 0,
  onNavigate,
  onRefresh,
  onIndexEscalate,
  onCollapseRightRail,
}: FloatingIslandProps) {
  const { mode, setMode } = useMode();
  const adapter = useAdapter();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    label: workspaceLabel,
    letter: workspaceLetter,
    findLabel,
    findLetter,
  } = useWorkspaceSlot();
  const modes = useMemo(
    () => applySlotLabelOverrides(MODES, workspaceLabel, workspaceLetter, findLabel, findLetter),
    [workspaceLabel, workspaceLetter, findLabel, findLetter],
  );
  // File mode locks Workspace + Delta — they're fiber-collection concepts.
  // The buttons stay rendered so the chrome shape doesn't shift, but they're
  // greyed and inert. FiberPage's keyboard handler also blocks 2/3 in file mode.
  // Once the user navigates to a fiber slug (wikilink, search), pathname
  // leaves FILE_TARGET_ROUTE and the buttons re-enable for the rest of the mount.
  const fileTarget = useFileTarget();
  const isFileMode = !!fileTarget && location.pathname === FILE_TARGET_ROUTE;

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
        // Publish the rendered bottom of the thumb-index (top: 0 always,
        // so bottom == borderBox height) so the narrative prose column
        // can push its top padding down to match. borderBoxSize includes
        // padding; contentRect does not — we want the outer edge.
        let h = 0;
        const borderBoxes = entry.borderBoxSize;
        if (borderBoxes) {
          const box = Array.isArray(borderBoxes) ? borderBoxes[0] : borderBoxes;
          h = box?.blockSize ?? 0;
        }
        if (h <= 0) {
          h = el.getBoundingClientRect().height;
        }
        if (h > 0) {
          document.documentElement.style.setProperty('--thumb-index-bottom', `${Math.round(h)}px`);
        }
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--thumb-index-bottom');
    };
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

  // Top-level nodes: filter by slug shape (no `/`), matching
  // IndexView's "top of tree" rule. Doubles as siblings-of-root and as
  // the IndexView's children-of-synthetic-root.
  //
  // We deliberately do NOT use a graph-based "no contains-parent" rule
  // here. The earlier graph-shape rule let depth-2+ orphans surface as
  // top-level when their intermediate directory wasn't itself a fiber
  // (the loom case: `portolan/vellum-dogfood/some-leaf` with no
  // `portolan/vellum-dogfood/vellum-dogfood.md` to parent it).
  // See IndexView.tsx for the same lesson learned.
  const topLevelNodes = useMemo(() => {
    return graphNodes
      .filter((n) => !n.slug.includes('/'))
      .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99));
  }, [graphNodes]);

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
    // Root fiber: peers are the other top-level nodes.
    return topLevelNodes;
  }, [parentNode, currentNode, graphLinks, nodeById, topLevelNodes]);

  // Show all siblings and children — the scrollable line handles overflow.
  // When `currentNode` is null (we're on IndexView), the nav rail's
  // children row stands in for the IndexView's content: it lists the
  // top-level nodes (cities, in the global mount) so the user can
  // descend without leaving the sidebar. This is the "navigation tree
  // stays visible at the index" behaviour.
  const allChildNodes = useMemo(() => {
    if (!currentNode) return topLevelNodes;
    return graphLinks
      .filter((l) => l.kind === 'contains' && l.source === currentNode.id)
      .map((l) => nodeById.get(l.target))
      .filter((n): n is GraphNode => !!n)
      .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99));
  }, [currentNode, graphLinks, nodeById, topLevelNodes]);

  /* ── Search logic ── */
  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const hits = await adapter.searchFibers(q);
      setResults(hits);
      setShowResults(true);
      setSelectedIdx(-1);
    }, q ? 200 : 0);
  }, [adapter]);

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

  const handleNav = useCallback(
    (slug: string) => {
      onNavigate(slug);
    },
    [onNavigate],
  );

  return (
    <div
      className={`thumb-index thumb-index--${tier}${mode === 'delta' ? ' thumb-index--compact' : ''}`}
      ref={rootRef}
      role="navigation"
      aria-label="Vellum navigation"
    >
      {/* ── Header row: modes · search ── */}
      <div className="thumb-index__header">
        <nav className="thumb-index__modes" aria-label="View mode">
          {modes.map(({ id, letter, full }) => {
            // In file mode, only Narrative is meaningful. Workspace + Delta
            // need an AstraGraph and a fiber slug; greying the buttons signals
            // "open a fiber to use these" without hiding the chrome.
            const disabled = isFileMode && id !== 'narrative';
            const className = `thumb-index__mode thumb-index__mode--${id}${
              mode === id ? ' thumb-index__mode--active' : ''
            }${disabled ? ' thumb-index__mode--disabled' : ''}`;
            return (
              <button
                key={id}
                className={className}
                onClick={() => { if (!disabled) setMode(id); }}
                disabled={disabled}
                title={
                  disabled
                    ? `${full} unavailable while viewing a file — open a fiber to use this view`
                    : `${full} (${MODES.indexOf(MODES.find(m => m.id === id)!) + 1})`
                }
                aria-label={`${full} view`}
                aria-current={mode === id ? 'true' : undefined}
                aria-disabled={disabled || undefined}
              >
                {/* Visible label is duplicated by the button's aria-label
                    ("${full} view"), and parent generic name calculation
                    vacuums child text into long run-on names — so hide both
                    the long form and the short letter from AT. */}
                <span className="thumb-index__mode-full" aria-hidden="true">{full}</span>
                <span className="thumb-index__mode-short" aria-hidden="true">{letter}</span>
                {id === 'delta' && deltaCount > 0 && (
                  <span className="thumb-index__delta-badge">{deltaCount}</span>
                )}
              </button>
            );
          })}
        </nav>
        {onRefresh && (
          <button
            type="button"
            className="thumb-index__refresh-btn"
            onClick={onRefresh}
            title="Refresh"
            aria-label="Refresh"
          >
            <span aria-hidden="true">↻</span>
          </button>
        )}
        {onCollapseRightRail && (
          <button
            type="button"
            className="thumb-index__collapse-btn"
            onClick={onCollapseRightRail}
            title="Hide side column"
            aria-label="Hide side column"
          >
            <span aria-hidden="true">›</span>
          </button>
        )}
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
              <span aria-hidden="true">⌕</span>
            </button>
          )}
          {showResults && searchExpanded && query.trim().length > 0 && (() => {
            // Use viewport-fixed positioning so the dropdown escapes
            // the thumb-index's own scroll/overflow context — otherwise
            // long result lists get clipped at the panel's bottom edge.
            const inputRect = searchInputRef.current?.getBoundingClientRect();
            const top = inputRect ? inputRect.bottom + 4 : undefined;
            const right = inputRect ? window.innerWidth - inputRect.right : undefined;
            const maxHeight = inputRect ? Math.max(120, window.innerHeight - inputRect.bottom - 16) : undefined;
            return (
            <div
              className="search-results thumb-index__search-results"
              style={{
                position: 'fixed',
                top,
                right,
                maxHeight,
                overflowY: 'auto',
              }}
              role="listbox"
              aria-label="Search results"
            >
              {results.length === 0 ? (
                // Empty-state row keeps the surface honest: the user can see
                // the search ran and produced nothing, instead of typing into
                // a dead input where the dropdown silently never appears.
                <div className="search-result search-result--empty" role="option" aria-disabled="true">
                  <span className="search-result__body">
                    <span className="search-result__title">No matches</span>
                  </span>
                </div>
              ) : (
                results.slice(0, 12).map((hit, i) => (
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
                  <span className="search-result__glyph" aria-hidden="true">{statusGlyph(hit.status)}</span>
                  <span className="search-result__body">
                    <span className="search-result__title">{hit.title}</span>
                    {hit.outcome && <span className="search-result__outcome">{stripWikilinks(hit.outcome)}</span>}
                  </span>
                </a>
              ))
              )}
            </div>
            );
          })()}
        </div>
      </div>

      {/* ── Navigation: parent / siblings / children / backlinks ──
          Always rendered — the rail carries the user's positional
          context (you-are-here + what's around) regardless of which
          page they're on. On a fiber page that's parent + siblings +
          children + backlinks; on IndexView (no `currentNode`) the
          parent row reads as the "you are here" anchor and the
          children row holds the top-level nodes (cities in the global
          mount, root fibers in a city mount). The rail never blanks. */}
      <div className="thumb-index__nav" ref={navRef}>
        {/* Parent back-link. Always rendered — it's the rail's positional
            anchor. The ASTRA counts + tempered flag used to share this
            row; they moved to the page-meta panel below so they sit in
            the top-right blank space mirroring the empty top-left above
            the FiberHeader.

            Three states:
              - currentNode + parentNode → "← parent-label" (climb tree)
              - currentNode + no parent  → "← index" (root fiber: escalate
                via host hook, or fall back to local IndexView)
              - no currentNode → "← index" (we're already at IndexView;
                button reads as "you are here". Clicks escalate when the
                host wired one; otherwise they're idempotent.)

            The `--at-index` modifier lets CSS recede the button when
            it's purely positional, distinguishing "you are here" from
            "you can go back". */}
        <div className="thumb-index__parent-row">
          {parentNode ? (
            <button
              className="thumb-index__parent"
              onClick={() => handleNav(parentNode.slug)}
              title={parentNode.label}
              aria-label={`Back to ${parentNode.label}`}
            >
              <span className="thumb-index__arrow" aria-hidden="true">←</span>
              {shortLabel(parentNode)}
            </button>
          ) : (
            <button
              className={`thumb-index__parent${!onIndexEscalate ? ' thumb-index__parent--at-index' : ''}`}
              onClick={() => {
                // Root fiber or IndexView with no parent in the local
                // graph. If an embedding host wired `onIndexEscalate`
                // through CollectionContext, treat the click as "escape
                // upward one scope level" — the host typically tears
                // down this modal and remounts vellum on a synthetic
                // higher-level collection (portolan's global Vellum
                // index). Without a host hook, fall back to the
                // historical local-only `navigate('')`; on a root
                // fiber FiberPage's rootSlug-redirect effect bounces
                // straight back here, on IndexView this is a no-op
                // (we're already at slug='').
                if (onIndexEscalate) onIndexEscalate();
                else onNavigate('');
              }}
              title={
                !onIndexEscalate
                  ? 'Index'
                  : 'Index — escalate to global'
              }
              aria-label={!onIndexEscalate ? 'Index' : 'Back to index'}
              aria-current={!onIndexEscalate ? 'page' : undefined}
            >
              <span className="thumb-index__arrow" aria-hidden="true">←</span>
              index
            </button>
          )}
        </div>

        {/* Backlinks — inline chip row. Reads like a marginal note
            ("referenced by …") rather than UI chrome, with each
            fiber linkable. Sits just under the breadcrumb so the
            citing fibers are visible without scrolling past nav. */}
        {backlinkCount > 0 && (
          <div className="thumb-index__backlinks-row">
            <span className="thumb-index__nav-label">referenced by</span>
            <div className="thumb-index__backlinks-chips">
              {backlinkNodes.map((node, i) => (
                <span key={node.id} className="thumb-index__backlink-chip-wrap">
                  <button
                    className="thumb-index__backlink-chip"
                    onClick={() => handleNav(node.slug)}
                    title={node.label}
                  >
                    <span className="thumb-index__backlink-chip-glyph" aria-hidden="true">{statusGlyph(node.status)}</span>
                    <span className="thumb-index__backlink-chip-label">{shortLabel(node)}</span>
                  </button>
                  {i < backlinkNodes.length - 1 && (
                    <span className="thumb-index__backlink-sep" aria-hidden="true"> · </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Siblings — labeled scrollable line. Peers of the current node:
            left-aligned (no indent), no glyph. The tree-affordance below
            (children with `↳` + indent) reads against this baseline. */}
        {allSiblings.length > 0 && (
          <div className="thumb-index__nav-row thumb-index__nav-row--siblings">
            <span className="thumb-index__nav-label">{allSiblings.length} siblings</span>
            <div className="thumb-index__nav-scroll">
              <PretextNav
                items={allSiblings.map((sib): NavItem => ({
                  label: shortLabel(sib),
                  slug: sib.slug,
                  isCurrent: sib.id === currentNode?.id,
                  statusGlyph: statusGlyph(sib.status),
                }))}
                width={navWidth}
                onNavigate={handleNav}
              />
            </div>
          </div>
        )}

        {/* Children — one level below current. Visual: small indent + `↳`
            glyph so the row reads as "what's below this fiber" rather
            than another flat list at the same level as siblings. The
            parent row has ←, children have ↳; together the rail's three
            tree-rows (parent / siblings / children) carry directional
            cues without needing a separate diagram.

            At IndexView (`!currentNode`) this row stands alone and lists
            the top-level nodes (cities in portolan's global mount). The
            `↳` glyph is dropped there since there's no current node to
            descend *from* — the row reads as the index's catalog. */}
        {allChildNodes.length > 0 && (
          <div className="thumb-index__nav-row thumb-index__nav-row--children">
            <span className="thumb-index__nav-label">
              {currentNode && (
                <span className="thumb-index__nav-glyph" aria-hidden="true">↳</span>
              )}
              {allChildNodes.length} {currentNode ? 'children' : 'entries'}
            </span>
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

      </div>
    </div>
  );
}
