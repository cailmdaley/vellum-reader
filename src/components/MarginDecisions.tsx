/**
 * MarginDecisions — left-margin decision glyphs.
 *
 * Replacement for the inline `<details>` dropdowns that mystra used to
 * emit for ASTRA decisions. A fiber with N decisions now gets N `◇` glyphs
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

import { useRef } from 'react';
import type { GraphNode } from '~/utils/content-types';
import { useHoverGrace } from '~/hooks/useHoverGrace';
import { HOVER_GRACE_MS, HOVER_OPEN_DELAY_MS } from '~/utils/hover';
import { MarginCardPreview } from './MarginCardPreview';

interface MarginDecisionsProps {
  graphNode?: GraphNode;
  // Reserved — stack positioning is driven from CSS against this wrapper
  // by the caller, but we currently don't read it here.
  wrapperRef: React.RefObject<HTMLElement>;
}

// Vertical distance between stacked glyphs. Generous enough that adjacent
// decision labels don't overlap at the default body line-height.
const STACK_GAP = 28;

// Starting y (distance down from the top of the wrapper) for the first
// glyph. Start below the fixed thumb index so the canvas-side rail reads
// as subordinate marginalia, not competing chrome.
const FIRST_GLYPH_TOP = 172;

export function MarginDecisions({ graphNode, wrapperRef: _wrapperRef }: MarginDecisionsProps) {
  const decisions = graphNode?.decisions ?? [];
  const { hoveredKey, openKey, scheduleOpen, cancelClose, scheduleClose } =
    useHoverGrace(HOVER_GRACE_MS, HOVER_OPEN_DELAY_MS);
  const stackRef = useRef<HTMLDivElement>(null);

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
          onMouseEnter={() => scheduleOpen(d.key)}
          onMouseLeave={scheduleClose}
          title={d.label}
        >
          <span className="margin-decision__glyph">◇</span>
          <span className="margin-decision__label">{d.label}</span>
        </a>
      ))}

      {hoveredDecision && hoveredIdx >= 0 && (
        <MarginCardPreview
          content={{ type: 'decision', decision: hoveredDecision }}
          top={FIRST_GLYPH_TOP + hoveredIdx * STACK_GAP + 20}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />
      )}
    </div>
  );
}
