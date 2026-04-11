/**
 * FiberHeader — renders a fiber's frontmatter as a styled title block.
 * Sits above the prose body within the prose column.
 */

import type { GraphNode } from '~/utils/content-types';

const STATUS_GLYPHS: Record<string, string> = {
  open: '○', active: '◐', closed: '●', suspended: '·',
  resolved: '●', suspicious: '◈', blocked: '✕',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'open', active: 'active', closed: 'closed', suspended: 'suspended',
  resolved: 'resolved', suspicious: 'suspicious', blocked: 'blocked',
};

interface FiberHeaderProps {
  frontmatter: Record<string, any>;
  graphNode?: GraphNode;
  /** Full lede text extracted from mdast blockquote (graph verdict is truncated). */
  lede?: string | null;
}

export function FiberHeader({ frontmatter, graphNode, lede: extractedLede }: FiberHeaderProps) {
  const title = frontmatter.title ?? graphNode?.label ?? 'Untitled';
  const status = frontmatter.status ?? graphNode?.status ?? 'open';
  const tags: string[] = frontmatter.tags ?? graphNode?.tags ?? [];

  // Show lede only from mdast extraction or explicit outcome — not graph verdict,
  // which can be auto-derived from decision rationale and read as nonsensical lede.
  const verdict = extractedLede ?? frontmatter.outcome;
  const lede = verdict?.replace(/^>\s*/, '').trim();

  const glyph = STATUS_GLYPHS[status] ?? '○';
  const statusLabel = STATUS_LABELS[status] ?? status;

  return (
    <div className="vellum-fiber-header">
      <h1 className="vellum-fiber-header__title">{title}</h1>
      <div className="vellum-fiber-header__meta">
        <span className="vellum-fiber-header__status">
          <span>{glyph}</span>
          <span>{statusLabel}</span>
        </span>
        {tags.map((tag) => (
          <span key={tag} className="vellum-tag">{tag}</span>
        ))}
        {graphNode?.tempered && (
          <span className="vellum-tempered-badge" title="Human-reviewed; load-bearing">⬡ tempered</span>
        )}
        {graphNode?.hasASTRA && (
          <a href="#astra-blocks" className="vellum-astra-badge" title="Structured ASTRA data below">
            {graphNode.decisionCount ? `${graphNode.decisionCount}d` : ''}
            {graphNode.findingCount ? `${graphNode.decisionCount ? ' ' : ''}${graphNode.findingCount}f` : ''}
          </a>
        )}
      </div>
      {lede && (
        <blockquote className="vellum-fiber-header__lede">
          <p>{lede}</p>
        </blockquote>
      )}
    </div>
  );
}
