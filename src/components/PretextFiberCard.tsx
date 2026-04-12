/**
 * PretextFiberCard — Gate 1a fiber card for Vellum Workspace.
 *
 * Renders a single fiber as a composed typographic card whose title, outcome,
 * and one ASTRA highlight restage through @chenglou/pretext as the `width`
 * prop changes. Goal per [[vellum-reader/workspace]] Gate 1a: editorial
 * quality at every width from ~180px to ~900px, text selectable via native
 * DOM, no CSS flow involvement.
 *
 * Pretext runs client-only (it touches OffscreenCanvas / document for
 * measurement), so layout fires in a useEffect after mount. Before layout is
 * ready we render nothing visible — the card's height is reserved only after
 * pretext returns a real measurement. That's intentional: the whole point is
 * to see what pretext produces, not to paper over it with a CSS fallback.
 *
 * Re-ported into vellum-next under Gate 0 of the pretext refoundation from
 * `c65f407` (original Gate 1a landing commit). The source of truth for the
 * pre-Vite version lives at
 * `.felt/vellum-vite-migration/pretext-refoundation/reference/PretextFiberCard.tsx`.
 */

import { useEffect, useState } from 'react';
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import type { GraphNode } from '~/utils/content-types';
import { cleanVerdict, normalizeStatus, statusGlyph } from '~/utils/fiber-status';

// Typographic scale for Gate 1a. These are canonical points we want to hold
// editorial quality at; the card grows naturally between them. Fonts must be
// named (not system-ui) because pretext's accuracy relies on canvas
// measureText agreeing with DOM layout — see vendor/pretext/README.md.
const TITLE_FONT = "600 19px 'EB Garamond', Georgia, serif";
const TITLE_LINE_HEIGHT = 25;
const OUTCOME_FONT = "400 15.5px 'EB Garamond', Georgia, serif";
const OUTCOME_LINE_HEIGHT = 22;
const HIGHLIGHT_FONT = "500 12px 'JetBrains Mono', monospace";
const HIGHLIGHT_LINE_HEIGHT = 18;

// Inner padding of the card — pretext lines are positioned relative to the
// card's content box, so these shift the top-left origin for the first line.
const PAD_X = 14;
const PAD_Y = 12;
// Gaps between the three regions.
const TITLE_TO_OUTCOME_GAP = 6;
const OUTCOME_TO_HIGHLIGHT_GAP = 8;

interface PretextFiberCardProps {
  node: GraphNode;
  width: number;
  /** Optional "tag" label for the width, shown in a gutter for QA. */
  widthLabel?: string;
}

type LaidOutLine = {
  text: string;
  /** absolute x within the card */
  x: number;
  /** absolute y within the card */
  y: number;
  font: string;
  lineHeight: number;
  /** CSS class of the line span — used to scope color/weight if needed */
  role: 'title' | 'outcome' | 'highlight';
};

type CardLayout = {
  /** total card height in px (inner content + padding) */
  height: number;
  lines: LaidOutLine[];
};

function pickHighlight(node: GraphNode): string | null {
  // Prefer the first decision label (gives us a structural peek).
  const firstDecision = node.decisions?.[0];
  if (firstDecision?.label) {
    const verdict = firstDecision.selectedLabel
      ? ` → ${firstDecision.selectedLabel}`
      : firstDecision.excluded.length > 0
        ? ' · open'
        : '';
    return `⧖ ${firstDecision.label}${verdict}`;
  }
  // Fallback: first finding's claim, trimmed.
  const firstFinding = node.findings?.[0];
  if (firstFinding?.claim) {
    const trimmed = firstFinding.claim.length > 80
      ? firstFinding.claim.slice(0, 77) + '…'
      : firstFinding.claim;
    return `✦ ${trimmed}`;
  }
  // Fallback: tags joined.
  if (node.tags.length > 0) {
    return node.tags.slice(0, 4).join(' · ');
  }
  return null;
}

