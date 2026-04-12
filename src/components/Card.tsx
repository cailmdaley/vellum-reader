/**
 * Card — the unified polymorphic card primitive for Vellum.
 *
 * One public entry point that renders a Card for any of the ASTRA nouns.
 * Today: fiber, decision, insight. Tomorrow: plot, input, output, myst.
 * The goal is a single form factor — title lockup at the top, pretext-
 * composed typography, the Weathered Substrate palette — shared across
 * every surface a card appears on (narrative marginalia, workspace
 * anatomy, eventually the spatial map).
 *
 * Why a dispatcher rather than one giant component: each content type
 * carries a different data shape and a different secondary region
 * (options for a decision, evidence for an insight, a figure for a
 * plot). A common shell + type-specific body lets each variant stay
 * legible. The shared pieces — pretext title lockup, padding, status
 * colors, zoom-as-width tiers — live in the helpers below.
 *
 * `width` drives disclosure. At very small widths the card shows only
 * the title lockup; larger widths reveal summary and body content. The
 * tier thresholds mirror FiberCard so cards of different types feel
 * like siblings at the same width.
 */

import { useEffect, useState } from 'react';
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import type { FiberContent, GraphDecision, GraphFinding, GraphNode } from '~/utils/content-types';
import { cleanVerdict, normalizeStatus, statusGlyph } from '~/utils/fiber-status';
import { FiberCard } from './FiberCard';

// ── Shared typography ──────────────────────────────────────────────────────
// Named families only — pretext's accuracy depends on canvas measureText
// and DOM layout agreeing, and system-ui diverges between them on macOS.

export const CARD_TITLE_FONT = "600 16px 'EB Garamond', Georgia, serif";
export const CARD_TITLE_LINE_HEIGHT = 22;
export const CARD_BODY_FONT = "400 14px 'EB Garamond', Georgia, serif";
export const CARD_BODY_LINE_HEIGHT = 20;
export const CARD_META_FONT = "500 11px 'JetBrains Mono', monospace";
export const CARD_META_LINE_HEIGHT = 16;

export const CARD_PAD_X = 14;
export const CARD_PAD_Y = 12;
const TITLE_TO_BODY_GAP = 6;
const BODY_TO_META_GAP = 8;

// Disclosure tiers. Under COMPACT_MAX only the title lockup renders;
// between COMPACT_MAX and SUMMARY_MAX a one-line body appears; above
// SUMMARY_MAX the full body is allowed.
const COMPACT_MAX = 260;
const SUMMARY_MAX = 500;

export type CardTier = 'compact' | 'summary' | 'full';

function tierForWidth(width: number): CardTier {
  if (width < COMPACT_MAX) return 'compact';
  if (width <= SUMMARY_MAX) return 'summary';
  return 'full';
}

// ── Types ────────────────────────────────────────────────────────────────

export type CardContent =
  | { type: 'fiber'; node: GraphNode; content?: FiberContent }
  | { type: 'decision'; decision: GraphDecision; hostSlug?: string }
  | { type: 'insight'; finding: GraphFinding; hostSlug?: string }
  | { type: 'plot'; src: string; caption?: string }
  | { type: 'input'; label: string; from?: string }
  | { type: 'output'; label: string; recipe?: string }
  | { type: 'myst'; label: string; body?: string };

export interface CardProps {
  content: CardContent;
  width: number;
  className?: string;
  onClose?: () => void;
  onNavigate?: (slug: string) => void;
}

export function Card(props: CardProps) {
  const { content } = props;
  switch (content.type) {
    case 'fiber':
      return (
        <FiberCard
          node={content.node}
          content={content.content}
          width={props.width}
          className={props.className}
          onNavigate={props.onNavigate}
          onClose={props.onClose}
        />
      );
    case 'decision':
      return <DecisionCard {...props} content={content} />;
    case 'insight':
      return <InsightCard {...props} content={content} />;
    case 'plot':
    case 'input':
    case 'output':
    case 'myst':
      return <StubCard {...props} content={content} />;
  }
}

// ── Pretext line helper ──────────────────────────────────────────────────
// A laid-out line from pretext, positioned absolutely inside a card.

