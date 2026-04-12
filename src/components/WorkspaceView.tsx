/**
 * WorkspaceView — the Workspace tab's left column.
 *
 * A dense, filterable list of the current fiber's child fibers, modeled on
 * a GitHub issue tracker. Clicking a row picks which fiber is decomposed
 * into cards on the right-hand anatomy pane (state lifted to FiberPage) —
 * clicking a row does NOT navigate away from the current URL. The ↗ button
 * on each row is the explicit "open this in Narrative" action.
 *
 * Filters stacked on top of the list: always-on search, segmented status,
 * ⧖ open-decisions toggle, ⬡ tempered toggle, ◇ recently-changed toggle,
 * and a scrollable row of tag chips derived from the visible children.
 */
import { useMemo, useState } from 'react';
import type { GraphLink, GraphNode } from '~/utils/content-types';
import { cleanVerdict, normalizeStatus, statusGlyph } from '~/utils/fiber-status';

interface WorkspaceViewProps {
  nodes: GraphNode[];
  links: GraphLink[];
  currentSlug: string;
  selectedSlug: string;
  onSelect: (slug: string) => void;
  onOpenInNarrative: (slug: string) => void;
  changedIds?: Set<string>;
}

type StatusFilter = 'all' | 'active' | 'open' | 'closed' | 'attention';

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'all' },
  { key: 'active', label: '◐ active' },
  { key: 'open', label: '○ open' },
  { key: 'attention', label: '◈ attention' },
  { key: 'closed', label: '● closed' },
];

function hasOpenDecision(node: GraphNode): boolean {
  return (node.decisions ?? []).some((decision) => !decision.selectedKey);
}

function matchesStatus(node: GraphNode, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  const status = normalizeStatus(node.status);
  if (filter === 'attention') return status === 'unresolved' || status === 'blocked';
  return status === filter;
}

function matchesSearch(node: GraphNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (node.label.toLowerCase().includes(q)) return true;
  if (node.slug.toLowerCase().includes(q)) return true;
  if ((node.verdict ?? '').toLowerCase().includes(q)) return true;
  if (node.tags.some((tag) => tag.toLowerCase().includes(q))) return true;
  return false;
}

