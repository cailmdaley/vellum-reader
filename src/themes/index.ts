import { lightconeMarginTheme } from './lightcone-margin';
import { lightconeLinearTheme } from './lightcone-linear';
import { cailPersonalTheme } from './cail-personal';
import type { ThemeConfig, ThemeId } from './types';

export type { ThemeConfig, ThemeId } from './types';
export { lightconeMarginTheme, lightconeLinearTheme, cailPersonalTheme };

export const THEMES: Record<ThemeId, ThemeConfig> = {
  'lightcone-linear': lightconeLinearTheme,
  'lightcone-margin': lightconeMarginTheme,
  'cail-personal': cailPersonalTheme,
};

// lightcone-linear is the constitution's stated default. Pass 9a lands
// the structural divergence; until then the slug resolves to a config
// that inherits lightcone-margin's gutter-hover affordance.
export const DEFAULT_THEME_ID: ThemeId = 'lightcone-linear';

// Theme selection: URL query param (`?theme=lightcone-linear`), with a
// sticky localStorage fallback so reloads don't lose the selection.
// Legacy slugs (`lightcone`, `vellum-cail`) remap transparently so any
// pinned URL or stored preference keeps working while the renames settle.
const STORAGE_KEY = 'vellum.theme';

const LEGACY_ALIASES: Record<string, ThemeId> = {
  lightcone: 'lightcone-margin',
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