type LaidOutLine = {
  text: string;
  x: number;
  y: number;
  font: string;
  lineHeight: number;
  role: 'title' | 'body' | 'meta';
};

type CardLayout = {
  height: number;
  lines: LaidOutLine[];
};

/**
 * Compose a stacked pretext block: title line(s), optional body line(s),
 * optional meta line(s). Each section gets its own font and line height.
 * Returns the full card height (content + vertical padding) and the
 * absolute-positioned lines.
 */
function composeLockup(args: {
  width: number;
  title: string;
  body?: string | null;
  meta?: string | null;
  tier: CardTier;
}): CardLayout {
  const innerWidth = Math.max(1, args.width - CARD_PAD_X * 2);
  const lines: LaidOutLine[] = [];
  let y = CARD_PAD_Y;

  const titlePrepared = prepareWithSegments(args.title, CARD_TITLE_FONT);
  const titleResult = layoutWithLines(titlePrepared, innerWidth, CARD_TITLE_LINE_HEIGHT);
  for (const line of titleResult.lines) {
    lines.push({
      text: line.text,
      x: CARD_PAD_X,
      y,
      font: CARD_TITLE_FONT,
      lineHeight: CARD_TITLE_LINE_HEIGHT,
      role: 'title',
    });
    y += CARD_TITLE_LINE_HEIGHT;
  }

  const showBody = args.body && args.tier !== 'compact';
  if (showBody && args.body) {
    y += TITLE_TO_BODY_GAP;
    const bodyPrepared = prepareWithSegments(args.body, CARD_BODY_FONT);
    const bodyResult = layoutWithLines(bodyPrepared, innerWidth, CARD_BODY_LINE_HEIGHT);
    // Summary tier clips to two lines so adjacent cards stay at a
    // comparable density; full tier shows everything.
    const bodyLines = args.tier === 'summary' ? bodyResult.lines.slice(0, 2) : bodyResult.lines;
    for (const line of bodyLines) {
      lines.push({
        text: line.text,
        x: CARD_PAD_X,
        y,
        font: CARD_BODY_FONT,
        lineHeight: CARD_BODY_LINE_HEIGHT,
        role: 'body',
      });
      y += CARD_BODY_LINE_HEIGHT;
    }
  }

  const showMeta = args.meta && args.tier !== 'compact';
  if (showMeta && args.meta) {
    y += BODY_TO_META_GAP;
    const metaPrepared = prepareWithSegments(args.meta, CARD_META_FONT);
    const metaResult = layoutWithLines(metaPrepared, innerWidth, CARD_META_LINE_HEIGHT);
    for (const line of metaResult.lines) {
      lines.push({
        text: line.text,
        x: CARD_PAD_X,
        y,
        font: CARD_META_FONT,
        lineHeight: CARD_META_LINE_HEIGHT,
        role: 'meta',
      });
      y += CARD_META_LINE_HEIGHT;
    }
  }

  return { height: y + CARD_PAD_Y, lines };
}

/**
 * Low-level shell shared by every non-fiber Card. Renders the pretext
 * lines absolutely, applies the card chrome (border, palette, optional
 * close button), and lets each variant stuff additional DOM below the
 * lockup for its type-specific content (decision options, evidence
 * list, etc.) via the `below` render prop.
 */
