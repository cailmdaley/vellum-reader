/**
 * structured-anchor — parse + resolve structured anchor hrefs used inside narrative prose.
 *
 * Grammar (tree-path-first, see narrative-overnight constitution §2):
 *   #inputs.<id>
 *   #outputs.<id>
 *   #decisions.<id>
 *   #decisions.<id>.options.<optId>
 *   #findings.<id>
 *   #prior_insights.<id>
 *   #analyses.<sub>
 *   #<sub>.<category>.<id>              (element inside a sub-analysis)
 *   #../…                               (escape to parent scope, may chain)
 *
 * For Pass 1 the renderer only needs two things out of each href:
 *
 *   1. A kind — which controls the right-margin glyph, the inline-link
 *      color, and the legend entry.
 *   2. Enough of an identifier to look up in the current page's GraphNode
 *      so we can tell broken anchors (renders as inert + broken-link icon)
 *      from live ones (renders as normal link + glyph).
 *
 * Sub-analysis traversal (`#<sub>.category.id`) and parent-scope escaping
 * (`../`) are out of scope for the root-page view because the graph
 * currently surfaces the root analysis only. Those paths still parse to a
 * kind and display a glyph, but lookup returns `broken`.
 */

import type { GraphNode } from './content-types';

export type StructuredAnchorKind =
  | 'findings'
  | 'decisions'
  | 'outputs'
  | 'inputs'
  | 'analyses';

/** Raw category tokens that collapse to the `findings` kind — schema
 *  aliases for the same claim-with-evidence family. `prior_insights` is
 *  a legacy spelling retained for backward compatibility. */
const FINDING_KIND_ALIASES = new Set(['findings', 'prior_insights']);

/** All recognized first-path-segment categories. */
const KNOWN_KINDS = new Set([
  'findings',
  'prior_insights',
  'decisions',
  'outputs',
  'inputs',
  'analyses',
]);

export interface ParsedStructuredAnchor {
  /** Normalized kind. `prior_insights` collapses to `findings` — they share the glyph family. */
  kind: StructuredAnchorKind;
  /** Raw category token from the href before normalization (keeps `prior_insights` visible). */
  rawKind: string;
  /** Identifier at the category level, e.g. `bao_detection_highest_significance`. */
  id: string;
  /** Optional decision-option id, when the href is `#decisions.x.options.y`. */
  optionId?: string;
  /** Remaining segments after kind.id — used for sub-analysis element paths. */
  trailing?: string[];
  /**
   * Number of `../` escapes seen at the start of the href. 0 for anchors on
   * the current scope. Non-zero values traverse parent scopes and are not
   * resolvable against a single GraphNode — they render as broken on the
   * root page.
   */
  parentEscapes: number;
}

/**
 * Parse a markdown href into an structured anchor descriptor. Returns `null` when
 * the href isn't an structured anchor (e.g. wikilink, external URL). Returns
 * `{broken: true}` when the href is shaped like an anchor but doesn't match
 * the grammar — the renderer still draws a broken-link icon in that case.
 */
export function parseStructuredAnchor(href: string | null | undefined): ParsedStructuredAnchor | null {
  if (!href) return null;

  let rest = href;
  let parentEscapes = 0;

  // Must be an in-document anchor.
  if (!rest.startsWith('#')) return null;

  // Drop the `#` first. Per structured-spec canonical form, `../` escapes live
  // *inside* the fragment (e.g. `#../decisions.id`), so we consume leading
  // `../` from the body after the `#` has been stripped. `../` may chain for
  // multi-level escapes.
  rest = rest.slice(1);
  while (rest.startsWith('../')) {
    parentEscapes++;
    rest = rest.slice(3);
  }

  // Split on `.`. A valid structured anchor has at least two segments
  // (category.id). A single-segment anchor like `#abstract` is a heading
  // anchor rendered by mystra's felt loader and is handled by the ordinary
  // link path, not by this module.
  const body = rest;
  if (!body) return null;
  const segments = body.split('.');
  if (segments.length < 2) return null;

  const [head, id, ...trailing] = segments;

  // Case 1: top-level category (`findings`, `decisions`, ...).
  if (KNOWN_KINDS.has(head)) {
    const rawKind = head;
    const kind: StructuredAnchorKind = FINDING_KIND_ALIASES.has(head)
      ? 'findings'
      : (head as StructuredAnchorKind);
    let optionId: string | undefined;
    let trailingOut: string[] | undefined;
    if (rawKind === 'decisions' && trailing[0] === 'options' && trailing[1]) {
      optionId = trailing[1];
      if (trailing.length > 2) trailingOut = trailing.slice(2);
    } else if (trailing.length > 0) {
      trailingOut = trailing;
    }
    return {
      kind,
      rawKind,
      id,
      optionId,
      trailing: trailingOut,
      parentEscapes,
    };
  }

  // Case 2: sub-analysis scoped reference — `#<sub>.<category>.<id>`. The
  // head is a sub-analysis slug; the second segment is the category; the
  // third and beyond are the element id plus optional trailing path.
  if (trailing.length > 0 && KNOWN_KINDS.has(id)) {
    const rawKind = id;
    const kind: StructuredAnchorKind = FINDING_KIND_ALIASES.has(id)
      ? 'findings'
      : (id as StructuredAnchorKind);
    const [innerId, ...innerTrailing] = trailing;
    return {
      kind,
      rawKind,
      id: innerId,
      trailing: innerTrailing.length > 0 ? [head, ...innerTrailing] : [head],
      parentEscapes,
    };
  }

  return null;
}

