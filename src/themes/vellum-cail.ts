import type { ThemeConfig } from './types';

// Cail's personal theme — today's Vellum behavior preserved as a named
// theme. Persistent marginalia column, rubricated anchor ink. Values
// mirror the current :root defaults in vellum.css so a Pass-0 handoff
// to this theme is a no-op.
export const vellumCailTheme: ThemeConfig = {
  id: 'vellum-cail',
  palette: {
    astraFinding: 'var(--rubric)',
    astraDecision: 'var(--rubric)',
    astraOutput: 'var(--rubric)',
    astraInput: 'var(--rubric)',
    astraAnalysis: 'var(--rubric)',
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
    marginColumn: 'persistent',
    inlineAnchorStyle: 'plain',
    figurePlacement: 'chip',
  },
};
