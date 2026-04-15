/**
 * FiberCard — pretext-composed typographic card for a fiber.
 *
 * Two render shapes, chosen by whether a prose body has been fetched:
 *
 *   preview — title lockup + outcome + highlight + tags. Hover previews
 *             and any context that hasn't fetched fiber prose land here.
 *   full    — title lockup + tags + prose body. The body's lede paragraph
 *             IS the outcome, so we drop the standalone outcome line to
 *             avoid duplication.
 *
 * Line wrapping inside the lockup is continuous — pretext lays out the
 * text at the given width, so the card fills horizontally as the reader
 * drags it wider without snapping through fixed disclosure tiers.
 *
 * Pretext runs client-only (OffscreenCanvas + DOM metrics). All layout fires
 * inside a useEffect; the card renders nothing visible until pretext returns a
 * real measurement, so the height is always accurate and never guessed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import { ArticleProvider } from '@myst-theme/providers';
import { MyST } from 'myst-to-react';
import type { FiberContent, GraphNode } from '~/utils/content-types';
import { cleanVerdict, normalizeStatus, statusGlyph } from '~/utils/fiber-status';
import { assignMdastKeys } from '~/utils/mdast-keys';

// The card already renders the fiber's title and (when prose is
// absent) its outcome. When the prose body is rendered, the first few
// mdast nodes tend to restate both — a status line, the H1 title, and
// a lede paragraph that echoes the outcome. Strip them so the prose
// picks up where the header leaves off instead of repeating it.
function stripLeadingRestatement(
  mdast: any,
  titleText: string,
  outcomeText: string,
): any {
  const children = [...(mdast.children ?? [])];
  const titleLower = titleText.trim().toLowerCase();
  const outcomeLower = outcomeText.trim().toLowerCase();
  let i = 0;
  const STATUS_WORDS = new Set([
    'active', 'open', 'closed', 'suspended', 'resolved', 'unresolved', 'blocked',
  ]);

  const nodeText = (node: any): string => {
    if (!node) return '';
    if (node.value) return node.value as string;
    if (Array.isArray(node.children)) return node.children.map(nodeText).join('');
    return '';
  };

  // Optional leading status line (e.g., a bold "Active" paragraph).
  while (i < children.length && children[i].type === 'blockBreak') i++;
  if (i < children.length && children[i].type === 'paragraph') {
    const t = nodeText(children[i]).trim().toLowerCase();
    if (STATUS_WORDS.has(t)) {
      i++;
    } else {
      const firstChild = children[i].children?.[0];
      if (firstChild?.type === 'strong') {
        const boldText = nodeText(firstChild).trim().toLowerCase();
        if (STATUS_WORDS.has(boldText)) i++;
      }
    }
  }

  // Top-level heading matching the card title — drop it.
  if (i < children.length && children[i].type === 'heading') {
    const t = nodeText(children[i]).trim().toLowerCase();
    if (titleLower && (titleLower.startsWith(t) || t.startsWith(titleLower))) {
      i++;
    }
  }

  // Lede paragraph or blockquote matching the outcome — drop it.
  if (outcomeLower && i < children.length) {
    const leadNode = children[i];
    if (leadNode.type === 'paragraph' || leadNode.type === 'blockquote') {
      const t = nodeText(leadNode).trim().toLowerCase();
      if (t && (t.startsWith(outcomeLower) || outcomeLower.startsWith(t.slice(0, 80)))) {
        i++;
      }
    }
  }

  return { ...mdast, children: children.slice(i) };
}

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

const TITLE_TO_OUTCOME_GAP = 6;
const OUTCOME_TO_HIGHLIGHT_GAP = 8;
const SUMMARY_TO_TAGS_GAP = 10;
const TAG_ROW_HEIGHT = 20;

// Two affordances on a pinned fiber card: a pin toggle (canvas ↔
// screen) and an × close. Kept in sync with Card.tsx's glyphs so every
// pinned surface wears the same marks.
const PIN_GLYPH = '⌖';
const CLOSE_GLYPH = '×';

// ── Types ────────────────────────────────────────────────────────────────────

type LaidOutLine = {
  text: string;
  x: number;
  y: number;
  font: string;
  lineHeight: number;
  role: 'title' | 'outcome' | 'highlight';
};

type SummaryLayout = {
  /** Total pretext-lockup height (content + padding). Extra sections
   *  (tags, prose) flow below in normal CSS. */
  lockupHeight: number;
  lines: LaidOutLine[];
  /** Y position where the pretext content ends (before tags). */
  contentEndY: number;
};

