/**
 * NarrativeCounter — marginalia table-of-contents next to the FiberHeader.
 *
 * One row per ASTRA kind present on the current fiber (findings,
 * decisions, outputs, inputs, analyses) plus outgoing refs (fiber
 * wikilinks captured as `cites` edges). Sits in the right-margin canvas
 * column, absolutely positioned inside the prose wrapper so it scrolls
 * with the page — unlike the fixed thumb-index above it. The counter
 * replaces both the old `AstraLegend` kind-strip and the short-lived
 * `PageMeta` nav sub-panel; one strip, clickable rows, no dividers.
 *
 * Clicking a row jumps to the matching appendix section:
 *   findings  → `#astra-appendix-findings`
 *   decisions → `#astra-appendix-decisions`
 *   outputs   → `#astra-appendix-outputs`
 *   inputs    → `#astra-appendix-inputs`
 *   analyses  → `#astra-appendix` (the appendix has no analyses
 *               section — sub-analyses are their own fibers, reachable
 *               from the thumb-index's children row — so we land on
 *               the appendix divider as a soft fallback).
 *   refs      → no scroll; refs live scattered through the prose and
 *               in the thumb-index backlinks row, not in a central
 *               listing. The row still renders its count for parity.
 *
 * Hidden on narrow viewports (≤960px) since the thumb-index itself
 * goes away there — the counter has no column to sit in.
 */

import type { GraphNode } from '~/utils/content-types';

/** ASTRA kinds in canonical display order. Only kinds with count > 0
 *  render a row. Refs (outgoing cites) follow as the last row. */
type Kind = 'findings' | 'decisions' | 'outputs' | 'inputs' | 'analyses';

const KIND_ORDER: Kind[] = ['findings', 'decisions', 'outputs', 'inputs', 'analyses'];

const KIND_GLYPH: Record<Kind, string> = {
  findings:  '●',
  decisions: '◇',
  outputs:   '▲',
  inputs:    '◌',
  analyses:  '△',
};

const KIND_LABEL_SINGULAR: Record<Kind, string> = {
  findings:  'insight',
  decisions: 'decision',
  outputs:   'output',
  inputs:    'input',
  analyses:  'analysis',
};

const KIND_LABEL_PLURAL: Record<Kind, string> = {
  findings:  'insights',
  decisions: 'decisions',
  outputs:   'outputs',
  inputs:    'inputs',
  analyses:  'analyses',
};

interface NarrativeCounterProps {
  node?: GraphNode;
  /** Outgoing `cites` targets — fibers this page wiki-links to. */
  refCount: number;
  /** How many child sub-analyses the graph records for this fiber.
   *  `contains` edges are the source of truth, not `node.analyses?.length`
   *  which may be absent on non-astra-project fibers. */
  analysisCount: number;
}

export function NarrativeCounter({ node, refCount, analysisCount }: NarrativeCounterProps) {
  if (!node) return null;

  const counts: Record<Kind, number> = {
    findings:  node.findings?.length  ?? 0,
    decisions: node.decisions?.length ?? 0,
    outputs:   node.outputs?.length   ?? 0,
    inputs:    node.inputs?.length    ?? 0,
    analyses:  analysisCount,
  };

  const rows = KIND_ORDER.filter((k) => counts[k] > 0);
  if (rows.length === 0 && refCount === 0) return null;

  const jumpTo = (kind: Kind) => {
    // findings/decisions/outputs/inputs have dedicated appendix
    // sections; analyses has no section, so fall back to the appendix
    // root divider.
    const targetId = kind === 'analyses' ? 'astra-appendix' : `astra-appendix-${kind}`;
    const el = document.getElementById(targetId) ?? document.getElementById('astra-appendix');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <aside className="narrative-counter" aria-label="On this page">
      {rows.map((kind) => {
        const n = counts[kind];
        const label = n === 1 ? KIND_LABEL_SINGULAR[kind] : KIND_LABEL_PLURAL[kind];
        return (
          <button
            key={kind}
            type="button"
            className={`narrative-counter__row narrative-counter__row--${kind}`}
            onClick={() => jumpTo(kind)}
            title={`Jump to ${n} ${label}`}
          >
            <span className="narrative-counter__glyph" aria-hidden="true">{KIND_GLYPH[kind]}</span>
            <span className="narrative-counter__count">{n}</span>
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
