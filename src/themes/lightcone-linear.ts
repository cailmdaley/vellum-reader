import type { ThemeConfig } from './types';

// lightcone-linear — the new default. Single centered column with a subtle
// left-rail ToC and expandable cards at each section end. Matches Liam's
// DESI prototype structurally; paper-shaped pseudo-sections (summary →
// findings → methods → inputs → outputs) ARE this theme's content model.
//
// Placeholder at Pass 1.5: the config shape is in place (same palette and
// typography as lightcone-margin so visual parity is immediate) but the
// structural divergence (left-rail ToC, section-end card tray, scroll-
// only-if-offscreen, exclusive-open rows) lands in Pass 9a through
// componentOverrides + CSS scoped on :root[data-theme="lightcone-linear"].
export const lightconeLinearTheme: ThemeConfig = {
  id: 'lightcone-linear',
  palette: {
    astraFinding: 'var(--portolan-verdigris)',
    astraDecision: 'var(--rubric)',
    astraOutput: 'var(--portolan-indigo)',
    astraInput: '#6A7280',
    astraAnalysis: 'var(--ochre-ink)',
  },
  fonts: {
    cardTitle: "'EB Garamond', 'Iowan Old Style', Georgia, serif",
    cardBody: "'EB Garamond', 'Iowan Old Style', Georgia, serif",
    narrativeBody: "'EB Garamond', 'Iowan Old Style', Georgia, serif",
  },
  metrics: {
    cardTitleSizePx: 16,
    cardTitleWeight: 600,
    cardBodySizePx: 14,
    cardBodyLineHeight: 1.45,
  },
  layout: {
    // Pass 9a will flip this to a dedicated 'none' mode with the left-rail
    // ToC + section-end tray taking the place of gutter-hover. Keeping
    // 'empty-gutter-hover' now keeps the Pass-1.5 view sane under this
    // slug while the structural containers are still being built.
    marginColumn: 'empty-gutter-hover',
    inlineAnchorStyle: 'kind-colored-highlight',
    figurePlacement: 'inline-with-caption',
  },
};
