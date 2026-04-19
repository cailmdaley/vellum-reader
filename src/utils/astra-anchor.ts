/**
 * astra-anchor — parse + resolve ASTRA anchor hrefs used inside narrative prose.
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
 *   ../#…                               (escape to parent scope, may chain)
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

export type AstraAnchorKind =
  | 'findings'
  | 'decisions'
  | 'outputs'
  | 'inputs'
  | 'analyses';

/** Set of raw category names that share the "claim-with-evidence" family. */
const INSIGHT_KINDS = new Set(['findings', 'prior_insights']);

/** All recognized first-path-segment categories. */
const KNOWN_KINDS = new Set([
  'findings',
  'prior_insights',
  'decisions',
  'outputs',
  'inputs',
  'analyses',
]);

export interface ParsedAstraAnchor {
  /** Normalized kind. `prior_insights` collapses to `findings` — they share the glyph family. */
  kind: AstraAnchorKind;
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
 * Parse a markdown href into an ASTRA anchor descriptor. Returns `null` when
 * the href isn't an ASTRA anchor (e.g. wikilink, external URL). Returns
 * `{broken: true}` when the href is shaped like an anchor but doesn't match
 * the grammar — the renderer still draws a broken-link icon in that case.
 */
export function parseAstraAnchor(href: string | null | undefined): ParsedAstraAnchor | null {
  if (!href) return null;

  let rest = href;
  let parentEscapes = 0;

  // `../` may chain at the head of the href, before the `#`. In practice the
  // authoring examples show `../#decisions.id`, so we consume leading `../`
  // before the fragment start.
  while (rest.startsWith('../')) {
    parentEscapes++;
    rest = rest.slice(3);
  }

  // Must be an in-document anchor at this point.
  if (!rest.startsWith('#')) return null;

  // Drop the `#`, split on `.`. A valid ASTRA anchor has at least two
  // segments (category.id). A single-segment anchor like `#abstract` is a
  // heading anchor rendered by mystra's felt loader and is handled by the
  // ordinary link path, not by this module.
  const body = rest.slice(1);
  if (!body) return null;
  const segments = body.split('.');
  if (segments.length < 2) return null;

  const [head, id, ...trailing] = segments;

  // Case 1: top-level category (`findings`, `decisions`, ...).
  if (KNOWN_KINDS.has(head)) {
    const rawKind = head;
    const kind: AstraAnchorKind = INSIGHT_KINDS.has(head)
      ? 'findings'
      : (head as AstraAnchorKind);
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
    const kind: AstraAnchorKind = INSIGHT_KINDS.has(id)
      ? 'findings'
      : (id as AstraAnchorKind);
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
 * Single-character letter glyph per kind (constitution §2 legend: `letters
 * are one rendering; full-word chips are another. Pick one.`). We pick
 * letters — they stay scannable at body-text opacity.
 */
export const KIND_LETTER: Record<AstraAnchorKind, string> = {
  findings: 'F',
  decisions: 'D',
  outputs: 'O',
  inputs: 'I',
  analyses: 'A',
};

/** Human-readable legend label (singular, title-cased). */
export const KIND_LEGEND: Record<AstraAnchorKind, string> = {
  findings: 'Finding',
  decisions: 'Decision',
  outputs: 'Output',
  inputs: 'Input',
  analyses: 'Sub-analysis',
};

/**
 * Check whether an ASTRA anchor resolves against the root astra-project's
 * GraphNode. Returns `null` when resolved (anchor is live) or a reason
 * string when the anchor is broken.
 *
 * Pass 1 surfaces only the root-level lookup: `#findings.<id>`,
 * `#decisions.<id>`, `#inputs.<id>`, `#outputs.<id>`. Anchors that reach
 * into sub-analyses (`#<sub>.category.id`) or escape parent scope (`../`)
 * render with a broken-link icon; Pass 2+ can wire them to the full tree.
 */
export function resolveAstraAnchor(
  parsed: ParsedAstraAnchor,
  node: Pick<GraphNode, 'findings' | 'decisions' | 'inputs' | 'outputs'>,
): string | null {
  if (parsed.parentEscapes > 0) return 'Parent-scope anchor not resolvable on this page';
  // Sub-analysis trailing paths are not resolvable against a root-only node.
  if (parsed.trailing && parsed.trailing.length > 0 && parsed.kind !== 'analyses') {
    return 'Sub-analysis element not resolvable on this page';
  }
  switch (parsed.kind) {
    case 'findings':
      return node.findings?.some((f) => f.key === parsed.id)
        ? null
        : `No finding "${parsed.id}"`;
    case 'decisions': {
      const decision = node.decisions?.find((d) => d.key === parsed.id);
      if (!decision) return `No decision "${parsed.id}"`;
      if (parsed.optionId) {
        const hit =
          decision.selectedKey === parsed.optionId ||
          decision.excluded.some((e) => e.key === parsed.optionId);
        if (!hit) return `No option "${parsed.optionId}" on decision "${parsed.id}"`;
      }
      return null;
    }
    case 'outputs':
      return node.outputs?.some((o) => o.id === parsed.id)
        ? null
        : `No output "${parsed.id}"`;
    case 'inputs':
      return node.inputs?.some((i) => i.id === parsed.id)
        ? null
        : `No input "${parsed.id}"`;
    case 'analyses':
      // Sub-analysis presence lives on graphLinks rather than the root node.
      // The caller (MarginCitations) resolves this by checking containment
      // edges and passes a pre-computed set; when no set is provided, treat
      // as broken so the glyph signals "not yet surfaced".
      return 'Sub-analysis lookup pending';
  }
}

/**
 * Walk an mdast tree and return the set of ASTRA anchor kinds that appear
 * inside its link nodes. Used by the legend at the top of the narrative
 * page so kinds not referenced on this page stay hidden.
 */
export function collectAstraAnchorKinds(mdast: any): AstraAnchorKind[] {
  const seen = new Set<AstraAnchorKind>();
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'link' && typeof node.url === 'string') {
      const parsed = parseAstraAnchor(node.url);
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
 */
export function resolveAstraLabel(
  parsed: ParsedAstraAnchor,
  node: Pick<GraphNode, 'findings' | 'decisions' | 'inputs' | 'outputs'>,
): string {
  switch (parsed.kind) {
    case 'findings':
      return parsed.id;
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
    case 'outputs':
      return node.outputs?.find((o) => o.id === parsed.id)?.id ?? parsed.id;
    case 'inputs':
      return node.inputs?.find((i) => i.id === parsed.id)?.id ?? parsed.id;
    case 'analyses':
      return parsed.id;
  }
}
