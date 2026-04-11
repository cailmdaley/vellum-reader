/**
 * FiberCardWithMedia — Gate 1b for Vellum Workspace.
 *
 * Sibling of `PretextFiberCard` (Gate 1a). This variant adds a fixed-geometry
 * media rectangle ("east" placement: top-right of the card) and flows the
 * outcome and highlight text around it using pretext's per-line API.
 *
 * The layout algorithm:
 *
 *   1. Title lays out full-width with `layoutWithLines`, no obstacles.
 *   2. Media rect is placed at the top-right of the content box, below
 *      the title, *if* the card is wide enough to host it (see the
 *      `media.width + MEDIA_MIN_TEXT_SLOT < innerWidth` gate).
 *   3. Outcome text is flowed line-by-line via `layoutNextLine`. For each
 *      row we compute the band `[y, y + lineHeight]`, ask `getRectIntervalsForBand`
 *      which obstacle columns it intersects, carve the base interval with
 *      `carveTextLineSlots`, pick the widest slot, and hand that width to
 *      pretext as `maxWidth`. Above and across the media, text routes on
 *      its left side; once y clears the media's bottom edge, slots open up
 *      to the full inner width and text resumes natural wrap.
 *   4. Highlights follow outcome using the same algorithm, continuing the
 *      obstacle check so a short outcome followed by a highlight still
 *      respects the media's tail rows.
 *
 * Keep the grammar small on purpose: one media slot, one placement, a fixed
 * set of text regions. See [[vellum-reader/workspace]] scope fence.
 *
 * Pretext runs client-only (OffscreenCanvas, DOM metrics). We gate all layout
 * behind a useEffect and render nothing visible until pretext returns a
 * result, mirroring `PretextFiberCard`.
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  prepareWithSegments,
  layoutWithLines,
  layoutNextLine,
  type LayoutCursor,
} from '@chenglou/pretext';
import type { GraphNode } from '~/utils/content-types';
import { cleanVerdict, normalizeStatus, statusGlyph } from '~/utils/fiber-status';
import {
  getRectIntervalsForBand,
  carveTextLineSlots,
  pickWidestSlot,
  type Rect,
} from '~/utils/wrap-geometry';

// Typographic scale — identical to Gate 1a so the two cards are visually
// interchangeable when media is absent. Fonts must be named (not system-ui)
// so pretext's canvas measurement agrees with DOM layout.
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
// Gaps between the three text regions.
const TITLE_TO_OUTCOME_GAP = 6;
const OUTCOME_TO_HIGHLIGHT_GAP = 8;

// Air around the media rectangle so body text does not kiss its edges.
const MEDIA_TEXT_GUTTER_X = 10;
const MEDIA_TEXT_GUTTER_Y = 2;
// Minimum remaining text slot required to host the media pane beside text.
// If the card can't guarantee this much runway left of the media, we drop
// the media entirely for that width and the card becomes text-only.
const MEDIA_MIN_TEXT_SLOT = 60;
// Minimum slot width body text will accept per row. Narrower than this and
// a sliver beside the media reads like scrap; we'd rather skip the band.
const OUTCOME_MIN_SLOT = 60;
const HIGHLIGHT_MIN_SLOT = 48;

// Layout safety net — should never trip on real fibers, but prevents a bad
// prepare from running forever.
const MAX_OUTCOME_LINES = 40;
const MAX_HIGHLIGHT_LINES = 10;

export type MediaPane = {
  /** Target width of the media rectangle, in CSS pixels. */
  width: number;
  /** Target height of the media rectangle, in CSS pixels. */
  height: number;
  /**
   * Where the media sits in the card frame. Gate 1b ships `east` only
   * (top-right). `south` and `plate` are reserved in the grammar.
   */
  placement: 'east';
  /** Optional accessibility label for the media pane wrapper. */
  ariaLabel?: string;
  /** Renders the visible media content (SVG, canvas, iframe, etc.). */
  render: () => ReactNode;
};

interface FiberCardWithMediaProps {
  node: GraphNode;
  width: number;
  media?: MediaPane;
}

type LaidOutLine = {
  text: string;
  /** absolute x within the card */
  x: number;
  /** absolute y within the card */
  y: number;
  font: string;
  lineHeight: number;
  role: 'title' | 'outcome' | 'highlight';
};

type CardLayout = {
  /** total card height in px (inner content + padding) */
  height: number;
  lines: LaidOutLine[];
  /** absolute placement of the media rectangle, or null if not hosted */
  media: Rect | null;
};

function pickHighlight(node: GraphNode): string | null {
  const firstDecision = node.decisions?.[0];
  if (firstDecision?.label) {
    const verdict = firstDecision.selectedLabel
      ? ` → ${firstDecision.selectedLabel}`
      : firstDecision.excluded.length > 0
        ? ' · open'
        : '';
    return `◇ ${firstDecision.label}${verdict}`;
  }
  const firstFinding = node.findings?.[0];
  if (firstFinding?.claim) {
    const trimmed = firstFinding.claim.length > 80
      ? firstFinding.claim.slice(0, 77) + '…'
      : firstFinding.claim;
    return `✦ ${trimmed}`;
  }
  if (node.tags.length > 0) {
    return node.tags.slice(0, 4).join(' · ');
  }
  return null;
}

/**
 * Flow a single prepared text through a set of rectangle obstacles, one
 * line at a time. Returns the laid-out lines and the next y position.
 *
 * This is the bit that CSS flow cannot do — each row's `maxWidth` is
 * different depending on whether the row intersects the media band.
 */
