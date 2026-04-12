import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMode } from '~/contexts/ModeContext';
import type { GraphLink, GraphNode } from '~/utils/content-types';
import { cleanVerdict, normalizeStatus, statusGlyph } from '~/utils/fiber-status';

const STATUS_ORDER = ['active', 'unresolved', 'blocked', 'open', 'closed', 'suspended'];
const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  open: 'Open',
  closed: 'Closed',
  suspended: 'Suspended',
  resolved: 'Closed',
  unresolved: 'Needs attention',
  blocked: 'Blocked',
};

interface WorkspaceViewProps {
  nodes: GraphNode[];
  links: GraphLink[];
  currentSlug: string;
  changedIds?: Set<string>;
}

type DecisionFilter = 'all' | 'open' | 'resolved';

function hasOpenDecision(node: GraphNode): boolean {
  return (node.decisions ?? []).some((decision) => !decision.selectedKey);
}

export function WorkspaceView({ nodes, links, currentSlug, changedIds }: WorkspaceViewProps) {
  const { setMode } = useMode();
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('all');
  const [temperedOnly, setTemperedOnly] = useState(false);

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

  const filteredChildren = useMemo(() => {
    let result = children;
    if (decisionFilter === 'open') result = result.filter(hasOpenDecision);
    else if (decisionFilter === 'resolved') result = result.filter((node) => !hasOpenDecision(node));
    if (temperedOnly) result = result.filter((node) => node.tempered);
    return result;
  }, [children, decisionFilter, temperedOnly]);

  const sections = useMemo(() => {
    const byStatus = new Map<string, GraphNode[]>();
    for (const node of filteredChildren) {
      const status = normalizeStatus(node.status);
      if (!byStatus.has(status)) byStatus.set(status, []);
      byStatus.get(status)!.push(node);
    }
    return STATUS_ORDER.filter((status) => byStatus.has(status)).map((status) => ({
      status,
      nodes: byStatus.get(status)!,
    }));
  }, [filteredChildren]);

  const counts = useMemo(() => {
    const summary = {
      total: children.length,
      open: 0,
      active: 0,
      closed: 0,
      attention: 0,
      openDecisions: 0,
      tempered: 0,
    };

    for (const node of children) {
      const status = normalizeStatus(node.status);
      if (status === 'open') summary.open++;
      else if (status === 'active') summary.active++;
      else if (status === 'closed') summary.closed++;
      else if (status === 'unresolved' || status === 'blocked') summary.attention++;
      if (hasOpenDecision(node)) summary.openDecisions++;
      if (node.tempered) summary.tempered++;
    }

    return summary;
  }, [children]);

  if (!currentNode) {
    return (
      <div className="vellum-error">
        Fiber <em>{currentSlug}</em> not found.
      </div>
    );
  }

  return (
    <div className="vellum-workspace">
      <div className="workspace-parent">
        <h1 className="workspace-parent__title">{currentNode.label}</h1>
        {cleanVerdict(currentNode.verdict) && (
          <p className="workspace-parent__verdict">{cleanVerdict(currentNode.verdict)}</p>
        )}
        {children.length > 0 && (
          <div className="workspace-parent__counts">
            <span>{counts.total} sub-fibers</span>
            {counts.active > 0 && <span className="workspace-count--active">◐ {counts.active} active</span>}
            {counts.attention > 0 && <span className="workspace-count--open">◈ {counts.attention} attention</span>}
            {counts.open > 0 && <span className="workspace-count--open">○ {counts.open} open</span>}
            {counts.closed > 0 && <span className="workspace-count--closed">● {counts.closed} closed</span>}
          </div>
        )}
        {(counts.openDecisions > 0 || counts.tempered > 0) && (
          <div className="workspace-decision-filter">
            {counts.openDecisions > 0 && (
              <>
                <button
                  className={`workspace-decision-filter__btn${decisionFilter === 'all' ? ' workspace-decision-filter__btn--active' : ''}`}
                  onClick={() => setDecisionFilter('all')}
                >
                  all
                </button>
                <button
                  className={`workspace-decision-filter__btn${decisionFilter === 'open' ? ' workspace-decision-filter__btn--active' : ''}`}
                  onClick={() => setDecisionFilter('open')}
                >
                  ⧖ {counts.openDecisions} open
                </button>
                <button
                  className={`workspace-decision-filter__btn${decisionFilter === 'resolved' ? ' workspace-decision-filter__btn--active' : ''}`}
                  onClick={() => setDecisionFilter('resolved')}
                >
                  resolved
                </button>
              </>
            )}
            {counts.tempered > 0 && (
              <button
                className={`workspace-decision-filter__btn workspace-decision-filter__btn--tempered${temperedOnly ? ' workspace-decision-filter__btn--active' : ''}`}
                onClick={() => setTemperedOnly((value) => !value)}
                title="Show only human-reviewed (tempered) fibers"
              >
                ⬡ {counts.tempered} tempered
              </button>
            )}
          </div>
        )}
      </div>

      {children.length === 0 && (
        <p className="workspace-empty">No sub-fibers. This fiber is a leaf.</p>
      )}
      {children.length > 0 && filteredChildren.length === 0 && (
        <p className="workspace-empty">No fibers match this filter.</p>
      )}

      {sections.map(({ status, nodes: sectionNodes }) => (
        <section key={status} className="workspace-section">
          <h2 className="workspace-section__heading">
            {statusGlyph(status)} {STATUS_LABELS[status]} ({sectionNodes.length})
          </h2>
          {sectionNodes.map((node) => (
            <FiberCard
              key={node.id}
              node={node}
              changed={changedIds?.has(node.slug)}
              onNavigate={() => setMode('narrative')}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function FiberCard({
  node,
  changed,
  onNavigate,
}: {
  node: GraphNode;
  changed?: boolean;
  onNavigate?: () => void;
}) {
  const status = normalizeStatus(node.status);
  const openDecisionCount = (node.decisions ?? []).filter((decision) => !decision.selectedKey).length;

  return (
    <Link
      to={`/${node.slug}`}
      className={`fiber-card${changed ? ' fiber-card--changed' : ''}${node.tempered ? ' fiber-card--tempered' : ''}`}
      onClick={onNavigate}
    >
      <div className="fiber-card__header">
        <span className={`fiber-card__dot fiber-card__dot--${status}`}>
          {statusGlyph(node.status)}
        </span>
        <span className="fiber-card__title">{node.label}</span>
        {node.tempered && <span className="fiber-card__tempered" title="Human-reviewed; load-bearing">⬡</span>}
      </div>
      <div className="fiber-card__meta">
        <span>{node.slug.split('/').pop()}</span>
        {node.tags.length > 0 && <span>{node.tags.slice(0, 3).join(', ')}</span>}
        {node.decisionCount ? <span>{node.decisionCount}d</span> : null}
        {openDecisionCount > 0 ? <span className="fiber-card__open-decisions">⧖ {openDecisionCount} open</span> : null}
        {node.findingCount ? <span>{node.findingCount}f</span> : null}
      </div>
      {cleanVerdict(node.verdict) && <p className="fiber-card__outcome">{cleanVerdict(node.verdict)}</p>}
    </Link>
  );
}
