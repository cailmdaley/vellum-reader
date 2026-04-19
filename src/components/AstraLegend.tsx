/**
 * AstraLegend — the subtle kind-chip strip at the top of astra-project
 * narrative pages.
 *
 * Only the kinds the page actually cites appear — a page whose abstract
 * only references findings + outputs shouldn't advertise decisions or
 * sub-analyses. This keeps the legend quiet on the first screen and
 * consistent with the margin chips the reader will encounter below.
 *
 * Kinds discovered here are the same set the margin glyphs use. The
 * grammar that turns `#findings.id` etc. into a kind lives in
 * `utils/astra-anchor.ts`.
 */

import { KIND_SYMBOL, KIND_LEGEND, type AstraAnchorKind } from '~/utils/astra-anchor';

interface AstraLegendProps {
  /** Kinds present on the page, in canonical order. Empty → the legend doesn't render. */
  kinds: AstraAnchorKind[];
}

/** Canonical display order for the legend. */
const DISPLAY_ORDER: AstraAnchorKind[] = [
  'findings',
  'decisions',
  'outputs',
  'inputs',
  'analyses',
];

export function AstraLegend({ kinds }: AstraLegendProps) {
  if (!kinds || kinds.length === 0) return null;
  const present = new Set(kinds);
  const ordered = DISPLAY_ORDER.filter((k) => present.has(k));

  return (
    <div className="astra-legend" aria-label="ASTRA anchor kinds on this page">
      <span className="astra-legend__hint">Refs</span>
      {ordered.map((kind) => (
        <span
          key={kind}
          className={`astra-legend__chip astra-legend__chip--${kind}`}
        >
          <span className="astra-legend__dot" aria-hidden="true">{KIND_SYMBOL[kind]}</span>
          <span className="astra-legend__label">{KIND_LEGEND[kind]}</span>
        </span>
      ))}
    </div>
  );
}
