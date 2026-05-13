/**
 * StructuredLegend — the subtle kind-chip strip at the top of structured-project
 * narrative pages.
 *
 * Only the kinds the page actually cites appear — a page whose abstract
 * only references findings + outputs shouldn't advertise decisions or
 * sub-analyses. This keeps the legend quiet on the first screen and
 * consistent with the margin chips the reader will encounter below.
 *
 * Kinds discovered here are the same set the margin glyphs use. The
 * grammar that turns `#findings.id` etc. into a kind lives in
 * `utils/structured-anchor.ts`.
 */

import { KIND_SYMBOL, KIND_LEGEND, type StructuredAnchorKind } from '~/utils/structured-anchor';

interface StructuredLegendProps {
  /** Kinds present on the page, in canonical order. Empty → the legend doesn't render. */
  kinds: StructuredAnchorKind[];
}

/** Canonical display order for the legend. */
const DISPLAY_ORDER: StructuredAnchorKind[] = [
  'findings',
  'decisions',
  'outputs',
  'inputs',
  'analyses',
];

export function StructuredLegend({ kinds }: StructuredLegendProps) {
  if (!kinds || kinds.length === 0) return null;
  const present = new Set(kinds);
  const ordered = DISPLAY_ORDER.filter((k) => present.has(k));

  return (
    <div className="structured-legend" aria-label="structured anchor kinds on this page">
      <span className="structured-legend__hint">Refs</span>
      {ordered.map((kind) => (
        <span
          key={kind}
          className={`structured-legend__chip structured-legend__chip--${kind}`}
        >
          <span className="structured-legend__dot" aria-hidden="true">{KIND_SYMBOL[kind]}</span>
          <span className="structured-legend__label">{KIND_LEGEND[kind]}</span>
        </span>
      ))}
    </div>
  );
}
