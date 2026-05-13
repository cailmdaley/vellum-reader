/**
 * ThemePicker — segmented control over the active Vellum theme.
 *
 * Renders above the FiberHeader in the prose column so it's visible in
 * every theme (including lightcone-linear, which hides every persistent
 * right-margin inhabitant). Visually quiet: small caps "linear · personal"
 * with a gold underline on the active option, sitting in the same text
 * column but a weight lighter than the body.
 *
 * `lightcone-margin` retired 2026-04-26 — see `vellum-reader/vellum-native-
 * structured-renderer` Themes section. Legacy `?theme=lightcone-margin` URLs
 * remap to `lightcone-linear` via `LEGACY_ALIASES`.
 */

import { useTheme } from '~/contexts/ThemeContext';
import type { ThemeId } from '~/themes';

const OPTIONS: { id: ThemeId; label: string }[] = [
  { id: 'lightcone-linear', label: 'linear' },
  { id: 'cail-personal',    label: 'personal' },
];

export function ThemePicker() {
  const { themeId, setThemeId } = useTheme();
  return (
    <nav className="theme-picker" aria-label="Theme">
      {/* The visible "theme" label is decorative — it duplicates the nav
          aria-label and produces a stray "THEME" StaticText in the
          parent's name calculation. Hide it from AT. */}
      <span className="theme-picker__label" aria-hidden="true">theme</span>
      {OPTIONS.map(({ id, label }) => (
        <button
          key={id}
          className={`theme-picker__option${themeId === id ? ' theme-picker__option--active' : ''}`}
          onClick={() => setThemeId(id)}
          aria-current={themeId === id ? 'true' : undefined}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
