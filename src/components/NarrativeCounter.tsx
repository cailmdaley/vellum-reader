/**
 * NarrativeCounter — marginalia table-of-contents next to the FiberHeader.
 *
 * One row per ASTRA kind present on the current fiber (findings,
 * decisions, outputs, inputs, analyses) plus outgoing refs. Each row is
 * a count; clicking jumps to that kind's section in the appendix.
 * Lives in the right-margin canvas column, absolutely positioned inside
 * the prose wrapper so it scrolls with the page — unlike the fixed
 * thumb-index above it. Replaces both the older inline `AstraLegend`
 * kind-strip and the short-lived `PageMeta` nav sub-panel.
 *
 * Hidden on narrow viewports (≤960px) since the thumb-index itself
 * goes away there — the counter has no column to sit in.
 */

import type { GraphNode } from '~/utils/content-types';

type Kind = 'findings' | 'decisions' | 'outputs' | 'inputs' | 'analyses';

const KIND_ORDER: Kind[] = ['findings', 'decisions', 'outputs', 'inputs', 'analyses'];

// Unified with MarginCitations / AstraLegend (see utils/astra-anchor
// KIND_SYMBOL). `⧗` on analyses is the Lightcone glyph — two cones
// meeting at a point, matching "sub-analysis = contained scope."
const KIND_GLYPH: Record<Kind, string> = {
  findings:  '●',
  decisions: '◇',
  outputs:   '▸',
  inputs:    '◂',
  analyses:  '⧗',
};

const KIND_LABEL_PLURAL: Record<Kind, string> = {
  findings:  'findings',
  decisions: 'decisions',
  outputs:   'outputs',
  inputs:    'inputs',
  analyses:  'analyses',
};

const KIND_LABEL_SINGULAR: Record<Kind, string> = {
  findings:  'finding',
  decisions: 'decision',
  outputs:   'output',
  inputs:    'input',
  analyses:  'analysis',
};

interface NarrativeCounterProps {
  node?: GraphNode;
  /** Outgoing `cites` targets — fibers this page wiki-links to. */
  refCount: number;
  /** Sub-analyses this fiber contains (`contains` graph edges). */
  analysisCount: number;
}

export function NarrativeCounter({ node, refCount, analysisCount }: NarrativeCounterProps) {
  if (!node) return null;

  const countsByKind: Record<Kind, number> = {
    findings:  node.findings?.length  ?? 0,
    decisions: node.decisions?.length ?? 0,
    outputs:   node.outputs?.length   ?? 0,
    inputs:    node.inputs?.length    ?? 0,
    analyses:  analysisCount,
  };

  const visibleKinds = KIND_ORDER.filter((k) => countsByKind[k] > 0);
  if (visibleKinds.length === 0 && refCount === 0) return null;

  const scrollTo = (id: string) => {
    const el = document.getElementById(id) ?? document.getElementById('astra-appendix');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Analyses have no dedicated appendix section (sub-analyses are their
  // own fibers, reached from the thumb-index children row). Soft-fall
  // to the appendix root so the click still goes somewhere meaningful.
  const targetFor = (kind: Kind) =>
    kind === 'analyses' ? 'astra-appendix' : `astra-appendix-${kind}`;

  return (
    <aside className="narrative-counter" aria-label="On this page">
      {visibleKinds.map((kind) => {
        const count = countsByKind[kind];
        const label = count === 1 ? KIND_LABEL_SINGULAR[kind] : KIND_LABEL_PLURAL[kind];
        return (
          <button
            key={kind}
            type="button"
            className={`narrative-counter__row narrative-counter__row--${kind}`}
            onClick={() => scrollTo(targetFor(kind))}
            title={`Jump to ${count} ${label}`}
          >
            <span className="narrative-counter__glyph" aria-hidden="true">{KIND_GLYPH[kind]}</span>
            <span className="narrative-counter__count">{count}</span>
            <span className="narrative-counter__label">{label}</span>
          </button>
        );
      })}
      {refCount > 0 && (
        <div
          className="narrative-counter__row narrative-counter__row--refs"
          title={`${refCount} outgoing ${refCount === 1 ? 'ref' : 'refs'}`}
        >
          <span className="narrative-counter__glyph" aria-hidden="true">○</span>
          <span className="narrative-counter__count">{refCount}</span>
          <span className="narrative-counter__label">{refCount === 1 ? 'ref' : 'refs'}</span>
        </div>
      )}
    </aside>
  );
}
