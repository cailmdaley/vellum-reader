/**
 * Theme identifiers and slot types.
 *
 * Two themes today, sitting on the structured-renderer ladder:
 *   `lightcone-linear` — single centered column, left-rail ToC, section-end
 *     card tray. Default. Layout-faithful staging ground.
 *   `cail-personal` — power-user baseline with persistent marginalia
 *     column. Expressive divergence on top of linear's substrate.
 *
 * `lightcone-margin` retired 2026-04-26 under the vellum-native structured
 * renderer constitution — it was a half-step (margin column on, no full
 * layout divergence) that wasn't pulling weight under the ladder model.
 * Legacy `?theme=lightcone-margin` and stored preferences remap to
 * `lightcone-linear` via `LEGACY_ALIASES` in `index.ts`.
 *
 * See `vellum-reader/vellum-native-structured-renderer`.
 */
export type ThemeId = 'lightcone-linear' | 'cail-personal';

export interface ThemePalette {
  structuredFinding: string;
  structuredDecision: string;
  structuredOutput: string;
  structuredInput: string;
  structuredAnalysis: string;
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
   *   empty; hovering inline `.structured-anchor` in the prose pops a
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
   * Margin-chip content shape for structured glyphs.
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
   *   (after `StructuredAppendix`). Walks `collectFigures(currentNode)`,
   *   renders each as a thumbnail + caption strip, click opens the
   *   lightbox with the full gallery carousel. `lightcone-margin`
   *   default — until the per-anchor margin adapter lands, the trailing
   *   gallery is the primary figure surface. Overflow bucket for the
   *   margin rail once per-anchor thumbnails land.
   */
  figureGallery: 'off' | 'section-end';
  /**
   * Per-anchor figure thumbnails in the margin rail.
   *
   * - `'off'` — structured chips render as plain kind/label chips regardless of
   *   whether the anchored host carries figures (`cail-personal`,
   *   `lightcone-linear` — no margin rail at all).
   * - `'on'` — when an structured chip's href matches a collected figure's
   *   anchor (`#outputs.<id>` or `#findings.<key>` per
   *   `collectFigures(currentNode)`), the chip's leading glyph becomes a
   *   small thumbnail of that figure instead of the kind symbol. The
   *   chip's label and caret behave as the `chipShape` says; only the
   *   dot slot changes. Section-end `FigureGallery` remains the overflow
   *   / gather surface.
   *
   * Pass 9b step 7 prep: this flag gates the structural wiring only; the
   * visual tune (thumbnail size, hover affordance, contrast with the
   * dashed-broken rule) lands in a chrome-equipped iteration. Default off
   * everywhere until then.
   */
  marginFigureThumbs: 'off' | 'on';
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