export function PretextFiberCard({ node, width, widthLabel }: PretextFiberCardProps) {
  const [layout, setLayout] = useState<CardLayout | null>(null);
  const status = normalizeStatus(node.status);
  const glyph = statusGlyph(node.status);

  // Compose the title as "glyph  label" so the lockup survives pretext's
  // arithmetic wrap as a single prepared text. Keeping the glyph inside the
  // prepared string means the title can wrap onto two lines and the glyph
  // stays visually anchored to line 1.
  const titleText = `${glyph}  ${node.label}`;
  const outcomeText = cleanVerdict(node.verdict) ?? '';
  const highlightText = pickHighlight(node);

  useEffect(() => {
    let cancelled = false;

    function doLayout() {
      const innerWidth = Math.max(1, width - PAD_X * 2);

      const titlePrepared = prepareWithSegments(titleText, TITLE_FONT);
      const titleResult = layoutWithLines(titlePrepared, innerWidth, TITLE_LINE_HEIGHT);

      let outcomeResult: ReturnType<typeof layoutWithLines> | null = null;
      if (outcomeText) {
        const outcomePrepared = prepareWithSegments(outcomeText, OUTCOME_FONT);
        outcomeResult = layoutWithLines(outcomePrepared, innerWidth, OUTCOME_LINE_HEIGHT);
      }

      let highlightResult: ReturnType<typeof layoutWithLines> | null = null;
      if (highlightText) {
        const highlightPrepared = prepareWithSegments(highlightText, HIGHLIGHT_FONT);
        highlightResult = layoutWithLines(highlightPrepared, innerWidth, HIGHLIGHT_LINE_HEIGHT);
      }

      // Stack vertically with gaps between regions.
      const lines: LaidOutLine[] = [];
      let y = PAD_Y;

      for (const line of titleResult.lines) {
        lines.push({
          text: line.text,
          x: PAD_X,
          y,
          font: TITLE_FONT,
          lineHeight: TITLE_LINE_HEIGHT,
          role: 'title',
        });
        y += TITLE_LINE_HEIGHT;
      }

      if (outcomeResult && outcomeResult.lines.length > 0) {
        y += TITLE_TO_OUTCOME_GAP;
        for (const line of outcomeResult.lines) {
          lines.push({
            text: line.text,
            x: PAD_X,
            y,
            font: OUTCOME_FONT,
            lineHeight: OUTCOME_LINE_HEIGHT,
            role: 'outcome',
          });
          y += OUTCOME_LINE_HEIGHT;
        }
      }

      if (highlightResult && highlightResult.lines.length > 0) {
        y += OUTCOME_TO_HIGHLIGHT_GAP;
        for (const line of highlightResult.lines) {
          lines.push({
            text: line.text,
            x: PAD_X,
            y,
            font: HIGHLIGHT_FONT,
            lineHeight: HIGHLIGHT_LINE_HEIGHT,
            role: 'highlight',
          });
          y += HIGHLIGHT_LINE_HEIGHT;
        }
      }

      const height = y + PAD_Y;

      if (!cancelled) setLayout({ height, lines });
    }

    try {
      doLayout();
    } catch (err) {
      console.error('[PretextFiberCard] layout failed', err);
    }

    return () => {
      cancelled = true;
    };
  }, [titleText, outcomeText, highlightText, width]);

  return (
    <div
      className={`pretext-card pretext-card--${status}${node.tempered ? ' pretext-card--tempered' : ''}`}
      style={{
        position: 'relative',
        width: `${width}px`,
        height: layout ? `${layout.height}px` : undefined,
        minHeight: layout ? undefined : `${PAD_Y * 2 + TITLE_LINE_HEIGHT * 2}px`,
      }}
      data-width={width}
      data-width-label={widthLabel}
    >
      {layout?.lines.map((line, i) => (
        <span
          key={i}
          className={`pretext-line pretext-line--${line.role}`}
          style={{
            position: 'absolute',
            left: `${line.x}px`,
            top: `${line.y}px`,
            font: line.font,
            lineHeight: `${line.lineHeight}px`,
            whiteSpace: 'pre',
            userSelect: 'text',
          }}
        >
          {line.text}
        </span>
      ))}
    </div>
  );
}
