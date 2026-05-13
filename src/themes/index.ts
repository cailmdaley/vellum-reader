import { lightconeLinearTheme } from './lightcone-linear';
import { cailPersonalTheme } from './cail-personal';
import type { ThemeConfig, ThemeId } from './types';

export type { ThemeConfig, ThemeId } from './types';
export { lightconeLinearTheme, cailPersonalTheme };

export const THEMES: Record<ThemeId, ThemeConfig> = {
  'lightcone-linear': lightconeLinearTheme,
  'cail-personal': cailPersonalTheme,
};

// lightcone-linear is the staging-ground rung — the layout-faithful
// reimplementation that vellum's structured renderer also defaults to.
export const DEFAULT_THEME_ID: ThemeId = 'lightcone-linear';

// Theme selection: URL query param (`?theme=lightcone-linear`), with a
// sticky localStorage fallback so reloads don't lose the selection.
// Legacy slugs remap transparently so pinned URLs and stored preferences
// keep working after retirements:
//   - `lightcone` (Pass 1) and `lightcone-margin` (Pass 9b, retired
//     2026-04-26 under vellum-reader/vellum-native-structured-renderer)
//     both fall back to `lightcone-linear` — the staging-ground rung
//     under the ladder.
//   - `vellum-cail` is the original `cail-personal` slug.
const STORAGE_KEY = 'vellum.theme';

const LEGACY_ALIASES: Record<string, ThemeId> = {
  lightcone: 'lightcone-linear',
  'lightcone-margin': 'lightcone-linear',
  'vellum-cail': 'cail-personal',
};

function coerceThemeId(raw: string | null | undefined): ThemeId | null {
  if (!raw) return null;
  if (raw in THEMES) return raw as ThemeId;
  const aliased = LEGACY_ALIASES[raw];
  return aliased ?? null;
}

export function resolveInitialThemeId(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME_ID;
  const fromQuery = coerceThemeId(new URLSearchParams(window.location.search).get('theme'));
  if (fromQuery) {
    window.localStorage.setItem(STORAGE_KEY, fromQuery);
    return fromQuery;
  }
  const stored = coerceThemeId(window.localStorage.getItem(STORAGE_KEY));
  if (stored) return stored;
  return DEFAULT_THEME_ID;
}