/**
 * Symbol glyph per kind — unified with card typography (Weathered Substrate).
 * Paired with KIND_LEGEND to render `symbol + kind-name` in the margin so the
 * word teaches the glyph.
 *
 * `⧗` on analyses is the Lightcone glyph: two cones meeting at a point.
 * A sub-analysis is a contained world with its own past and future, so
 * the lightcone shape is the semantic match for "scope."
 */
export const KIND_SYMBOL: Record<StructuredAnchorKind, string> = {
  findings: '●',
  decisions: '◇',
  outputs: '▸',
  inputs: '◂',
  analyses: '⧗',
};

/** Human-readable legend label (singular, title-cased). */
export const KIND_LEGEND: Record<StructuredAnchorKind, string> = {
  findings: 'Finding',
  decisions: 'Decision',
  outputs: 'Output',
  inputs: 'Input',
  analyses: 'Sub-analysis',
};

/**
 * Does the graph contain *any* node hosting `kind.id`? Used as the off-page
 * fallback during anchor resolution: a ref that doesn't resolve against the
 * current node may still resolve via the `NarrativeView` click handler's
 * graph walk (see `findHostForStructuredRef`), in which case it should render
 * live, not broken. Without this, cross-analysis refs get false-positive
 * broken dashes in MarginCitations even though clicking them navigates fine.
 *
 * Decisions/findings key by `.key`; inputs/outputs by `.id` — mirrors the
 * click-path resolver in `NarrativeView.tsx`.
 */
function structuredRefHasHostInGraph(
  kind: StructuredAnchorKind,
  id: string,
  graphNodes: readonly GraphNode[],
): boolean {
  for (const n of graphNodes) {
    if (kind === 'decisions' && n.decisions?.some((d) => d.key === id)) return true;
    if (kind === 'findings' && n.findings?.some((f) => f.key === id)) return true;
    if (kind === 'outputs' && n.outputs?.some((o) => o.id === id)) return true;
    if (kind === 'inputs' && n.inputs?.some((i) => i.id === id)) return true;
    // `analyses` is resolved via sub-key sets, not graph walk.
  }
  return false;
}

/**
 * Check whether an structured anchor resolves against the current page's
 * GraphNode. Returns `null` when resolved (anchor is live) or a reason
 * string when the anchor is broken.
 *
 * Root-level anchors (`#findings.<id>`, `#decisions.<id>`, ...) look up
 * against the node's own structured fields. `#analyses.<key>` resolves
 * against the caller-supplied `childSubKeys` set — typically derived from
 * graph `contains` edges originating at the current node.
 * `../analyses.<key>` escapes one level up and resolves against
 * `parentSubKeys` — sibling sub-analyses of the current node.
 *
 * When `graphNodes` is supplied, a ref that doesn't resolve locally still
 * resolves live if *any* node in the graph hosts `kind.id`. This mirrors
 * `NarrativeView`'s click-path graph-walk fallback so the visual broken
 * affordance stays consistent with click behavior.
 */
