import type { ThemeConfig } from './types';

// lightcone-margin — evolution of the current Lightcone look. Persistent
// right margin column carrying compact ASTRA chips (`label ?? id`-driven);
// inline ASTRA anchors are kind-colored highlights in the prose. The
// "empty-by-default, fill-on-hover" affordance lives in this theme's
// GutterHoverCard + compact-chip stack (Pass 9b maturation).
//
// CSS divergence is scoped on :root[data-theme="lightcone-margin"];
// structural divergence goes through componentOverrides later.
export const lightconeMarginTheme: ThemeConfig = {
  id: 'lightcone-margin',
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
    marginColumn: 'empty-gutter-hover',
    inlineAnchorStyle: 'kind-colored-highlight',
    figurePlacement: 'inline-with-caption',
    leftRailToc: 'off',
  },
};
