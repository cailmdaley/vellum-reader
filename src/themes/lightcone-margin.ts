import type { ThemeConfig } from './types';

// lightcone-margin — evolution of the current Lightcone look. Persistent
// right margin column carrying compact ASTRA chips (`label ?? id`-driven);
// inline ASTRA anchors are kind-colored highlights in the prose.
//
// Pass 9b step 1: the margin column is now `'compact-chips'` — the same
// MarginCitations rail `cail-personal` uses, without the persistent
// power-user chrome (NarrativeCounter, floating island, thumb-index,
// backlink nodes). The "empty-gutter hover" affordance retires with this
// change; click-to-pin on a chip expands one card at a time in the
// gutter, matching the compact-chip + exclusive-expand shape resolved in
// the themes-constitution 2026-04-21 crafting pass. Pass 9b step 2 will
// tighten the chip into the 2-line kind-glyph + label + caret shape and
// enforce exclusive-expand inside ContextCardLayer.
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
    marginColumn: 'compact-chips',
    inlineAnchorStyle: 'kind-colored-highlight',
    figurePlacement: 'inline-with-caption',
    leftRailToc: 'off',
    // Pass 9b step 4: per-content `label ?? id` + caret, no kind-name text.
    // Every chip carries its own content label so readers scan the margin
    // for what's there, not for kind categories. Portolan bearing-line
    // suppression (kind-name repeat dimming) doesn't apply in this shape;
    // CSS gates those rules on `:root:not([data-theme="lightcone-margin"])`.
    chipShape: 'label-caret',
    cardStacking: 'exclusive',
  },
};
