/**
 * FiberCard — pretext-composed typographic card with progressive disclosure.
 *
 * Three disclosure tiers driven by the `width` prop:
 *
 *   Compact  (width < 300)  — title lockup (status glyph + name) + outcome
 *   Summary  (300–500)      — title + outcome + first ASTRA highlight + tag row
 *   Full     (width > 500)  — summary section above a thin separator + full
 *                             prose body rendered via MyST
 *
 * Used in two contexts:
 *   1. Floating "context card" (mini-reader) in NarrativeView
 *   2. Tile on the Workspace canvas (future)
 *
 * Pretext runs client-only (OffscreenCanvas + DOM metrics). All layout fires
 * inside a useEffect; the card renders nothing visible until pretext returns a
 * real measurement, so the height is always accurate and never guessed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import { ArticleProvider } from '@myst-theme/providers';
import { MyST } from 'myst-to-react';
import type { FiberContent, GraphNode } from '~/utils/content-types';
import { cleanVerdict, normalizeStatus, statusGlyph } from '~/utils/fiber-status';

// ── Typography ──────────────────────────────────────────────────────────────
// Named families only — system-ui diverges between canvas measureText and DOM
// layout on macOS; pretext's accuracy requires they agree.

const TITLE_FONT = "600 19px 'EB Garamond', Georgia, serif";
const TITLE_LINE_HEIGHT = 25;
const OUTCOME_FONT = "400 15.5px 'EB Garamond', Georgia, serif";
const OUTCOME_LINE_HEIGHT = 22;
const HIGHLIGHT_FONT = "500 12px 'JetBrains Mono', monospace";
const HIGHLIGHT_LINE_HEIGHT = 18;

// Inner padding — pretext lines are positioned relative to the card's content
// box, so these shift the origin for the first line.
const PAD_X = 14;
const PAD_Y = 12;

// Gaps between regions.
const TITLE_TO_OUTCOME_GAP = 6;
const OUTCOME_TO_HIGHLIGHT_GAP = 8;
// Gap between the summary section and the tag row at the bottom.
const SUMMARY_TO_TAGS_GAP = 10;
// Height reserved for the tag row (one line of 11px mono).
const TAG_ROW_HEIGHT = 20;
// Gap between the pretext summary block and the prose body separator.
const SUMMARY_TO_SEPARATOR_GAP = 14;
// Height of the thin separator between summary and prose.
const SEPARATOR_HEIGHT = 1;
// Gap between separator and the prose body.
const SEPARATOR_TO_PROSE_GAP = 8;

// Tier thresholds.
const COMPACT_MAX = 300;
const SUMMARY_MAX = 500;

// ── Types ────────────────────────────────────────────────────────────────────

type DisclosureTier = 'compact' | 'summary' | 'full';

type LaidOutLine = {
  text: string;
  x: number;
  y: number;
  font: string;
  lineHeight: number;
  role: 'title' | 'outcome' | 'highlight';
};

type SummaryLayout = {
  /** Total card height (content + padding) — used for compact and summary tiers. */
  height: number;
  lines: LaidOutLine[];
  /** Y position where the summary content ends (before tags). */
  contentEndY: number;
};