function CardShell({
  width,
  typeLabel,
  variantClass,
  title,
  body,
  meta,
  tier,
  below,
  onClose,
  className,
}: {
  width: number;
  /** Used for data-type attribute and the status-like --type accent. */
  typeLabel: string;
  variantClass?: string;
  title: string;
  body?: string | null;
  meta?: string | null;
  tier: CardTier;
  below?: (info: { bodyStartY: number; innerWidth: number }) => React.ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  const [layout, setLayout] = useState<CardLayout | null>(null);

  useEffect(() => {
    try {
      setLayout(composeLockup({ width, title, body, meta, tier }));
    } catch (err) {
      console.error('[Card] layout failed', err);
    }
  }, [width, title, body, meta, tier]);

  const belowContent = below
    ? below({
        bodyStartY: layout?.height ?? CARD_PAD_Y * 2,
        innerWidth: Math.max(1, width - CARD_PAD_X * 2),
      })
    : null;

  return (
    <div
      className={['card', `card--${typeLabel}`, variantClass ?? '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      data-card-type={typeLabel}
      style={{ position: 'relative', width: `${width}px` }}
    >
      {onClose && (
        <button className="card__close" onClick={onClose} aria-label="Close card">
          ×
        </button>
      )}
      <div
        className="card__lockup"
        style={{ position: 'relative', height: layout ? `${layout.height}px` : undefined }}
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
      {belowContent}
    </div>
  );
}

// ── Decision ─────────────────────────────────────────────────────────────
// A decision is a choice point: label, currently-selected option (if
// any), and the excluded alternatives with reasons. The options list
// lives below the lockup in ordinary CSS flow — they're interactive in
// the sense that a user can read them line-by-line, but flipping them
// is not in scope for this gate. A later iteration wires clicks.

function DecisionCard({
  content,
  width,
  onClose,
  className,
}: CardProps & { content: Extract<CardContent, { type: 'decision' }> }) {
  const { decision } = content;
  const tier = tierForWidth(width);
  const title = `⧖  ${decision.label}`;
  // Summary body is a short synopsis — the selected option, or "open"
  // if nothing has been chosen yet.
  const body = decision.selectedLabel
    ? `→ ${decision.selectedLabel}`
    : decision.excluded.length > 0
      ? 'open — alternatives below'
      : null;
  const meta = decision.rationale ?? null;

  return (
    <CardShell
      width={width}
      typeLabel="decision"
      variantClass={decision.selectedKey ? 'card--resolved' : 'card--open'}
      title={title}
      body={tier === 'compact' ? null : body}
      meta={tier === 'full' ? meta : null}
      tier={tier}
      onClose={onClose}
      className={className}
      below={() => {
        if (tier === 'compact') return null;
        if (!decision.excluded || decision.excluded.length === 0) return null;
        return (
          <ul className="card__options" aria-label="Excluded alternatives">
            {decision.excluded.map((ex) => (
              <li key={ex.key} className="card__option">
                <span className="card__option-glyph" aria-hidden="true">✕</span>
                <span className="card__option-label">{ex.label}</span>
                {ex.reason && <span className="card__option-reason"> — {ex.reason}</span>}
              </li>
            ))}
          </ul>
        );
      }}
    />
  );
}

// ── Insight ──────────────────────────────────────────────────────────────
// An insight (a.k.a. ASTRA finding) is a claim with optional evidence.
// The claim is the body; the evidence dot (●) goes next to the title.

function InsightCard({
  content,
  width,
  onClose,
  className,
}: CardProps & { content: Extract<CardContent, { type: 'insight' }> }) {
  const { finding } = content;
  const tier = tierForWidth(width);
  const glyph = finding.hasEvidence ? '●' : '○';
  const title = `${glyph}  Insight`;

  return (
    <CardShell
      width={width}
      typeLabel="insight"
      variantClass={finding.hasEvidence ? 'card--resolved' : 'card--open'}
      title={title}
      body={finding.claim}
      meta={finding.hasEvidence ? 'has evidence' : null}
      tier={tier}
      onClose={onClose}
      className={className}
    />
  );
}

// ── Stub types (plot / input / output / myst) ───────────────────────────
// Keep the primitive complete — every declared type must render
// something — but flag the body as not-yet-wired so a reader can see
// where further work is due.

function StubCard({
  content,
  width,
  onClose,
  className,
}: CardProps & { content: Exclude<CardContent, { type: 'fiber' | 'decision' | 'insight' }> }) {
  const tier = tierForWidth(width);
  const label = (() => {
    switch (content.type) {
      case 'plot':
        return content.caption ?? content.src;
      case 'input':
        return content.label;
      case 'output':
        return content.label;
      case 'myst':
        return content.label;
    }
  })();

  return (
    <CardShell
      width={width}
      typeLabel={content.type}
      title={`${content.type} — ${label}`}
      body={`${content.type} card: rendering for this type is not yet implemented.`}
      meta={null}
      tier={tier}
      onClose={onClose}
      className={className}
    />
  );
}

// ── Helper re-exports so callers don't reach into internals ──────────
export { tierForWidth, cleanVerdict, normalizeStatus, statusGlyph };
