// myst-to-react's MyST component uses `node.key` as the React key when
// mapping over children (see myst-to-react/dist/MyST.js). Mdast coming from
// remark or myst parsers doesn't carry `.key`, so every render surfaces a
// "unique 'key' prop" warning. This walker assigns a stable, structural
// key (dotted path from the root) to every node in place.
//
// Stable structural keys are fine for React reconciliation here: the tree
// shape doesn't mutate between renders — we memoize the parsed mdast and
// reuse the same object — so sibling order is the identity that matters.

export function assignMdastKeys<T extends { children?: any[]; key?: string }>(
  node: T,
  prefix = 'm',
): T {
  if (!node || typeof node !== 'object') return node;
  if (!node.key) node.key = prefix;
  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i += 1) {
      assignMdastKeys(node.children[i], `${prefix}.${i}`);
    }
  }
  return node;
}