export interface FiberCardProps {
  node: GraphNode;
  /** Card width in px — drives disclosure tier. */
  width: number;
  /** Required for full-prose mode (width > 500). */
  content?: FiberContent;
  className?: string;
  /** Called when a wikilink inside the prose section is clicked. */
  onNavigate?: (slug: string) => void;
  /** Renders a close button (×) in top-right when provided. */
  onClose?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tierForWidth(width: number): DisclosureTier {
  if (width < COMPACT_MAX) return 'compact';
  if (width <= SUMMARY_MAX) return 'summary';
  return 'full';
}

function pickHighlight(node: GraphNode): string | null {
  const firstDecision = node.decisions?.[0];
  if (firstDecision?.label) {
    const verdict = firstDecision.selectedLabel
      ? ` → ${firstDecision.selectedLabel}`
      : firstDecision.excluded.length > 0
        ? ' · open'
        : '';
    return `⧖ ${firstDecision.label}${verdict}`;
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

// ── Component ─────────────────────────────────────────────────────────────────

export function FiberCard({
  node,
  width,
  content,
  className,
  onNavigate,
  onClose,
}: FiberCardProps) {
  const [layout, setLayout] = useState<SummaryLayout | null>(null);
  const proseRef = useRef<HTMLDivElement>(null);

  const tier = tierForWidth(width);
  const status = normalizeStatus(node.status);

  const titleText = `${statusGlyph(node.status)}  ${node.label}`;
  const outcomeText = cleanVerdict(node.verdict) ?? '';
  // Only compute highlight for summary and full tiers.
  const highlightText = tier !== 'compact' ? pickHighlight(node) : null;
  const hasTags = tier !== 'compact' && node.tags.length > 0;

  // ── Layout effect ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    function doLayout() {
      const innerWidth = Math.max(1, width - PAD_X * 2);

      // Title — always present.
      const titlePrepared = prepareWithSegments(titleText, TITLE_FONT);
      const titleResult = layoutWithLines(titlePrepared, innerWidth, TITLE_LINE_HEIGHT);

      const lines: LaidOutLine[] = [];
      let y = PAD_Y;

      for (const line of titleResult.lines) {
        lines.push({ text: line.text, x: PAD_X, y, font: TITLE_FONT, lineHeight: TITLE_LINE_HEIGHT, role: 'title' });
        y += TITLE_LINE_HEIGHT;
      }

      // Outcome — all tiers.
      if (outcomeText) {
        y += TITLE_TO_OUTCOME_GAP;
        const outcomePrepared = prepareWithSegments(outcomeText, OUTCOME_FONT);
        const outcomeResult = layoutWithLines(outcomePrepared, innerWidth, OUTCOME_LINE_HEIGHT);
        for (const line of outcomeResult.lines) {
          lines.push({ text: line.text, x: PAD_X, y, font: OUTCOME_FONT, lineHeight: OUTCOME_LINE_HEIGHT, role: 'outcome' });
          y += OUTCOME_LINE_HEIGHT;
        }
      }

      // Highlight — summary + full tiers only.
      if (highlightText) {
        y += OUTCOME_TO_HIGHLIGHT_GAP;
        const highlightPrepared = prepareWithSegments(highlightText, HIGHLIGHT_FONT);
        const highlightResult = layoutWithLines(highlightPrepared, innerWidth, HIGHLIGHT_LINE_HEIGHT);
        for (const line of highlightResult.lines) {
          lines.push({ text: line.text, x: PAD_X, y, font: HIGHLIGHT_FONT, lineHeight: HIGHLIGHT_LINE_HEIGHT, role: 'highlight' });
          y += HIGHLIGHT_LINE_HEIGHT;
        }
      }

      const contentEndY = y;

      // Tag row — summary + full tiers.
      // For summary tier: add tag row height to the measured height.
      // For full tier: height is auto, tags still render but we don't
      // need to account for them in the pretext layout height.
      let height: number;
      if (hasTags && tier === 'summary') {
        height = contentEndY + SUMMARY_TO_TAGS_GAP + TAG_ROW_HEIGHT + PAD_Y;
      } else {
        height = contentEndY + PAD_Y;
      }

      if (!cancelled) setLayout({ height, lines, contentEndY });
    }

    try {
      doLayout();
    } catch (err) {
      console.error('[FiberCard] layout failed', err);
    }

    return () => {
      cancelled = true;
    };
  }, [titleText, outcomeText, highlightText, width, tier, hasTags]);

  // ── Click interception for wikilinks ────────────────────────────────────────
  const handleProseClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onNavigate) return;
      const target = e.target as HTMLElement;
      const anchor = target.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      // Intercept internal links (slug-style paths starting with /).
      if (href.startsWith('/')) {
        e.preventDefault();
        // Strip leading slash to get the slug.
        onNavigate(href.slice(1));
      }
    },
    [onNavigate],
  );

  // ── Separator Y — placed just below the summary content ──────────────────
  const separatorY = layout
    ? layout.contentEndY + SUMMARY_TO_SEPARATOR_GAP
    : null;

  // ── Pretext section height — used to position prose below the separator ──
  const pretextSectionHeight = separatorY !== null
    ? separatorY + SEPARATOR_HEIGHT + SEPARATOR_TO_PROSE_GAP
    : null;

  return (
    <div
      className={[
        'fiber-card',
        `fiber-card--${status}`,
        node.tempered ? 'fiber-card--tempered' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      style={{
        position: 'relative',
        width: `${width}px`,
        height: tier === 'full' ? undefined : layout ? `${layout.height}px` : undefined,
        overflow: tier === 'full' ? 'auto' : 'hidden',
      }}
    >
      {/* Close button */}
      {onClose && (
        <button className="fiber-card__close" onClick={onClose} aria-label="Close card">
          ×
        </button>
      )}

      {/* Pretext lines — title, outcome, highlight */}
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

      {/* Tag row — summary and full tiers */}
      {hasTags && layout && (
        <div
          className="fiber-card__tags"
          style={{
            position: 'absolute',
            left: PAD_X,
            bottom: tier === 'summary' ? PAD_Y - 2 : undefined,
            top: tier === 'full' ? `${layout.contentEndY + SUMMARY_TO_TAGS_GAP}px` : undefined,
          }}
        >
          {node.tags.slice(0, 4).map(tag => (
            <span key={tag} className="fiber-card__tag">{tag}</span>
          ))}
        </div>
      )}

      {/* Full tier: separator + prose body */}
      {tier === 'full' && content?.mdast && pretextSectionHeight !== null && (
        <>
          {/* Thin separator between summary and prose */}
          {separatorY !== null && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: PAD_X,
                right: PAD_X,
                top: `${separatorY}px`,
                height: `${SEPARATOR_HEIGHT}px`,
                background: 'rgba(184, 134, 11, 0.12)',
              }}
            />
          )}

          {/* Prose body — MyST for now, pretext upgrade path later */}
          <div
            ref={proseRef}
            className="fiber-card__prose"
            style={{ marginTop: `${pretextSectionHeight}px` }}
            onClick={handleProseClick}
          >
            <ArticleProvider
              kind={(content.kind as any) ?? 'Article'}
              references={content.references ?? { cite: {}, footnotes: {} }}
              frontmatter={content.frontmatter ?? {}}
            >
              <MyST ast={content.mdast} />
            </ArticleProvider>
          </div>
        </>
      )}
    </div>
  );
}
