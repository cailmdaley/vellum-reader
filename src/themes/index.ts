import { lightconeTheme } from './lightcone';
import { vellumCailTheme } from './vellum-cail';
import type { ThemeConfig, ThemeId } from './types';

export type { ThemeConfig, ThemeId } from './types';
export { lightconeTheme, vellumCailTheme };

export const THEMES: Record<ThemeId, ThemeConfig> = {
  'lightcone': lightconeTheme,
  'vellum-cail': vellumCailTheme,
};

export const DEFAULT_THEME_ID: ThemeId = 'lightcone';

// Theme selection for Pass 0: URL query param `?theme=lightcone` /
// `?theme=vellum-cail`, with a sticky localStorage fallback so
// reloads don't lose the selection. A real picker lives post-
// constitution; this is the dev-time mechanism.
const STORAGE_KEY = 'vellum.theme';

export function resolveInitialThemeId(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME_ID;
  const fromQuery = new URLSearchParams(window.location.search).get('theme');
  if (fromQuery && fromQuery in THEMES) {
    window.localStorage.setItem(STORAGE_KEY, fromQuery);
    return fromQuery as ThemeId;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && stored in THEMES) return stored as ThemeId;
  return DEFAULT_THEME_ID;
}
