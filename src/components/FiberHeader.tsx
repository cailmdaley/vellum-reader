/**
 * FiberHeader — just the title. All metadata (status, tags, lede)
 * lives in the thumb index panel, not in the prose column.
 */

import type { GraphNode } from '~/utils/content-types';

interface FiberHeaderProps {
  frontmatter: Record<string, any>;
  graphNode?: GraphNode;
  lede?: string | null;
}

export function FiberHeader({ frontmatter, graphNode }: FiberHeaderProps) {
  const title = frontmatter.title ?? graphNode?.label ?? 'Untitled';

  return (
    <div className="vellum-fiber-header">
      <h1 className="vellum-fiber-header__title">{title}</h1>
    </div>
  );
}
