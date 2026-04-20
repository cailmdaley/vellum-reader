/**
 * FiberHeader — just the name. All metadata (status, tags, lede)
 * lives in the thumb index panel, not in the prose column.
 */

import type { GraphNode } from '~/utils/content-types';

interface FiberHeaderProps {
  frontmatter: Record<string, any>;
  graphNode?: GraphNode;
  lede?: string | null;
}

export function FiberHeader({ frontmatter, graphNode }: FiberHeaderProps) {
  const name = frontmatter.name ?? graphNode?.label ?? 'Untitled';

  return (
    <div className="vellum-fiber-header">
      <h1 className="vellum-fiber-header__title">{name}</h1>
    </div>
  );
}