export interface FiberCardProps {
  node: GraphNode;
  /** Card width in px — drives pretext line wrapping. */
  width: number;
  /** When provided, the prose body renders and the outcome line is
   *  dropped from the pretext header (the body's lede is the outcome). */
  content?: FiberContent;
  className?: string;
  /** Called when a wikilink inside the prose section is clicked. */
  onNavigate?: (slug: string) => void;
  /** Renders the × close button in the top-right when provided. */
  onClose?: () => void;
  /** Renders the pin toggle next to the close. */
  onPin?: () => void;
  /** Visual state for the pin glyph — highlighted in gold when the
   *  card floats above the page rather than riding the canvas. */
  pinMode?: 'canvas' | 'screen';
  /** When true, the title line is omitted from the pretext lockup.
   *  The card still lays out outcome / highlight / tags / prose as
   *  before. Used when an enclosing chrome (e.g. a pinned-card title
   *  bar on the portolan map) already carries the fiber's name and
   *  status glyph, so repeating it in the card body is pure
   *  duplication. See fiber-pin-title-duplication. */
  hideTitle?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  onPin,
  pinMode,
  hideTitle = false,
}: FiberCardProps) {
  const [layout, setLayout] = useState<SummaryLayout | null>(null);
  const proseRef = useRef<HTMLDivElement>(null);

  const status = normalizeStatus(node.status);
  // A fiber whose body is just frontmatter comes back with an mdast that has
  // zero children. Treat that as "no prose" so the preview shape (title +
  // outcome + highlight + tags) renders instead of a blank body. See
  // fiber-card-empty-body.
  const hasProse = !!content?.mdast && (content.mdast.children?.length ?? 0) > 0;

  const titleText = `${statusGlyph(node.status)}  ${node.label}`;
  // The pretext header always carries the same summary: title,
  // outcome, highlight, tags. When the prose body is also available,
  // we render it below, stripping any leading heading / lede that
  // would otherwise duplicate what the header already shows.
  const outcomeText = cleanVerdict(node.verdict) ?? '';
  const highlightText = pickHighlight(node);
  const hasTags = node.tags.length > 0;

  const strippedMdast = useMemo(() => {
    if (!content?.mdast) return null;
    const stripped = stripLeadingRestatement(content.mdast, node.label, outcomeText);
    return assignMdastKeys(stripped, `fiber:${node.label}`);
  }, [content?.mdast, node.label, outcomeText]);

  // ── Layout effect ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    function doLayout() {
      const innerWidth = Math.max(1, width - PAD_X * 2);

      const lines: LaidOutLine[] = [];
      let y = PAD_Y;

      if (!hideTitle) {
        const titlePrepared = prepareWithSegments(titleText, TITLE_FONT);
        const titleResult = layoutWithLines(titlePrepared, innerWidth, TITLE_LINE_HEIGHT);
        for (const line of titleResult.lines) {
          lines.push({ text: line.text, x: PAD_X, y, font: TITLE_FONT, lineHeight: TITLE_LINE_HEIGHT, role: 'title' });
          y += TITLE_LINE_HEIGHT;
        }
      }

      if (outcomeText) {
        if (!hideTitle) y += TITLE_TO_OUTCOME_GAP;
        const outcomePrepared = prepareWithSegments(outcomeText, OUTCOME_FONT);
        const outcomeResult = layoutWithLines(outcomePrepared, innerWidth, OUTCOME_LINE_HEIGHT);
        for (const line of outcomeResult.lines) {
          lines.push({ text: line.text, x: PAD_X, y, font: OUTCOME_FONT, lineHeight: OUTCOME_LINE_HEIGHT, role: 'outcome' });
          y += OUTCOME_LINE_HEIGHT;
        }
      }

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

      // Tag row reserves its own strip under the pretext content. When
      // prose is rendered we still show tags between the lockup and the
      // body so the fiber's classification stays visible.
      const lockupHeight = hasTags
        ? contentEndY + SUMMARY_TO_TAGS_GAP + TAG_ROW_HEIGHT + PAD_Y
        : contentEndY + PAD_Y;

      if (!cancelled) setLayout({ lockupHeight, lines, contentEndY });
    }

    try {
      doLayout();
    } catch (err) {
      console.error('[FiberCard] layout failed', err);
    }

    return () => {
      cancelled = true;
    };
  }, [titleText, outcomeText, highlightText, width, hasTags, hideTitle]);

  // ── Click interception for wikilinks ────────────────────────────────────────
  const handleProseClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onNavigate) return;
      const target = e.target as HTMLElement;
      const anchor = target.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      if (href.startsWith('/')) {
        e.preventDefault();
        onNavigate(href.slice(1));
      }
    },
    [onNavigate],
  );

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
      }}
    >
      {(onPin || onClose) && (
        <div className="fiber-card__chrome">
          {onPin && (
            <button
              className={`fiber-card__pin fiber-card__pin--${pinMode ?? 'canvas'}`}
              onClick={onPin}
              aria-label={pinMode === 'screen' ? 'Pin to margin' : 'Pin to screen'}
              title={pinMode === 'screen' ? 'Pinned to screen — click to re-pin to margin' : 'Pin to screen'}
            >
              {PIN_GLYPH}
            </button>
          )}
          {onClose && (
            <button
              className="fiber-card__close"
              onClick={onClose}
              aria-label="Close card"
              title="Close"
            >
              {CLOSE_GLYPH}
            </button>
          )}
        </div>
      )}

      {/* Pretext lockup — title (+ outcome + highlight when no prose) */}
      <div
        className="fiber-card__lockup"
        style={{ position: 'relative', height: layout ? `${layout.lockupHeight}px` : undefined }}
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

        {hasTags && layout && (
          <div
            className="fiber-card__tags"
            style={{
              position: 'absolute',
              left: PAD_X,
              top: `${layout.contentEndY + SUMMARY_TO_TAGS_GAP}px`,
            }}
          >
            {node.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="fiber-card__tag">{tag}</span>
            ))}
          </div>
        )}
      </div>

      {hasProse && strippedMdast && (
        <div
          ref={proseRef}
          className="fiber-card__prose"
          onClick={handleProseClick}
        >
          <ArticleProvider
            kind={(content!.kind as any) ?? 'Article'}
            references={content!.references ?? { cite: {}, footnotes: {} }}
            frontmatter={content!.frontmatter ?? {}}
          >
            <MyST ast={strippedMdast} />
          </ArticleProvider>
        </div>
      )}
    </div>
  );
}
