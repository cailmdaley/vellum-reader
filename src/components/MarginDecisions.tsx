/**
 * MarginDecisions — left-margin decision glyphs.
 *
 * Replacement for the inline `<details>` dropdowns that mystra used to
 * emit for ASTRA decisions. A fiber with N decisions now gets N `⧖` glyphs
 * stacked down the left margin of its prose column, each labelled with
 * the decision name and backed by a hover card that shows the rationale,
 * selected option, and excluded alternatives. Clicking the glyph scrolls
 * to the full structured block inside `AstraBlocks` at the bottom of the
 * prose via `#astra-decision-<key>`.
 *
 * The decision label is always visible next to the glyph — the reader
 * doesn't have to hover just to know what each glyph names. The hover
 * card uses the same hover-intent pattern as `MarginCitations.fiber-
 * tooltip`: a grace period lets the cursor cross the gap from glyph to
 * card without closing, and the card itself carries `pointer-events:
 * auto` + mirrored enter/leave handlers so the reader can click things
 * inside it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GraphNode } from '~/utils/content-types';

interface MarginDecisionsProps {
  graphNode?: GraphNode;
  wrapperRef: React.RefObject<HTMLElement>;
}

// Vertical distance between stacked glyphs. Generous enough that adjacent
// decision labels don't overlap at the default body line-height.
const STACK_GAP = 28;

// Starting y (distance down from the top of the wrapper) for the first
// glyph. Puts the stack opposite the fiber header's title rather than
// pinned to the top of the page chrome. Rough-cut; refine later.
const FIRST_GLYPH_TOP = 60;

/** See MarginCitations.TOOLTIP_CLOSE_DELAY_MS — same grace period. */
const TOOLTIP_CLOSE_DELAY_MS = 180;

export function MarginDecisions({ graphNode, wrapperRef }: MarginDecisionsProps) {
  const decisions = graphNode?.decisions ?? [];
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      setHoveredKey(null);
      closeTimerRef.current = null;
    }, TOOLTIP_CLOSE_DELAY_MS);
  }, [cancelClose]);

  const openKey = useCallback(
    (key: string) => {
      cancelClose();
      setHoveredKey(key);
    },
    [cancelClose],
  );

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Scroll-to-block on click; uses smooth scroll so the journey from
  // margin glyph to AstraBlocks is visible (helps the reader build the
  // mental map from "glyph" to "full trace").
  const scrollToDecision = (key: string) => {
    const el = document.getElementById(`astra-decision-${key}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleClick = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    scrollToDecision(key);
  };

  // Hide when there's no wrapper yet or no decisions to show.
  useEffect(() => {
    // nothing to observe yet; intentionally empty — the component is
    // pure-CSS-positioned relative to the wrapper from the outside.
  }, [wrapperRef]);

  if (decisions.length === 0) return null;

  const hoveredDecision = hoveredKey
    ? decisions.find((d) => d.key === hoveredKey)
    : null;
  const hoveredIdx = hoveredKey
    ? decisions.findIndex((d) => d.key === hoveredKey)
    : -1;

  return (
    <div
      ref={stackRef}
      className="margin-decisions"
      aria-label="Decisions in this fiber"
    >
      {decisions.map((d, i) => (
        <a
          key={d.key}
          href={`#astra-decision-${d.key}`}
          className={`margin-decision${hoveredKey === d.key ? ' margin-decision--hovered' : ''}`}
          style={{ top: FIRST_GLYPH_TOP + i * STACK_GAP }}
          onClick={(e) => handleClick(e, d.key)}
          onMouseEnter={() => openKey(d.key)}
          onMouseLeave={scheduleClose}
          title={d.label}
        >
          <span className="margin-decision__glyph">⧖</span>
          <span className="margin-decision__label">{d.label}</span>
        </a>
      ))}

      {hoveredDecision && hoveredIdx >= 0 && (
        <div
          className="decision-tooltip"
          style={{ top: FIRST_GLYPH_TOP + hoveredIdx * STACK_GAP + 20 }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <button
            type="button"
            className="decision-tooltip__title"
            onClick={() => scrollToDecision(hoveredDecision.key)}
          >
            <span className="decision-tooltip__glyph">⧖</span>
            {hoveredDecision.label}
          </button>
          {hoveredDecision.selectedLabel && (
            <div className="decision-tooltip__selected">
              <span className="decision-tooltip__kicker">chose</span>{' '}
              {hoveredDecision.selectedLabel}
            </div>
          )}
          {hoveredDecision.rationale && (
            <div className="decision-tooltip__rationale">
              {hoveredDecision.rationale}
            </div>
          )}
          {hoveredDecision.excluded && hoveredDecision.excluded.length > 0 && (
            <ul className="decision-tooltip__excluded">
              {hoveredDecision.excluded.map((ex) => (
                <li key={ex.key} className="decision-tooltip__excluded-item">
                  <span className="decision-tooltip__excluded-label">
                    {ex.label}
                  </span>
                  {ex.reason && (
                    <span className="decision-tooltip__excluded-reason">
                      {' '}— {ex.reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
