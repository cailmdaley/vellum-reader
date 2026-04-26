/**
 * AstraPicker — inline ladder picker for the vellum-native astra renderer.
 *
 * One axis with three rungs:
 *
 *   [ paper-view | linear | personal ]
 *
 * The same control mounts on both card surfaces and the workspace modal;
 * placement is *content* (vellum's `ThemePicker` pattern), not chrome, so it
 * shrinks alongside the card when the camera zooms out and inherits whatever
 * a11y / focus contract the surrounding prose column already has.
 *
 * The ladder is a single axis from canonical to expressive:
 *
 *   - paper-view — lightcone-ui's `paper-view.html`, iframed. The reference
 *     render and the dogfood door.
 *   - linear — vellum's reimplementation of paper-view's layout. Same shape,
 *     vellum's rendering pipeline. Default rung; staging ground for
 *     affordances destined to PR upstream.
 *   - personal — vellum's expressive variant. Layout diverges; margin-style
 *     chrome, annotation overlays, decision-flip surfaces blossom here
 *     before they trickle down the ladder.
 *
 * A11y contract: each rung is a real `<button>` with an accessible name and
 * `aria-pressed` reflecting the current selection. Agent-browser drives the
 * picker through accessible names — see Evidence in the constitution.
 *
 * See `vellum-reader/vellum-native-astra-renderer`.
 */

import { useId } from 'react';

export type AstraLadderRung = 'paper-view' | 'linear' | 'personal';

const RUNG_LABELS: Record<AstraLadderRung, string> = {
  'paper-view': 'paper-view',
  linear: 'linear',
  personal: 'personal',
};

const RUNG_DESCRIPTIONS: Record<AstraLadderRung, string> = {
  'paper-view': 'Canonical lightcone paper view (iframe).',
  linear: "Vellum's reimplementation of the paper-view layout.",
  personal: "Vellum's expressive layout variant.",
};

const RUNGS: AstraLadderRung[] = ['paper-view', 'linear', 'personal'];

export interface AstraPickerProps {
  rung: AstraLadderRung;
  onChange: (rung: AstraLadderRung) => void;
  /** Optional class hook so portolan card-side mounts can shrink the picker
   *  alongside their density-responsive content without affecting the modal. */
  className?: string;
}

export function AstraPicker({ rung, onChange, className }: AstraPickerProps) {
  const labelId = useId();
  return (
    <div
      className={`astra-picker${className ? ` ${className}` : ''}`}
      role="group"
      aria-labelledby={labelId}
    >
      <span id={labelId} className="astra-picker__label">
        view
      </span>
      <div className="astra-picker__options">
        {RUNGS.map((option) => {
          const active = option === rung;
          return (
            <button
              key={option}
              type="button"
              className={`astra-picker__option${active ? ' astra-picker__option--active' : ''}`}
              aria-pressed={active}
              title={RUNG_DESCRIPTIONS[option]}
              onClick={() => {
                if (!active) onChange(option);
              }}
            >
              {RUNG_LABELS[option]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
