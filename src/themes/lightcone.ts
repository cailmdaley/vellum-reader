import type { ThemeConfig } from './types';

// Lightcone — the default public theme. No persistent marginalia
// column; right gutter is empty whitespace that fills on hover/click
// with ASTRA cards. Inline ASTRA anchors are kind-colored highlights
// in the prose. Pass 0 exports the config; later passes wire the
// layout divergence via CSS scoped on :root[data-theme="lightcone"]
// and the componentOverrides registry.
export const lightconeTheme: ThemeConfig = {
  id: 'lightcone',
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
  },
};
