/**
 * ThemePicker — three-way segmented control over the active Vellum theme.
 *
 * Renders above the FiberHeader in the prose column so it's visible in
 * every theme (including lightcone-linear, which hides every persistent
 * right-margin inhabitant). Visually quiet: small caps "linear · margin ·
 * personal" with a gold underline on the active option, sitting in the
 * same text column but a weight lighter than the body.
 */

import { useTheme } from '~/contexts/ThemeContext';
import type { ThemeId } from '~/themes';

const OPTIONS: { id: ThemeId; label: string }[] = [
  { id: 'lightcone-linear', label: 'linear' },
  { id: 'lightcone-margin', label: 'margin' },
  { id: 'cail-personal',    label: 'personal' },
];

export function ThemePicker() {
  const { themeId, setThemeId } = useTheme();
  return (
    <nav className="theme-picker" aria-label="Theme">
      <span className="theme-picker__label">theme</span>
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
