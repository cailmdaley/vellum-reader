/**
 * Theme identifiers and slot types.
 *
 * Pass 1.5 schema port: slugs renamed to the constitution's final names.
 *   `lightcone` → `lightcone-margin` (evolution of the current empty-gutter
 *     theme; spec info lives in the right margin column)
 *   `vellum-cail` → `cail-personal` (power-user baseline with persistent
 *     marginalia column)
 * New slug:
 *   `lightcone-linear` — single centered column, left-rail ToC, section-end
 *     card tray (default post-Pass-9a; placeholder config now).
 */
export type ThemeId = 'lightcone-margin' | 'lightcone-linear' | 'cail-personal';

export interface ThemePalette {
  astraFinding: string;
  astraDecision: string;
  astraOutput: string;
  astraInput: string;
  astraAnalysis: string;
}

export interface ThemeFonts {
  cardTitle: string;
  cardBody: string;
  narrativeBody: string;
}

export interface ThemeMetrics {
  cardTitleSizePx: number;
  cardTitleWeight: number;
  cardBodySizePx: number;
  cardBodyLineHeight: number;
}

export interface ThemeLayout {
  /**
   * Right-margin column behavior.
   *
   * - `'persistent'` — full marginalia column: kind-glyph chips with labels,
   *   NarrativeCounter, hover preview + click-to-pin. Used by `cail-personal`.
   * - `'compact-chips'` — Pass 9b lightcone-margin: the same MarginCitations
   *   chip stack mounts, but NarrativeCounter and the Cail-only persistent
   *   chrome (thumb-index, backlink nodes, floating island) stay hidden.
   *   Click-to-pin behaves as exclusive-expand (see ContextCardLayer).
   * - `'empty-gutter-hover'` — legacy Pass 1b lightcone-margin: gutter is
   *   empty; hovering inline `.astra-anchor` in the prose pops a
   *   GutterHoverCard at the anchor's line-Y. Kept as a value only for
   *   rollback + future power-user-opt-in.
   * - `'none'` — no margin column at all (`lightcone-linear`).
   */
  marginColumn: 'persistent' | 'compact-chips' | 'empty-gutter-hover' | 'none';
  inlineAnchorStyle: 'plain' | 'kind-colored-highlight';
  figurePlacement: 'inline-with-caption' | 'chip';
  /**
   * Whether the hierarchical LeftRailToc mounts under this theme. When `'on'`,
   * GhostToc is suppressed to avoid a duplicate left-margin navigation surface
   * (the rail is a strict superset: scroll-spy + nested appendix children).
   *
   * `lightcone-linear`: 'on' (primary nav).
   * `cail-personal`:    'on' (opted in — retires ghost-toc).
   * `lightcone-margin`: 'off' (the margin theme uses gutter hover, not a rail).
   */
  leftRailToc: 'on' | 'off';
  /**
   * Margin-chip content shape for ASTRA glyphs.
   *
   * - `'kind-name'` — legacy power-user baseline: `{kind-glyph, KindName}`
   *   where `KindName` is the fixed legend ("Finding", "Decision", …). The
   *   portolan-bearing-line CSS suppresses repeats of the same kind on later
   *   rows so a column of same-kind pins reads as "Finding · · ·". Used by
   *   `cail-personal`. Unused under `lightcone-linear` (no margin column).
   * - `'label-caret'` — lightcone-margin compact-chip: `{kind-glyph, label ??
   *   id, ›}` where the second span is the chip's own content label (per the
   *   schema port's `label?` field + fallback to id). Every chip is
   *   per-content so the portolan suppression doesn't apply — the reader
   *   scans labels to see what's in the margin, not kind categories. Resolves
   *   post-pass-9b scout-note item 1.
   */
  chipShape: 'kind-name' | 'label-caret';
  /**
   * Pinned-card stacking behavior in `ContextCardLayer`.
   *
   * - `'stack'` — repeated pins accumulate; matching-key reclicks lift the
   *   existing card to front (cail-personal power-user default; the canvas
   *   holds as many cards as the user pins).
   * - `'exclusive'` — one pinned card at a time. Pinning a new card dismisses
   *   any others; matching-key reclicks still lift to front but no other cards
   *   coexist. Resolves the Pass 9b step 2 exclusive-expand requirement from
   *   the themes-constitution 2026-04-21 crafting pass: compact-chip margin
   *   rail with one-card-at-a-time expansion (Hypothes.is / Genius / Substack
   *   convergent shape).
   */
  cardStacking: 'stack' | 'exclusive';
  /**
   * Section-end figure gallery.
   *
   * - `'off'` — no trailing gallery. Figures live only inside their host
   *   cards (`cail-personal` today — the persistent margin rail + finding
   *   cards already surface figures), or inline beneath their owning
   *   finding/output (`lightcone-linear` — structure bounds density).
   * - `'section-end'` — mount `FigureGallery` below the narrative prose
   *   (after `AstraAppendix`). Walks `collectFigures(currentNode)`,
   *   renders each as a thumbnail + caption strip, click opens the
   *   lightbox with the full gallery carousel. `lightcone-margin`
   *   default — until the per-anchor margin adapter lands, the trailing
   *   gallery is the primary figure surface. Overflow bucket for the
   *   margin rail once per-anchor thumbnails land.
   */
  figureGallery: 'off' | 'section-end';
}

export type ThemeComponentSlot =
  | 'MarginColumn'
  | 'NarrativeShell'
  | 'FindingRenderer'
  | 'LeftRailToc'
  | 'SectionCardTray';

export interface ThemeConfig {
  id: ThemeId;
  palette: ThemePalette;
  fonts: ThemeFonts;
  metrics: ThemeMetrics;
  layout: ThemeLayout;
  componentOverrides?: Partial<Record<ThemeComponentSlot, unknown>>;
}
