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
  marginColumn: 'persistent' | 'empty-gutter-hover' | 'none';
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