function flowAroundObstacles(
  prepared: ReturnType<typeof prepareWithSegments>,
  startY: number,
  innerLeft: number,
  innerRight: number,
  lineHeight: number,
  obstacles: Rect[],
  maxLines: number,
  minSlotWidth: number,
  role: LaidOutLine['role'],
  font: string,
): { lines: LaidOutLine[]; endY: number } {
  const out: LaidOutLine[] = [];
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
  let y = startY;

  for (let i = 0; i < maxLines; i++) {
    const bandTop = y;
    const bandBottom = y + lineHeight;
    const blocked = getRectIntervalsForBand(
      obstacles,
      bandTop,
      bandBottom,
      MEDIA_TEXT_GUTTER_X,
      MEDIA_TEXT_GUTTER_Y,
    );
    const slots = carveTextLineSlots(
      { left: innerLeft, right: innerRight },
      blocked,
      minSlotWidth,
    );
    const slot = pickWidestSlot(slots);
    if (!slot) {
      // Row is fully blocked by the media; advance past the media's bottom.
      y += lineHeight;
      continue;
    }
    const slotWidth = slot.right - slot.left;
    const line = layoutNextLine(prepared, cursor, slotWidth);
    if (!line) break;
    out.push({
      text: line.text,
      x: slot.left,
      y,
      font,
      lineHeight,
      role,
    });
    cursor = line.end;
    y += lineHeight;
  }

  return { lines: out, endY: y };
}

export function FiberCardWithMedia({ node, width, media }: FiberCardWithMediaProps) {
  const [layout, setLayout] = useState<CardLayout | null>(null);
  const status = normalizeStatus(node.status);
  const glyph = statusGlyph(node.status);

  const titleText = `${glyph}  ${node.label}`;
  const outcomeText = cleanVerdict(node.verdict) ?? '';
  const highlightText = pickHighlight(node);

  useEffect(() => {
    let cancelled = false;

    function doLayout() {
      const innerWidth = Math.max(1, width - PAD_X * 2);
      const innerLeft = PAD_X;
      const innerRight = PAD_X + innerWidth;

      // Title: full-width, no obstacles.
      const titlePrepared = prepareWithSegments(titleText, TITLE_FONT);
      const titleResult = layoutWithLines(titlePrepared, innerWidth, TITLE_LINE_HEIGHT);

      const lines: LaidOutLine[] = [];
      let y = PAD_Y;
      for (const line of titleResult.lines) {
        lines.push({
          text: line.text,
          x: innerLeft,
          y,
          font: TITLE_FONT,
          lineHeight: TITLE_LINE_HEIGHT,
          role: 'title',
        });
        y += TITLE_LINE_HEIGHT;
      }

      // Media rectangle — placed east (top-right) below the title. Only
      // host the media if enough horizontal runway remains for body text.
      // Otherwise fall through to a text-only layout; the card still flows.
      let mediaRect: Rect | null = null;
      const canHostMedia =
        media !== undefined &&
        media.width + MEDIA_TEXT_GUTTER_X + MEDIA_MIN_TEXT_SLOT <= innerWidth;

      if (outcomeText || highlightText || canHostMedia) {
        y += TITLE_TO_OUTCOME_GAP;
      }

      if (canHostMedia && media) {
        mediaRect = {
          x: innerRight - media.width,
          y,
          width: media.width,
          height: media.height,
        };
      }

      const obstacles: Rect[] = mediaRect ? [mediaRect] : [];

      // Outcome — obstacle-aware per-line flow.
      if (outcomeText) {
        const outcomePrepared = prepareWithSegments(outcomeText, OUTCOME_FONT);
        const result = flowAroundObstacles(
          outcomePrepared,
          y,
          innerLeft,
          innerRight,
          OUTCOME_LINE_HEIGHT,
          obstacles,
          MAX_OUTCOME_LINES,
          OUTCOME_MIN_SLOT,
          'outcome',
          OUTCOME_FONT,
        );
        lines.push(...result.lines);
        y = result.endY;
      }

      // Highlight — same algorithm, different font.
      if (highlightText) {
        y += OUTCOME_TO_HIGHLIGHT_GAP;
        const highlightPrepared = prepareWithSegments(highlightText, HIGHLIGHT_FONT);
        const result = flowAroundObstacles(
          highlightPrepared,
          y,
          innerLeft,
          innerRight,
          HIGHLIGHT_LINE_HEIGHT,
          obstacles,
          MAX_HIGHLIGHT_LINES,
          HIGHLIGHT_MIN_SLOT,
          'highlight',
          HIGHLIGHT_FONT,
        );
        lines.push(...result.lines);
        y = result.endY;
      }

      // Card must enclose both the text column and the media rectangle.
      const mediaBottom = mediaRect ? mediaRect.y + mediaRect.height : 0;
      const contentBottom = Math.max(y, mediaBottom);
      const height = contentBottom + PAD_Y;

      if (!cancelled) setLayout({ height, lines, media: mediaRect });
    }

    try {
      doLayout();
    } catch (err) {
      console.error('[FiberCardWithMedia] layout failed', err);
    }

    return () => {
      cancelled = true;
    };
  }, [
    titleText,
    outcomeText,
    highlightText,
    width,
    media?.width,
    media?.height,
    media?.placement,
  ]);

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
    >
      {layout?.media && media ? (
        <div
          className="pretext-card__media"
          aria-label={media.ariaLabel}
          style={{
            position: 'absolute',
            left: `${layout.media.x}px`,
            top: `${layout.media.y}px`,
            width: `${layout.media.width}px`,
            height: `${layout.media.height}px`,
          }}
        >
          {media.render()}
        </div>
      ) : null}
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
