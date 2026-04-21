import type { ThemeConfig } from './types';

// cail-personal — the power-user baseline. Persistent marginalia column,
// rubricated anchor ink, thumb-index, backlinks all mounted. The hierarchical
// LeftRailToc is opted in (`leftRailToc: 'on'`) and GhostToc is retired to
// avoid a duplicate left-margin navigation surface — the rail is a strict
// superset (scroll-spy + nested appendix children via `label ?? id`). Values
// otherwise mirror the current :root defaults in vellum.css so existing
// Vellum renders move to this theme with minimal visual change. Opts into
// every cross-theme improvement (scroll-only-if-offscreen, selected-option
// summaries, MyST restores).
export const cailPersonalTheme: ThemeConfig = {
  id: 'cail-personal',
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
    leftRailToc: 'on',
  },
};
