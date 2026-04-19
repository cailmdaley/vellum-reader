/**
 * Card — the unified polymorphic card primitive for Vellum.
 *
 * One public entry point that renders a Card for any of the ASTRA nouns.
 * Today: fiber, decision, insight, plot, input, output.
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
 * colors — live in the helpers below.
 *
 * Disclosure is driven by pretext's measurement of what fits at the
 * current width, not by fixed tier breakpoints. Every section renders
 * at every width; pretext wraps title/body/meta naturally as the card
 * grows or shrinks, so the hover-preview and the pinned floating card
 * — the two surfaces that share this primitive today — always render
 * the same content arranged the same way at the same width.
 */

import { useEffect, useState } from 'react';
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import type {
  FiberContent,
  GraphDecision,
  GraphEvidence,
  GraphFinding,
  GraphNode,
} from '~/utils/content-types';
import { cleanVerdict, normalizeStatus, statusGlyph } from '~/utils/fiber-status';
import { useDecisionFlip } from '~/contexts/DecisionFlipContext';
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

// Two-button chrome on pinned cards: a pin toggle (canvas ↔ screen) and
// an × close. The pin glyph is a quiet typographic mark — a textual
// pin, not an emoji — so it sits in the Weathered Substrate palette.
const PIN_GLYPH = '⌖';
const CLOSE_GLYPH = '×';

// ── Types ────────────────────────────────────────────────────────────────

export type CardContent =
  | { type: 'fiber'; node: GraphNode; content?: FiberContent }
  | { type: 'decision'; decision: GraphDecision; hostSlug?: string }
  | { type: 'insight'; finding: GraphFinding; hostSlug?: string }
  | { type: 'plot'; src: string; caption?: string }
  | { type: 'input'; label: string; from?: string }
  | { type: 'output'; label: string; recipe?: string };

