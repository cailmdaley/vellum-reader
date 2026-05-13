/**
 * collect-figures — walk a GraphNode's outputs + finding evidence to produce
 * a flat, ordered list of figures keyed by the structured anchor that points at
 * them.
 *
 * Two host shapes produce figures today (see `content-types.ts`):
 *
 *   1. `GraphOutput` with `kind === 'figure'`. The `id` IS the static
 *      artifact filename; the thumbnail URL is `/static/<slug>/<id>`.
 *      Anchor: `#outputs.<id>`. Host label: `label ?? id`. Caption:
 *      `description` (structured outputs carry their caption as `description`).
 *   2. `GraphEvidence` with `kind === 'figure'` and an `artifact` pointer,
 *      nested inside `GraphFinding.evidence`. The thumbnail URL is
 *      `/static/<slug>/<artifact>`. Anchor: `#findings.<finding.key>`.
 *      Host label: `figure?.label ?? artifact`. Caption: `figure?.caption`.
 *
 * The anchor is the join key between a figure and the prose ref that cites
 * it. Callers that want per-anchor marginalia can index by `anchor`; callers
 * that want a bottom-of-page gallery can iterate the list directly.
 *
 * A single finding may carry multiple figure-kind evidence entries (a
 * corner-panel posterior, a ratio plot, etc.). Each becomes its own
 * `CollectedFigure`; order within the finding is preserved. Finding-level
 * figures sort before output-level figures only incidentally — the two
 * sources are concatenated in the order outputs → finding-evidence. Most
 * analyses don't have both kinds, so this is rarely observable.
 *
 * Pass 9b step 6 prep. Consumed by (a) a future `MarginCitations` figure
 * adapter that renders small thumbnails at the anchor's line-Y under
 * `lightcone-margin`, and (b) a section-end `FigureGallery` under both
 * `lightcone-margin` (overflow) and `lightcone-linear` (grouped under
 * the owning finding/output). See [[vellum-reader/themes-constitution]]
 * desired-state §4 + §3 for the theme split.
 */

import type { GraphEvidence, GraphFinding, GraphNode, GraphOutput } from './content-types';

export type CollectedFigureHost =
  | { kind: 'output'; id: string; output: GraphOutput }
  | { kind: 'finding'; key: string; evidenceId: string; finding: GraphFinding; evidence: GraphEvidence };

export interface CollectedFigure {
  /** structured anchor that points at this figure's host. Used as the join key
   *  against inline-ref marginalia — `#outputs.<id>` or `#findings.<key>`. */
  anchor: string;
  /** Thumbnail URL (matches the paths Card.tsx already uses at ll. 630, 837). */
  src: string;
  /** Alt text: caption → label → artifact, in that order. Non-empty. */
  alt: string;
  /** Optional long-form caption, for gallery captions. */
  caption?: string;
  /** Compact display label for margin chip / gallery caption strip. */
  label: string;
  /** Raw artifact filename — the thing appended to `/static/<slug>/`. */
  artifact: string;
  host: CollectedFigureHost;
}

/**
 * Collect every figure hanging off a graph node's outputs + finding
 * evidence. Returns an empty list when the node is missing, has no
 * figures, or isn't an structured node at all. Stable: call order ==
 * structured authoring order within each source bucket.
 */
export function collectFigures(node: GraphNode | null | undefined): CollectedFigure[] {
  if (!node) return [];
  const slug = node.slug;
  const figures: CollectedFigure[] = [];

  for (const output of node.outputs ?? []) {
    if (output.kind !== 'figure' || !output.id) continue;
    const label = output.label ?? output.id;
    figures.push({
      anchor: `#outputs.${output.id}`,
      src: `/static/${slug}/${output.id}`,
      alt: output.description ?? label,
      caption: output.description,
      label,
      artifact: output.id,
      host: { kind: 'output', id: output.id, output },
    });
  }

  for (const finding of node.findings ?? []) {
    for (const ev of finding.evidence ?? []) {
      if (ev.kind !== 'figure' || !ev.artifact) continue;
      const label = ev.figure?.label ?? ev.artifact;
      figures.push({
        anchor: `#findings.${finding.key}`,
        src: `/static/${slug}/${ev.artifact}`,
        alt: ev.figure?.caption ?? label,
        caption: ev.figure?.caption,
        label,
        artifact: ev.artifact,
        host: { kind: 'finding', key: finding.key, evidenceId: ev.id, finding, evidence: ev },
      });
    }
  }

  return figures;
}

/**
 * Index a CollectedFigure list by anchor. Returns a Map whose value is
 * the array of figures sharing that anchor (multiple finding-evidence
 * figures per finding, or an output anchor that happens to also carry
 * finding evidence). Iteration order follows Map insertion order, which
 * mirrors `collectFigures` return order.
 */
export function indexFiguresByAnchor(figures: CollectedFigure[]): Map<string, CollectedFigure[]> {
  const map = new Map<string, CollectedFigure[]>();
  for (const fig of figures) {
    const bucket = map.get(fig.anchor);
    if (bucket) bucket.push(fig);
    else map.set(fig.anchor, [fig]);
  }
  return map;
}
