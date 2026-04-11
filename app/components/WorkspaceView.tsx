/**
 * WorkspaceView — fiber cards scoped to the current fiber's subtree.
 *
 * Shows the current fiber as a summary, then its children grouped by status.
 * If no current fiber or no children, shows all open/active fibers.
 */

import { useMemo, useState } from 'react';
import { Link } from '@remix-run/react';
import { useMode } from '~/contexts/ModeContext';
import type { GraphNode, GraphLink } from '~/utils/content-types';
import {
  cleanVerdict,
  normalizeStatus,
  statusGlyph,
} from '~/utils/fiber-status';

// Display order for the per-status sections. Titlecase labels and the
// "Needs attention" rename for `suspicious` live here because they're
// specific to the Workspace surface — other surfaces render statuses
// verbatim.
const STATUS_ORDER = ['active', 'suspicious', 'blocked', 'open', 'closed', 'suspended'];
const STATUS_LABELS: Record<string, string> = {
  active: 'Active', open: 'Open', closed: 'Closed', suspended: 'Suspended',
  resolved: 'Closed', suspicious: 'Needs attention', blocked: 'Blocked',
};

interface WorkspaceViewProps {
  nodes: GraphNode[];
  links: GraphLink[];
  currentSlug: string;
  changedIds?: Set<string>;
}

type DecisionFilter = 'all' | 'open' | 'resolved';

function hasOpenDecision(node: GraphNode): boolean {
  return (node.decisions ?? []).some((d) => !d.selectedKey);
}

export function WorkspaceView({ nodes, links, currentSlug, changedIds }: WorkspaceViewProps) {
  const { setMode } = useMode();
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('all');
  const [temperedOnly, setTemperedOnly] = useState(false);
  const { currentNode, children } = useMemo(() => {
    const nodeBySlug = new Map(nodes.map((n) => [n.slug, n]));
    const current = nodeBySlug.get(currentSlug);

    // Find direct children via containment links
    const childSlugs = new Set(
      links
        .filter((l) => l.kind === 'contains' && l.source === currentSlug)
        .map((l) => l.target)
    );
    const kids = nodes.filter((n) => childSlugs.has(n.slug));

    return { currentNode: current, children: kids };
  }, [nodes, links, currentSlug]);

  // Filter children by decision status and tempered
  const filteredChildren = useMemo(() => {
    let result = children;
    if (decisionFilter === 'open') result = result.filter(hasOpenDecision);
    else if (decisionFilter === 'resolved') result = result.filter((n) => !hasOpenDecision(n));
    if (temperedOnly) result = result.filter((n) => n.tempered);
    return result;
  }, [children, decisionFilter, temperedOnly]);

  // Group children by normalized status
  const sections = useMemo(() => {
    const byStatus = new Map<string, GraphNode[]>();
    for (const node of filteredChildren) {
      const s = normalizeStatus(node.status);
      if (!byStatus.has(s)) byStatus.set(s, []);
      byStatus.get(s)!.push(node);
    }
    return STATUS_ORDER.filter((s) => byStatus.has(s)).map((s) => ({
      status: s,
      nodes: byStatus.get(s)!,
    }));
  }, [filteredChildren]);

  // Count summary
  const counts = useMemo(() => {
    const c = { total: children.length, open: 0, active: 0, closed: 0, attention: 0, openDecisions: 0, tempered: 0 };
    for (const n of children) {
      const s = normalizeStatus(n.status);
      if (s === 'open') c.open++;
      else if (s === 'active') c.active++;
      else if (s === 'closed') c.closed++;
      else if (s === 'suspicious' || s === 'blocked') c.attention++;
      if (hasOpenDecision(n)) c.openDecisions++;
      if (n.tempered) c.tempered++;
    }
    return c;
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
      {/* Parent summary */}
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
            {counts.openDecisions > 0 && <>
              <button
                className={`workspace-decision-filter__btn${decisionFilter === 'all' ? ' workspace-decision-filter__btn--active' : ''}`}
                onClick={() => setDecisionFilter('all')}
              >all</button>
              <button
                className={`workspace-decision-filter__btn${decisionFilter === 'open' ? ' workspace-decision-filter__btn--active' : ''}`}
                onClick={() => setDecisionFilter('open')}
              >◇ {counts.openDecisions} open</button>
              <button
                className={`workspace-decision-filter__btn${decisionFilter === 'resolved' ? ' workspace-decision-filter__btn--active' : ''}`}
                onClick={() => setDecisionFilter('resolved')}
              >resolved</button>
            </>}
            {counts.tempered > 0 && (
              <button
                className={`workspace-decision-filter__btn workspace-decision-filter__btn--tempered${temperedOnly ? ' workspace-decision-filter__btn--active' : ''}`}
                onClick={() => setTemperedOnly((v) => !v)}
                title="Show only human-reviewed (tempered) fibers"
              >⬡ {counts.tempered} tempered</button>
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

      {/* Children grouped by status */}
      {sections.map(({ status, nodes: sectionNodes }) => (
        <section key={status} className="workspace-section">
          <h2 className="workspace-section__heading">
            {statusGlyph(status)} {STATUS_LABELS[status]} ({sectionNodes.length})
          </h2>
          {sectionNodes.map((node) => (
            <FiberCard key={node.id} node={node} changed={changedIds?.has(node.slug)} onNavigate={() => setMode('narrative')} />
          ))}
        </section>
      ))}
    </div>
  );
}

function FiberCard({ node, changed, onNavigate }: { node: GraphNode; changed?: boolean; onNavigate?: () => void }) {
  const status = normalizeStatus(node.status);
  const openDecisionCount = (node.decisions ?? []).filter((d) => !d.selectedKey).length;
  return (
    <Link to={`/${node.slug}`} className={`fiber-card${changed ? ' fiber-card--changed' : ''}${node.tempered ? ' fiber-card--tempered' : ''}`} onClick={onNavigate}>
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
        {openDecisionCount > 0 ? <span className="fiber-card__open-decisions">◇ {openDecisionCount} open</span> : null}
        {node.findingCount ? <span>{node.findingCount}f</span> : null}
      </div>
      {cleanVerdict(node.verdict) && (
        <p className="fiber-card__outcome">{cleanVerdict(node.verdict)}</p>
      )}
    </Link>
  );
}