export interface CardProps {
  content: CardContent;
  width: number;
  className?: string;
  /** Renders the × close button in top-right. */
  onClose?: () => void;
  /** Renders the pin toggle next to the close button. */
  onPin?: () => void;
  /** Visual mode hint for the pin glyph — `screen` highlights it in
   *  gold to show the card is floating above the page rather than
   *  riding the canvas. */
  pinMode?: 'canvas' | 'screen';
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
          onPin={props.onPin}
          pinMode={props.pinMode}
        />
      );
    case 'decision':
      return <DecisionCard {...props} content={content} />;
    case 'insight':
      return <InsightCard {...props} content={content} />;
    case 'plot':
      return <PlotCard {...props} content={content} />;
    case 'input':
    case 'output':
      return <ProvenanceCard {...props} content={content} />;
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

  if (args.body) {
    y += TITLE_TO_BODY_GAP;
    const bodyPrepared = prepareWithSegments(args.body, CARD_BODY_FONT);
    const bodyResult = layoutWithLines(bodyPrepared, innerWidth, CARD_BODY_LINE_HEIGHT);
    for (const line of bodyResult.lines) {
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

  if (args.meta) {
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
  below,
  onClose,
  onPin,
  pinMode,
  className,
}: {
  width: number;
  /** Used for data-type attribute and the status-like --type accent. */
  typeLabel: string;
  variantClass?: string;
  title: string;
  body?: string | null;
  meta?: string | null;
  below?: (info: { bodyStartY: number; innerWidth: number }) => React.ReactNode;
  onClose?: () => void;
  onPin?: () => void;
  pinMode?: 'canvas' | 'screen';
  className?: string;
}) {
  const [layout, setLayout] = useState<CardLayout | null>(null);

  useEffect(() => {
    try {
      setLayout(composeLockup({ width, title, body, meta }));
    } catch (err) {
      console.error('[Card] layout failed', err);
    }
  }, [width, title, body, meta]);

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
      {(onPin || onClose) && (
        <div className="card__chrome">
          {onPin && (
            <button
              className={`card__pin card__pin--${pinMode ?? 'canvas'}`}
              onClick={onPin}
              aria-label={pinMode === 'screen' ? 'Pin to margin' : 'Pin to screen'}
              title={pinMode === 'screen' ? 'Pinned to screen — click to re-pin to margin' : 'Pin to screen'}
            >
              {PIN_GLYPH}
            </button>
          )}
          {onClose && (
            <button className="card__close" onClick={onClose} aria-label="Close card" title="Close">
              {CLOSE_GLYPH}
            </button>
          )}
        </div>
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
// any), and the rejected alternatives with reasons. The Card unifies
// both into a single clickable option list so the reader can flip which
// option is "selected" — a visual thought experiment that persists in
// DecisionFlipContext but does not write back to the fiber.

function buildOptions(decision: GraphDecision): Array<{ key: string; label: string; reason?: string }> {
  // Canonical option list: the fiber's authored selection (if any)
  // first, then each excluded alternative in authored order. When a
  // decision has no `selected`, every option lives in `excluded`.
  const options: Array<{ key: string; label: string; reason?: string }> = [];
  if (decision.selectedKey && decision.selectedLabel) {
    options.push({ key: decision.selectedKey, label: decision.selectedLabel });
  }
  for (const ex of decision.excluded) options.push({ key: ex.key, label: ex.label, reason: ex.reason });
  return options;
}

function DecisionCard({
  content,
  width,
  onClose,
  className,
}: CardProps & { content: Extract<CardContent, { type: 'decision' }> }) {
  const { decision, hostSlug } = content;
  const { effectiveKey, isFlipped, setEffective, reset } = useDecisionFlip(
    hostSlug,
    decision.key,
    decision.selectedKey,
  );

  const options = buildOptions(decision);
  const effectiveOption = options.find((o) => o.key === effectiveKey);
  const title = `⧖  ${decision.label}`;
  const body = effectiveOption
    ? `→ ${effectiveOption.label}`
    : options.length > 0
      ? 'open — pick an option below'
      : null;
  const meta = decision.rationale ?? null;

  const isResolved = !!effectiveKey;
  const variantClass = [
    isResolved ? 'card--resolved' : 'card--open',
    isFlipped ? 'card--flipped' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <CardShell
      width={width}
      typeLabel="decision"
      variantClass={variantClass}
      title={title}
      body={body}
      meta={meta}
      onClose={onClose}
      className={className}
      below={() => {
        if (options.length === 0) return null;
        return (
          <div className="card__options-wrap">
            <ul className="card__options" aria-label="Decision options">
              {options.map((opt) => {
                const selected = opt.key === effectiveKey;
                const isAuthored = opt.key === decision.selectedKey;
                return (
                  <li
                    key={opt.key}
                    className={`card__option${selected ? ' card__option--selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="card__option-btn"
                      aria-pressed={selected}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEffective(opt.key);
                      }}
                    >
                      <span className="card__option-glyph" aria-hidden="true">
                        {selected ? '●' : '○'}
                      </span>
                      <span className="card__option-label">{opt.label}</span>
                      {isAuthored && !selected && (
                        <span className="card__option-tag" title="Authored selection">authored</span>
                      )}
                      {opt.reason && (
                        <span className="card__option-reason"> — {opt.reason}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {isFlipped && (
              <button
                type="button"
                className="card__reset"
                onClick={(e) => {
                  e.stopPropagation();
                  reset();
                }}
                title="Revert to the fiber's authored selection"
              >
                ↺ reset to authored
              </button>
            )}
          </div>
        );
      }}
    />
  );
}

// ── Insight ──────────────────────────────────────────────────────────────
// An insight (a.k.a. ASTRA finding) is a claim with optional evidence.
// The claim is the body; the title carries a presence dot, the evidence
// list renders below as the generalized §4 evidence-artifact surface.

/**
 * Short kind glyph + label for an evidence row header. Mirrors the
 * MarginCitations / AstraLegend color family so a quote-on-the-page and a
 * quote-inside-a-card read as the same kind.
 */
const EVIDENCE_KIND_GLYPH: Record<GraphEvidence['kind'], string> = {
  quote: '❝',
  figure: '▭',
  code: '‹/›',
  insight: '●',
  unknown: '?',
};
const EVIDENCE_KIND_LABEL: Record<GraphEvidence['kind'], string> = {
  quote: 'Quote',
  figure: 'Figure',
  code: 'Code',
  insight: 'Insight',
  unknown: 'Evidence',
};

function EvidenceRow({ evidence }: { evidence: GraphEvidence }) {
  const glyph = EVIDENCE_KIND_GLYPH[evidence.kind];
  const label = EVIDENCE_KIND_LABEL[evidence.kind];

  return (
    <div className={`card__evidence card__evidence--${evidence.kind}`}>
      <div className="card__evidence-header">
        <span className="card__evidence-glyph" aria-hidden="true">{glyph}</span>
        <span className="card__evidence-label">{label}</span>
        {evidence.doi && (
          <a
            className="card__evidence-source"
            href={evidence.doi.startsWith('http') ? evidence.doi : `https://doi.org/${evidence.doi}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Open source"
          >
            {evidence.doi}
          </a>
        )}
        {evidence.artifact && !evidence.doi && (
          <span className="card__evidence-source card__evidence-source--artifact" title="Artifact ref">
            {evidence.artifact}
          </span>
        )}
      </div>

      {evidence.quote?.exact && (
        <blockquote className="card__evidence-quote">
          {evidence.quote.prefix && (
            <span className="card__evidence-context">…{evidence.quote.prefix}</span>
          )}
          <span className="card__evidence-exact">{evidence.quote.exact}</span>
          {evidence.quote.suffix && (
            <span className="card__evidence-context">{evidence.quote.suffix}…</span>
          )}
        </blockquote>
      )}

      {(evidence.figure || evidence.table) && (
        <div className="card__evidence-selector">
          {evidence.figure?.label && <span>Panel: {evidence.figure.label}</span>}
          {evidence.table?.label && <span>Table: {evidence.table.label}</span>}
          {evidence.table?.region && <span> — {evidence.table.region}</span>}
        </div>
      )}

      {evidence.location && (evidence.location.page !== undefined || evidence.location.value) && (
        <div className="card__evidence-location">
          {evidence.location.page !== undefined && <>p. {evidence.location.page}</>}
          {evidence.location.value && <>{evidence.location.value}</>}
        </div>
      )}
    </div>
  );
}

function InsightCard({
  content,
  width,
  onClose,
  className,
}: CardProps & { content: Extract<CardContent, { type: 'insight' }> }) {
  const { finding } = content;
  const glyph = finding.hasEvidence ? '●' : '○';
  const title = `${glyph}  Insight`;
  const evidence = finding.evidence ?? [];

  return (
    <CardShell
      width={width}
      typeLabel="insight"
      variantClass={finding.hasEvidence ? 'card--resolved' : 'card--open'}
      title={title}
      body={finding.claim}
      meta={finding.notes ?? finding.scope ?? null}
      onClose={onClose}
      className={className}
      below={() => {
        if (evidence.length === 0) return null;
        return (
          <div className="card__evidence-list" style={{ padding: `0 ${CARD_PAD_X}px ${CARD_PAD_Y}px` }}>
            {evidence.map((e) => <EvidenceRow key={e.id} evidence={e} />)}
          </div>
        );
      }}
    />
  );
}

// ── Plot ─────────────────────────────────────────────────────────────────
// A figure/image with an optional caption. The pretext lockup carries
// the caption (or a filename fallback); the image sits below the lockup
// so the card reads title-then-figure like a published plate.

function PlotCard({
  content,
  width,
  onClose,
  className,
}: CardProps & { content: Extract<CardContent, { type: 'plot' }> }) {
  const caption = content.caption ?? filenameOf(content.src);
  const title = `▭  ${caption}`;

  return (
    <CardShell
      width={width}
      typeLabel="plot"
      title={title}
      body={null}
      meta={content.src}
      onClose={onClose}
      className={className}
      below={({ innerWidth }) => (
        <div className="card__plot" style={{ padding: `0 ${CARD_PAD_X}px ${CARD_PAD_Y}px` }}>
          <img
            className="card__plot-img"
            src={content.src}
            alt={caption}
            style={{ width: innerWidth, height: 'auto', display: 'block' }}
          />
        </div>
      )}
    />
  );
}

function filenameOf(src: string): string {
  const tail = src.split('/').pop() ?? src;
  return tail.split('?')[0] ?? tail;
}

// ── Input / Output ───────────────────────────────────────────────────────
// A data source the fiber consumes (◂ input, "from: …") or an artifact it
// produces (▸ output, "recipe: …"). Both show a label in the lockup and a
// monospace provenance line below — the raw reference is a feature, the
// reader can copy it into a query.

function ProvenanceCard({
  content,
  width,
  onClose,
  className,
}: CardProps & {
  content: Extract<CardContent, { type: 'input' | 'output' }>;
}) {
  const isInput = content.type === 'input';
  const title = `${isInput ? '◂' : '▸'}  ${content.label}`;
  const meta = isInput
    ? content.from && `from: ${content.from}`
    : content.recipe && `recipe: ${content.recipe}`;
  return (
    <CardShell
      width={width}
      typeLabel={content.type}
      title={title}
      body={null}
      meta={meta || null}
      onClose={onClose}
      className={className}
    />
  );
}

// ── Helper re-exports so callers don't reach into internals ──────────
export { cleanVerdict, normalizeStatus, statusGlyph };
