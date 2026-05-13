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
    structuredFinding: 'var(--portolan-verdigris)',
    structuredDecision: 'var(--rubric)',
    structuredOutput: 'var(--portolan-indigo)',
    structuredInput: '#6A7280',
    structuredAnalysis: 'var(--ochre-ink)',
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
    // Pass 9a seed: no right margin surface — single centered prose column,
    // left-rail ToC on the left (LeftRailToc mounts in NarrativeView gated on
    // themeId === 'lightcone-linear'). No gutter-hover card; section info
    // lives in the paper-shaped StructuredAppendix (findings / methods / appendix
    // + bibliography) rendered below the narrative. Future 9a steps land
    // exclusive-open collapsed card rows inside StructuredAppendix under this
    // theme root.
    marginColumn: 'none',
    inlineAnchorStyle: 'kind-colored-highlight',
    figurePlacement: 'inline-with-caption',
    leftRailToc: 'on',
    // No margin column mounts under linear; value is only meaningful as a
    // type-system placeholder. Kept at the cail-personal default to avoid
    // implying any intent to switch.
    chipShape: 'kind-name',
    // Pinned cards are rare under linear (no margin rail); when they do land
    // from StructuredAppendix or an inline anchor, keep stacking so multiple
    // expanded cards can sit side-by-side on the canvas.
    cardStacking: 'stack',
    // Figures group under their owning finding/output in the narrative +
    // StructuredAppendix, not in a trailing grid. Per constitution §3: "structure
    // bounds density" — a trailing gallery would reintroduce the overflow
    // bucket the paper-shaped pseudo-sections are designed to avoid.
    figureGallery: 'off',
    // No margin rail under `lightcone-linear` (`marginColumn: 'none'`), so
    // this flag has no render target. Set explicitly to `'off'` to prevent
    // accidental activation if a future theme-compose shares layout shapes.
    marginFigureThumbs: 'off',
  },
};
