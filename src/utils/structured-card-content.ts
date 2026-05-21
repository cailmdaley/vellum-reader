/**
 * structured-card-content — map a parsed structured anchor to the unified Card primitive.
 *
 * Shared by margin hover and click surfaces so both render the same card for
 * the same anchor.
 */

import type { ParsedStructuredAnchor } from './structured-anchor';
import type { GraphNode } from './content-types';
import type { CardContent } from '~/components/Card';

export function resolveStructuredCardContent(
  parsed: ParsedStructuredAnchor,
  currentNode: GraphNode | null | undefined,
  nodes: GraphNode[],
  parentSubSlugs?: Map<string, string>,
): CardContent | null {
  if (!currentNode) return null;
  switch (parsed.kind) {
    case 'decisions': {
      const decision = currentNode.decisions?.find((d) => d.key === parsed.id);
      return decision ? { type: 'decision', decision, hostSlug: currentNode.slug } : null;
    }
    case 'findings': {
      const finding = currentNode.findings?.find((f) => f.key === parsed.id);
      return finding
        ? { type: 'finding', finding, hostSlug: currentNode.slug, hostNode: currentNode }
        : null;
    }
    case 'outputs': {
      const output = currentNode.outputs?.find((o) => o.id === parsed.id);
      return output ? { type: 'output', output, hostNode: currentNode } : null;
    }
    case 'inputs': {
      const input = currentNode.inputs?.find((i) => i.id === parsed.id);
      return input ? { type: 'input', input, hostNode: currentNode } : null;
    }
    case 'analyses': {
      const targetSlug = parsed.parentEscapes > 0
        ? parentSubSlugs?.get(parsed.id) ?? null
        : `${currentNode.slug}/analyses/${parsed.id}`;
      if (!targetSlug) return null;
      const sub = nodes.find((n) => n.slug === targetSlug);
      return sub ? { type: 'fiber', node: sub } : null;
    }
  }
}
