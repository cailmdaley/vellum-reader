export type ThemeId = 'lightcone' | 'vellum-cail';

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
  marginColumn: 'persistent' | 'empty-gutter-hover';
  inlineAnchorStyle: 'plain' | 'kind-colored-highlight';
  figurePlacement: 'inline-with-caption' | 'chip';
}

export type ThemeComponentSlot =
  | 'MarginColumn'
  | 'NarrativeShell'
  | 'FindingRenderer';

export interface ThemeConfig {
  id: ThemeId;
  palette: ThemePalette;
  fonts: ThemeFonts;
  metrics: ThemeMetrics;
  layout: ThemeLayout;
  componentOverrides?: Partial<Record<ThemeComponentSlot, unknown>>;
}
