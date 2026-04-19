/**
 * MarginInsights — left-margin finding glyphs.
 *
 * Companion to MarginDecisions. Each ASTRA finding on the current fiber
 * gets a `●` (has-evidence) or `○` (no-evidence) glyph stacked down the
 * left margin, labeled with a truncated claim, backed by a hover card
 * that shows the full claim and evidence indicator. Clicking the glyph
 * scrolls to the finding's block in AstraBlocks via
 * `#astra-finding-<key>`. The ⊞ pin opens a floating InsightCard through
 * the shared `vellum:open-card` event so the reader can keep the insight
 * visible while scrolling.
 *
 * Stacks below MarginDecisions so ◇ and ● share the same left gutter
 * without overlapping.
 */

import { useRef } from 'react';
import type { GraphNode } from '~/utils/content-types';
import { useHoverGrace } from '~/hooks/useHoverGrace';
import { HOVER_GRACE_MS, HOVER_OPEN_DELAY_MS } from '~/utils/hover';
import { MarginCardPreview } from './MarginCardPreview';

interface MarginInsightsProps {
  graphNode?: GraphNode;
  wrapperRef: React.RefObject<HTMLElement>;
}

// Matches MarginDecisions — keep the stacks visually consistent.
const STACK_GAP = 28;
// Starting top for the first glyph in isolation. When decisions also
// exist the caller's gap pushes this down via DECISION_STACK_OFFSET.
const FIRST_GLYPH_TOP = 172;
// Extra gap between the end of the decision stack and the first insight
// glyph, so the two clusters read as distinct groups.
const GROUP_GAP = 28;

const CLAIM_LABEL_MAX = 56;

function truncateClaim(claim: string): string {
  if (claim.length <= CLAIM_LABEL_MAX) return claim;
  return claim.slice(0, CLAIM_LABEL_MAX - 1).trimEnd() + '…';
}

export function MarginInsights({ graphNode, wrapperRef: _wrapperRef }: MarginInsightsProps) {
  const findings = graphNode?.findings ?? [];
  const decisionCount = graphNode?.decisions?.length ?? 0;
  const { hoveredKey, scheduleOpen, cancelClose, scheduleClose } =
    useHoverGrace(HOVER_GRACE_MS, HOVER_OPEN_DELAY_MS);
  const stackRef = useRef<HTMLDivElement>(null);

  if (findings.length === 0) return null;

  const baseTop =
    FIRST_GLYPH_TOP +
    (decisionCount > 0 ? decisionCount * STACK_GAP + GROUP_GAP : 0);

  const scrollToFinding = (key: string) => {
    const el = document.getElementById(`astra-finding-${key}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleClick = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    scrollToFinding(key);
  };

  const hoveredFinding = hoveredKey
    ? findings.find((f) => f.key === hoveredKey)
    : null;
  const hoveredIdx = hoveredKey
    ? findings.findIndex((f) => f.key === hoveredKey)
    : -1;

  return (
    <div
      ref={stackRef}
      className="margin-insights"
      aria-label="Findings in this fiber"
    >
      {findings.map((f, i) => (
        <a
          key={f.key}
          href={`#astra-finding-${f.key}`}
          className={`margin-insight${hoveredKey === f.key ? ' margin-insight--hovered' : ''} margin-insight--evidence`}
          style={{ top: baseTop + i * STACK_GAP }}
          onClick={(e) => handleClick(e, f.key)}
          onMouseEnter={() => scheduleOpen(f.key)}
          onMouseLeave={scheduleClose}
          title={f.claim}
        >
          <span className="margin-insight__glyph">●</span>
          <span className="margin-insight__label">{truncateClaim(f.claim)}</span>
        </a>
      ))}

      {hoveredFinding && hoveredIdx >= 0 && (
        <MarginCardPreview
          content={{ type: 'insight', finding: hoveredFinding }}
          top={baseTop + hoveredIdx * STACK_GAP + 20}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />
      )}
    </div>
  );
}
