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
