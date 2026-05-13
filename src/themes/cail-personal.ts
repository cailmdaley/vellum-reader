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
    structuredFinding: 'var(--rubric)',
    structuredDecision: 'var(--rubric)',
    structuredOutput: 'var(--rubric)',
    structuredInput: 'var(--rubric)',
    structuredAnalysis: 'var(--rubric)',
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
    // Power-user baseline: kind-name + portolan-bearing-line suppression.
    chipShape: 'kind-name',
    // Power-user baseline: pins stack, no auto-dismiss. Cail's flow pins
    // several cards side-by-side while reading; the margin rail is the
    // persistent surface and the canvas is the scratchpad.
    cardStacking: 'stack',
    // Power-user baseline: no section-end gallery. Figures are already
    // visible through (a) the persistent margin rail (kind-name chips),
    // (b) finding cards with inline evidence thumbnails, (c) figure-kind
    // output cards in the appendix. Adding a trailing grid duplicates
    // without new information. Cail can opt in by flipping this flag.
    figureGallery: 'off',
    // Power-user baseline: kind-name chips carry signal; thumbnails would
    // duplicate the existing evidence-thumbnail surface in finding cards
    // plus the appendix's figure-kind output cards. Cail can opt in.
    marginFigureThumbs: 'off',
  },
};
