import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_THEME_ID,
  THEMES,
  resolveInitialThemeId,
  type ThemeConfig,
  type ThemeId,
} from '../themes';

// Vellum's own theme context — distinct from @myst-theme/providers'
// ThemeProvider in App.tsx, which is the myst light/dark switch that
// stays wired for the myst-to-react compat island. This context
// carries the Lightcone/Cail config (palette, metrics, layout, slot
// overrides). The active theme is mirrored onto
// document.documentElement as `data-theme`, which is how scoped CSS
// (:root[data-theme="..."]) selects theme-specific overrides.

interface VellumThemeContextValue {
  themeId: ThemeId;
  theme: ThemeConfig;
  setThemeId: (id: ThemeId) => void;
}

const VellumThemeContext = createContext<VellumThemeContextValue>({
  themeId: DEFAULT_THEME_ID,
  theme: THEMES[DEFAULT_THEME_ID],
  setThemeId: () => {},
});

export function VellumThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(() => resolveInitialThemeId());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = themeId;
    try { window.localStorage.setItem('vellum.theme', themeId); } catch {}
  }, [themeId]);

  const value = useMemo<VellumThemeContextValue>(
    () => ({ themeId, theme: THEMES[themeId], setThemeId }),
    [themeId],
  );

  return (
    <VellumThemeContext.Provider value={value}>
      {children}
    </VellumThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(VellumThemeContext);
}