export function resolveStructuredAnchor(
  parsed: ParsedStructuredAnchor,
  node: Pick<GraphNode, 'findings' | 'decisions' | 'inputs' | 'outputs'>,
  childSubKeys?: Set<string>,
  parentSubKeys?: Set<string>,
  graphNodes?: readonly GraphNode[],
): string | null {
  if (parsed.parentEscapes > 0) {
    if (parsed.parentEscapes > 1) {
      return 'Multi-level parent escape not resolvable on this page';
    }
    if (parsed.kind !== 'analyses') {
      return 'Parent-scope anchor only supported for #analyses on this page';
    }
    if (!parentSubKeys) {
      return 'No parent scope (this page is not a sub-analysis)';
    }
    return parentSubKeys.has(parsed.id)
      ? null
      : `No sibling sub-analysis "${parsed.id}"`;
  }
  // Sub-analysis trailing paths are not resolvable against a root-only node.
  if (parsed.trailing && parsed.trailing.length > 0 && parsed.kind !== 'analyses') {
    return 'Sub-analysis element not resolvable on this page';
  }
  // Local resolution, with graph-walk as off-page fallback for the four
  // kinds whose click handler also falls back to the graph. An optionId on
  // decisions must still match locally — the graph walk only confirms the
  // decision exists somewhere, not that the specific option does — so a
  // cross-analysis option ref stays broken. That's the honest signal:
  // clicking it would land on the decision, not the option.
  switch (parsed.kind) {
    case 'findings': {
      if (node.findings?.some((f) => f.key === parsed.id)) return null;
      if (graphNodes && structuredRefHasHostInGraph('findings', parsed.id, graphNodes)) return null;
      return `No finding "${parsed.id}"`;
    }
    case 'decisions': {
      const decision = node.decisions?.find((d) => d.key === parsed.id);
      if (decision) {
        if (parsed.optionId) {
          const hit =
            decision.selectedKey === parsed.optionId ||
            decision.excluded.some((e) => e.key === parsed.optionId);
          if (!hit) return `No option "${parsed.optionId}" on decision "${parsed.id}"`;
        }
        return null;
      }
      if (
        !parsed.optionId &&
        graphNodes &&
        structuredRefHasHostInGraph('decisions', parsed.id, graphNodes)
      ) {
        return null;
      }
      return `No decision "${parsed.id}"`;
    }
    case 'outputs': {
      if (node.outputs?.some((o) => o.id === parsed.id)) return null;
      if (graphNodes && structuredRefHasHostInGraph('outputs', parsed.id, graphNodes)) return null;
      return `No output "${parsed.id}"`;
    }
    case 'inputs': {
      if (node.inputs?.some((i) => i.id === parsed.id)) return null;
      if (graphNodes && structuredRefHasHostInGraph('inputs', parsed.id, graphNodes)) return null;
      return `No input "${parsed.id}"`;
    }
    case 'analyses':
      if (!childSubKeys) return 'Sub-analysis lookup pending';
      return childSubKeys.has(parsed.id) ? null : `No sub-analysis "${parsed.id}"`;
  }
}

/**
 * Walk an mdast tree and return the set of structured anchor kinds that appear
 * inside its link nodes. Used by the legend at the top of the narrative
 * page so kinds not referenced on this page stay hidden.
 */
export function collectStructuredAnchorKinds(mdast: any): StructuredAnchorKind[] {
  const seen = new Set<StructuredAnchorKind>();
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'link' && typeof node.url === 'string') {
      const parsed = parseStructuredAnchor(node.url);
      if (parsed) seen.add(parsed.kind);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };
  visit(mdast);
  return Array.from(seen);
}

/**
 * Resolve a label to show next to the margin glyph. Prefers the entry's
 * own label / id; falls back to the anchor id for broken links.
 *
 * `subAnalysisLabels` maps child sub-analysis keys to their display labels
 * (derived from graph nodes at `{currentSlug}/analyses/<key>`). Passed in so
 * the margin glyph for `#analyses.bao_fitting` can read "BAO Fitting"
 * rather than the raw key. `parentSubLabels` is the parent-scope-escape
 * mirror — labels for sibling sub-analyses reachable via `../analyses.<key>`.
 */
export function resolveStructuredLabel(
  parsed: ParsedStructuredAnchor,
  node: Pick<GraphNode, 'findings' | 'decisions' | 'inputs' | 'outputs'>,
  subAnalysisLabels?: Map<string, string>,
  parentSubLabels?: Map<string, string>,
): string {
  if (parsed.parentEscapes > 0 && parsed.kind === 'analyses') {
    return parentSubLabels?.get(parsed.id) ?? parsed.id;
  }
  switch (parsed.kind) {
    case 'findings': {
      // `label?` added to findings/insights by structured-spec feature/narrative
      // (see GraphFinding in content-types.ts). Margin chip + ToC rail
      // resolve `label ?? key` per themes-constitution §6. Without this
      // the chip falls back to the raw snake_case id
      // (e.g. `bao_detection_highest_significance`) which tanks
      // margin-scan legibility under `lightcone-margin`'s label-caret
      // chip shape.
      const finding = node.findings?.find((f) => f.key === parsed.id);
      return finding?.label ?? parsed.id;
    }
    case 'decisions': {
      const decision = node.decisions?.find((d) => d.key === parsed.id);
      if (!decision) return parsed.id;
      if (parsed.optionId) {
        if (decision.selectedKey === parsed.optionId) return `${decision.label}: ${decision.selectedLabel ?? parsed.optionId}`;
        const ex = decision.excluded.find((e) => e.key === parsed.optionId);
        if (ex) return `${decision.label}: ${ex.label}`;
      }
      return decision.label ?? parsed.id;
    }
    case 'outputs': {
      const output = node.outputs?.find((o) => o.id === parsed.id);
      return output?.label ?? output?.id ?? parsed.id;
    }
    case 'inputs': {
      const input = node.inputs?.find((i) => i.id === parsed.id);
      return input?.label ?? input?.id ?? parsed.id;
    }
    case 'analyses':
      return subAnalysisLabels?.get(parsed.id) ?? parsed.id;
  }
}