export function WorkspaceView({
  nodes,
  links,
  currentSlug,
  selectedSlug,
  onSelect,
  onOpenInNarrative,
  changedIds,
}: WorkspaceViewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [openDecisionsOnly, setOpenDecisionsOnly] = useState(false);
  const [temperedOnly, setTemperedOnly] = useState(false);
  const [changedOnly, setChangedOnly] = useState(false);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const { currentNode, children } = useMemo(() => {
    const nodeBySlug = new Map(nodes.map((node) => [node.slug, node]));
    const current = nodeBySlug.get(currentSlug);
    const childSlugs = new Set(
      links
        .filter((link) => link.kind === 'contains' && link.source === currentSlug)
        .map((link) => link.target),
    );
    const kids = nodes.filter((node) => childSlugs.has(node.slug));
    return { currentNode: current, children: kids };
  }, [nodes, links, currentSlug]);

  // Tag chips are derived from whatever's in scope (children of the current
  // fiber) so the filter row never surfaces a tag that can't match a row.
  const tagHistogram = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of children) {
      for (const tag of node.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [children]);

  const filtered = useMemo(() => {
    return children.filter((node) => {
      if (!matchesStatus(node, statusFilter)) return false;
      if (openDecisionsOnly && !hasOpenDecision(node)) return false;
      if (temperedOnly && !node.tempered) return false;
      if (changedOnly && !(changedIds?.has(node.slug))) return false;
      if (activeTags.size > 0 && !node.tags.some((tag) => activeTags.has(tag))) return false;
      if (!matchesSearch(node, search)) return false;
      return true;
    });
  }, [children, statusFilter, openDecisionsOnly, temperedOnly, changedOnly, activeTags, changedIds, search]);

  const counts = useMemo(() => {
    let active = 0;
    let open = 0;
    let closed = 0;
    let attention = 0;
    let openDecisions = 0;
    let tempered = 0;
    let changed = 0;
    for (const node of children) {
      const status = normalizeStatus(node.status);
      if (status === 'active') active++;
      else if (status === 'open') open++;
      else if (status === 'closed') closed++;
      else if (status === 'unresolved' || status === 'blocked') attention++;
      if (hasOpenDecision(node)) openDecisions++;
      if (node.tempered) tempered++;
      if (changedIds?.has(node.slug)) changed++;
    }
    return { total: children.length, active, open, closed, attention, openDecisions, tempered, changed };
  }, [children, changedIds]);

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  if (!currentNode) {
    return (
      <div className="vellum-error">
        Fiber <em>{currentSlug}</em> not found.
      </div>
    );
  }

  return (
    <div className="vellum-workspace">
      {children.length === 0 ? (
        <p className="workspace-empty">No sub-fibers. This fiber is a leaf.</p>
      ) : (
        <>
          <div className="workspace-filters">
            <input
              type="search"
              className="workspace-filters__search"
              placeholder="Search title, slug, tag, outcome…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              spellCheck={false}
            />

            <div className="workspace-filters__row">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  className={`workspace-chip${statusFilter === tab.key ? ' workspace-chip--active' : ''}`}
                  onClick={() => setStatusFilter(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
              {counts.openDecisions > 0 && (
                <button
                  className={`workspace-chip workspace-chip--gold${openDecisionsOnly ? ' workspace-chip--active' : ''}`}
                  onClick={() => setOpenDecisionsOnly((v) => !v)}
                  title="Only fibers with open decisions"
                >
                  ⧖ {counts.openDecisions}
                </button>
              )}
              {counts.tempered > 0 && (
                <button
                  className={`workspace-chip workspace-chip--teal${temperedOnly ? ' workspace-chip--active' : ''}`}
                  onClick={() => setTemperedOnly((v) => !v)}
                  title="Only human-reviewed (tempered) fibers"
                >
                  ⬡ {counts.tempered}
                </button>
              )}
              {counts.changed > 0 && (
                <button
                  className={`workspace-chip workspace-chip--gold${changedOnly ? ' workspace-chip--active' : ''}`}
                  onClick={() => setChangedOnly((v) => !v)}
                  title="Only fibers changed since the last delta checkpoint"
                >
                  ◇ {counts.changed}
                </button>
              )}
            </div>

            {tagHistogram.length > 0 && (
              <div className="workspace-filters__tags">
                {tagHistogram.map(([tag, count]) => (
                  <button
                    key={tag}
                    className={`workspace-tag${activeTags.has(tag) ? ' workspace-tag--active' : ''}`}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag} <span className="workspace-tag__count">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="workspace-list" role="list">
            <div className="workspace-list__summary">
              {filtered.length === children.length
                ? `${filtered.length} fibers`
                : `${filtered.length} of ${children.length}`}
            </div>
            {filtered.length === 0 && (
              <p className="workspace-empty">No fibers match these filters.</p>
            )}
            {filtered.map((node) => (
              <FiberRow
                key={node.id}
                node={node}
                selected={node.slug === selectedSlug}
                changed={changedIds?.has(node.slug)}
                onSelect={() => onSelect(node.slug)}
                onOpenInNarrative={() => onOpenInNarrative(node.slug)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FiberRow({
  node,
  selected,
  changed,
  onSelect,
  onOpenInNarrative,
}: {
  node: GraphNode;
  selected: boolean;
  changed?: boolean;
  onSelect: () => void;
  onOpenInNarrative: () => void;
}) {
  const status = normalizeStatus(node.status);
  const openDecisions = (node.decisions ?? []).filter((d) => !d.selectedKey).length;
  const outcome = cleanVerdict(node.verdict);

  return (
    <div
      role="listitem"
      className={`fiber-row${selected ? ' fiber-row--selected' : ''}${changed ? ' fiber-row--changed' : ''}${node.tempered ? ' fiber-row--tempered' : ''}`}
      onClick={onSelect}
      onDoubleClick={onOpenInNarrative}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (e.metaKey || e.ctrlKey) onOpenInNarrative();
          else onSelect();
        }
      }}
    >
      <span className={`fiber-row__dot fiber-row__dot--${status}`} title={status}>
        {statusGlyph(node.status)}
      </span>
      <div className="fiber-row__body">
        <div className="fiber-row__title-line">
          <span className="fiber-row__title">{node.label}</span>
          {node.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="fiber-row__tag">{tag}</span>
          ))}
        </div>
        {outcome && <div className="fiber-row__outcome">{outcome}</div>}
      </div>
      <div className="fiber-row__meta">
        {openDecisions > 0 && (
          <span className="fiber-row__metric fiber-row__metric--gold" title={`${openDecisions} open decisions`}>
            ⧖ {openDecisions}
          </span>
        )}
        {(node.findingCount ?? 0) > 0 && (
          <span className="fiber-row__metric" title={`${node.findingCount} findings`}>
            ● {node.findingCount}
          </span>
        )}
        {node.tempered && (
          <span className="fiber-row__metric fiber-row__metric--teal" title="Tempered">⬡</span>
        )}
        <button
          type="button"
          className="fiber-row__open"
          onClick={(e) => {
            e.stopPropagation();
            onOpenInNarrative();
          }}
          title="Open in Narrative"
          aria-label={`Open ${node.label} in Narrative`}
        >
          ↗
        </button>
      </div>
    </div>
  );
}
