/**
 * Card — the unified polymorphic card primitive for Vellum.
 *
 * One public entry point that renders a Card for any of the ASTRA nouns.
 * Today: fiber, decision, finding, plot, input, output.
 * The goal is a single form factor — title lockup at the top, pretext-
 * composed typography, the Weathered Substrate palette — shared across
 * every surface a card appears on (narrative marginalia, workspace
 * anatomy, eventually the spatial map).
 *
 * Why a dispatcher rather than one giant component: each content type
 * carries a different data shape and a different secondary region
 * (options for a decision, evidence for a finding, a figure for a
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
  GraphInput,
  GraphNode,
  GraphOutput,
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
export const CARD_META_FONT = "500 11px 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace";
export const CARD_META_LINE_HEIGHT = 16;

export const CARD_PAD_X = 14;
export const CARD_PAD_Y = 12;
const TITLE_TO_BODY_GAP = 6;
const BODY_TO_META_GAP = 8;

// Chrome glyphs on pinned cards: optional open-page arrow (decisions, when
// a full detail page exists), pin toggle (canvas ↔ screen), × close. All
// glyphs are quiet typographic marks so they sit in the Weathered
// Substrate palette.
const OPEN_PAGE_GLYPH = '↗';
const PIN_GLYPH = '⌖';
const CLOSE_GLYPH = '×';

// ── Types ────────────────────────────────────────────────────────────────

export type CardContent =
  | { type: 'fiber'; node: GraphNode; content?: FiberContent }
  | { type: 'decision'; decision: GraphDecision; hostSlug?: string }
  | { type: 'finding'; finding: GraphFinding; hostSlug?: string; hostNode?: GraphNode }
  | { type: 'plot'; src: string; caption?: string }
  /**
   * Input/output cards carry the full GraphInput/GraphOutput so the
   * ProvenanceCard can show description, recipe, recipe-inputs
   * (ingredients), and the `from:` ref. `hostNode` lets the card
   * resolve input ids to their descriptions for ingredient chips.
   * Callers with only a label/recipe string can still use the `label`
   * escape hatch — the card falls back to that when no structured
   * object is present.
   */
  | { type: 'input'; label?: string; input?: GraphInput; hostNode?: GraphNode; from?: string }
  | { type: 'output'; label?: string; output?: GraphOutput; hostNode?: GraphNode; recipe?: string };

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
    case 'finding':
      return <FindingCard {...props} content={content} />;
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
  kicker,
  title,
  body,
  meta,
  below,
  onClose,
  onPin,
  onOpenPage,
  openPageLabel,
  pinMode,
  className,
  ariaLabel,
}: {
  width: number;
  /** Used for data-type attribute and the status-like --type accent. */
  typeLabel: string;
  variantClass?: string;
  /** Optional kicker line rendered above the pretext lockup in IBM Plex
   *  Mono — for technical identifiers (output ids, input ids) that want
   *  a caption-label treatment rather than competing with the prose title. */
  kicker?: string | null;
  title: string;
  body?: string | null;
  meta?: string | null;
  below?: (info: { bodyStartY: number; innerWidth: number }) => React.ReactNode;
  onClose?: () => void;
  onPin?: () => void;
  /** Secondary affordance (§5): navigate to the variant's full detail
   *  page. Rendered as a small ↗ chrome glyph when set. */
  onOpenPage?: () => void;
  openPageLabel?: string;
  pinMode?: 'canvas' | 'screen';
  className?: string;
  /**
   * Accessible label for the article landmark. Variants pass a
   * descriptive label (e.g. the finding's claim, the figure's caption,
   * the decision's question) so AT users navigating by article hear
   * the content rather than the type-glyph composite (`●  Finding`).
   * Falls back to `title` when omitted.
   */
  ariaLabel?: string;
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
      role="article"
      aria-label={ariaLabel ?? title}
      className={['card', `card--${typeLabel}`, variantClass ?? '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      data-card-type={typeLabel}
      style={{ position: 'relative', width: `${width}px` }}
    >
      {(onOpenPage || onPin || onClose) && (
        <div className="card__chrome">
          {onOpenPage && (
            <button
              className="card__open-page"
              onClick={(e) => { e.stopPropagation(); onOpenPage(); }}
              aria-label={openPageLabel ?? 'Open detail page'}
              title={openPageLabel ?? 'Open detail page'}
            >
              {OPEN_PAGE_GLYPH}
            </button>
          )}
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
      {kicker && (
        <div className="card__kicker" title={kicker}>{kicker}</div>
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

type DecisionOption = {
  key: string;
  label: string;
  reason?: string;
  insights?: GraphDecision['excluded'][number]['insights'];
};

function buildOptions(decision: GraphDecision): DecisionOption[] {
  // Canonical option list: the fiber's authored selection (if any)
  // first, then each excluded alternative in authored order. When a
  // decision has no `selected`, every option lives in `excluded`.
  const options: DecisionOption[] = [];
  if (decision.selectedKey && decision.selectedLabel) {
    options.push({
      key: decision.selectedKey,
      label: decision.selectedLabel,
      insights: decision.selectedInsights,
    });
  }
  for (const ex of decision.excluded) {
    options.push({ key: ex.key, label: ex.label, reason: ex.reason, insights: ex.insights });
  }
  return options;
}

function DecisionCard({
  content,
  width,
  onClose,
  onNavigate,
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
  const title = `◇  ${decision.label}`;
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

  // Secondary affordance (§5): "open page" button that navigates to the
  // decision's detail page. Only wired when the host has a slug and the
  // caller plumbed an onNavigate — both are true inside narrative views
  // and floating context cards, but not in bare preview surfaces.
  const pageSlug = hostSlug ? `${hostSlug}/decisions/${decision.key}` : null;
  const handleOpenPage = pageSlug && onNavigate
    ? () => onNavigate(pageSlug)
    : undefined;

  return (
    <CardShell
      width={width}
      typeLabel="decision"
      variantClass={variantClass}
      title={title}
      body={body}
      meta={meta}
      ariaLabel={`Decision: ${decision.label.trim()}${effectiveOption ? ` — ${effectiveOption.label.trim()}` : ''}`}
      onClose={onClose}
      onOpenPage={handleOpenPage}
      openPageLabel="Open decision page"
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
                    {opt.insights && opt.insights.length > 0 && (
                      <ul className="card__option-insights" aria-label="Prior-insight evidence">
                        {opt.insights.map((ins) => (
                          <li key={ins.key} className="card__option-insight">
                            <span className="card__option-insight-glyph" aria-hidden="true">❝</span>
                            <span className="card__option-insight-claim">{ins.claim}</span>
                          </li>
                        ))}
                      </ul>
                    )}
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

// ── Finding ──────────────────────────────────────────────────────────────
// An ASTRA finding is a claim with optional evidence. The claim is the
// body; the title carries a presence dot, the evidence list renders below
// as the generalized §4 evidence-artifact surface.

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
  // The `insight` evidence kind is the schema-level discriminator for
  // "this evidence artifact is itself another finding." Label it as
  // Finding so the reader sees the same word everywhere.
  insight: 'Finding',
  unknown: 'Evidence',
};

function EvidenceRow({
  evidence,
  hostNode,
}: {
  evidence: GraphEvidence;
  hostNode?: GraphNode;
}) {
  const glyph = EVIDENCE_KIND_GLYPH[evidence.kind];
  const label = EVIDENCE_KIND_LABEL[evidence.kind];

  // §3 link: clicking the artifact chip opens the referenced output's
  // detail card. Dispatches the same `vellum:open-card` event the
  // NarrativeView click handler uses for anchor refs, so the card lands
  // on the Canvas with a consistent geometry.
  const openArtifact = (e: React.MouseEvent) => {
    if (!evidence.artifact || !hostNode) return;
    e.stopPropagation();
    const output = hostNode.outputs?.find((o) => o.id === evidence.artifact);
    const input = hostNode.inputs?.find((i) => i.id === evidence.artifact);
    const finding = hostNode.findings?.find((f) => f.key === evidence.artifact);
    if (output) {
      document.dispatchEvent(
        new CustomEvent('vellum:open-card', {
          detail: {
            content: { type: 'output', output, hostNode },
            x: (e.clientX ?? 0) + 12,
            y: (e.clientY ?? 0) - 12,
          },
        }),
      );
      return;
    }
    if (finding) {
      document.dispatchEvent(
        new CustomEvent('vellum:open-card', {
          detail: {
            content: { type: 'finding', finding, hostSlug: hostNode.slug },
            x: (e.clientX ?? 0) + 12,
            y: (e.clientY ?? 0) - 12,
          },
        }),
      );
      return;
    }
    if (input) {
      document.dispatchEvent(
        new CustomEvent('vellum:open-card', {
          detail: {
            content: { type: 'input', input, hostNode },
            x: (e.clientX ?? 0) + 12,
            y: (e.clientY ?? 0) - 12,
          },
        }),
      );
    }
  };

  return (
    <div className={`card__evidence card__evidence--${evidence.kind}`}>
      <div className="card__evidence-header">
        <span className="card__evidence-glyph" aria-hidden="true">{glyph}</span>
        {/*
          `.card__evidence-label` carries CSS `text-transform: uppercase`
          which Chrome includes in the accessible-name calc — without
          aria-label the heading announces "QUOTE" / "FIGURE" / "CODE" /
          "FINDING" / "EVIDENCE" instead of source case. The aria-label
          uses the original `label` value verbatim so AT users hear
          "Quote", "Figure", etc. Same pattern as AstraAppendix and
          WorkspaceAnatomy headings.
        */}
        <h4 className="card__evidence-label" aria-label={label}>{label}</h4>
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
          <button
            type="button"
            className="card__evidence-source card__evidence-source--artifact"
            title={`Open ${evidence.artifact}`}
            onClick={openArtifact}
          >
            {evidence.artifact}
          </button>
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

      {evidence.kind === 'figure' && evidence.artifact && hostNode && (() => {
        // Figure thumbnail. Clicking opens the lightbox (not a pinned
        // card) so the reader gets the full image with annotations and,
        // when available, the output's provenance panel alongside.
        const output = hostNode.outputs?.find((o) => o.id === evidence.artifact);
        const src = `/static/${hostNode.slug}/${evidence.artifact}`;
        const altText = evidence.figure?.caption ?? evidence.figure?.label ?? evidence.artifact;
        const openLightbox = (ev: React.MouseEvent) => {
          ev.stopPropagation();
          document.dispatchEvent(
            new CustomEvent('vellum:open-lightbox', {
              detail: {
                images: [{ src, alt: altText, fiberSlug: hostNode.slug, output, hostNode }],
                index: 0,
              },
            }),
          );
        };
        return (
          <button
            type="button"
            className="card__evidence-thumbnail"
            onClick={openLightbox}
            title={`Open ${evidence.artifact}`}
          >
            <img
              className="card__evidence-thumbnail-img"
              src={src}
              alt={altText}
              loading="lazy"
            />
          </button>
        );
      })()}

      {evidence.location && (evidence.location.page !== undefined || evidence.location.value) && (
        <div className="card__evidence-location">
          {evidence.location.page !== undefined && <>p. {evidence.location.page}</>}
          {evidence.location.value && <>{evidence.location.value}</>}
        </div>
      )}
    </div>
  );
}

function FindingCard({
  content,
  width,
  onClose,
  className,
}: CardProps & { content: Extract<CardContent, { type: 'finding' }> }) {
  const { finding, hostNode } = content;
  const glyph = finding.hasEvidence ? '●' : '○';
  const title = `${glyph}  Finding`;
  const evidence = finding.evidence ?? [];

  return (
    <CardShell
      width={width}
      typeLabel="finding"
      variantClass={finding.hasEvidence ? 'card--resolved' : 'card--open'}
      title={title}
      body={finding.claim}
      meta={finding.notes ?? finding.scope ?? null}
      ariaLabel={`Finding${finding.hasEvidence ? ' (with evidence)' : ' (open)'}: ${finding.claim.trim()}`}
      onClose={onClose}
      className={className}
      below={() => {
        if (evidence.length === 0) return null;
        return (
          <div className="card__evidence-list" style={{ padding: `0 ${CARD_PAD_X}px ${CARD_PAD_Y}px` }}>
            {evidence.map((e) => <EvidenceRow key={e.id} evidence={e} hostNode={hostNode} />)}
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
      ariaLabel={`Figure: ${caption.trim()}`}
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
// produces (▸ output, "recipe: …"). The card shows the id + description
// in the lockup; the meta carries the provenance ref (recipe command or
// source).
//
// §3 three-tab detail (Caption / Ingredients / Local DAG) unfolds below
// output cards. The tabs are always-visible on outputs that carry any
// non-trivial content (recipe, recipe inputs, multi-paragraph description):
// Caption is the full `description` prose, Ingredients is the recipe
// command + recipe-inputs chips, Local DAG is a 1–2-hop upstream list
// resolved against `hostNode.inputs` / `hostNode.outputs`.
//
// Inputs render with the same title/meta lockup but no tab strip — they
// have no recipe and no upstream chain to unfold.

function resolveRef(
  id: string,
  hostNode?: GraphNode,
): { kind: 'input'; node: GraphInput } | { kind: 'output'; node: GraphOutput } | null {
  const input = hostNode?.inputs?.find((i) => i.id === id);
  if (input) return { kind: 'input', node: input };
  const output = hostNode?.outputs?.find((o) => o.id === id);
  if (output) return { kind: 'output', node: output };
  return null;
}

function inputChipLabel(id: string, hostNode?: GraphNode): string {
  const resolved = resolveRef(id, hostNode);
  const descr = resolved?.kind === 'input'
    ? resolved.node.description
    : resolved?.kind === 'output'
      ? resolved.node.description
      : undefined;
  if (!descr) return id;
  const short = descr.trim().split('\n')[0];
  return short.length > 64 ? `${id} — ${short.slice(0, 60)}…` : `${id} — ${short}`;
}

type OutputTab = 'caption' | 'ingredients' | 'dag';

function ProvenanceCard({
  content,
  width,
  onClose,
  className,
}: CardProps & {
  content: Extract<CardContent, { type: 'input' | 'output' }>;
}) {
  const isInput = content.type === 'input';

  // Prefer the structured object; fall back to the legacy label/recipe
  // escape hatch for callers that haven't migrated yet.
  const input = !isInput ? undefined : content.input;
  const output = isInput ? undefined : content.output;

  const id = input?.id ?? output?.id ?? content.label ?? '';
  const description = input?.description ?? output?.description;
  // Lead with the kind heading ("Input" / "Output") the way Finding does
  // — the id is a technical handle and wants monospace; putting it in the
  // title would force Garamond on snake_case / camelCase identifiers. The
  // kicker slot renders the id above the heading in IBM Plex Mono so the
  // reader sees a caption-label lockup (id → kind heading → description)
  // instead of a bold-italic mash-up.
  const glyph = isInput ? '◂' : '▸';
  const kindLabel = isInput ? 'Input' : 'Output';
  const kicker = id || null;
  const title = `${glyph}  ${kindLabel}`;
  const body = description?.trim() ? description.trim().split('\n')[0] : null;

  // Outputs can carry both a `recipe` (hydrated from the sub-analysis on
  // the server when this is a re-export) and a `from:` pointer to where the
  // recipe actually lives. Surface both in the meta so the reader sees the
  // command and the provenance chain at a glance without expanding tabs.
  const provenance = isInput
    ? input?.from ?? input?.source ?? content.from
    : output?.recipe ?? output?.from ?? content.recipe;
  const metaLabel = isInput
    ? 'from'
    : output?.recipe
      ? (output?.from ? `recipe · forwarded from ${output.from}` : 'recipe')
      : output?.from
        ? 'from'
        : 'recipe';
  const meta = provenance ? `${metaLabel}: ${provenance}` : null;

  // Figure-kind outputs render like a finding: title + meta + the figure
  // itself, no tabs. The figure IS the content. Clicking it opens the
  // lightbox (same path as the evidence thumbnail).
  const isFigure = !isInput && output?.kind === 'figure';
  const hostSlug = content.hostNode?.slug;
  const figureSrc = isFigure && output?.id && hostSlug
    ? `/static/${hostSlug}/${output.id}`
    : null;

  // Non-figure outputs keep the §3 three-tab detail (Caption / Ingredients /
  // Local DAG). Inputs and figure outputs don't need the tab machinery —
  // inputs only carry a provenance line and figures lead with the image.
  const hasTabs = !isInput && !isFigure;

  const [tab, setTab] = useState<OutputTab>('caption');

  const openFigureInLightbox = (e: React.MouseEvent) => {
    if (!figureSrc || !output) return;
    e.stopPropagation();
    document.dispatchEvent(
      new CustomEvent('vellum:open-lightbox', {
        detail: {
          images: [{
            src: figureSrc,
            alt: description ?? output.id,
            fiberSlug: hostSlug,
            output,
            hostNode: content.hostNode,
          }],
          index: 0,
        },
      }),
    );
  };

  return (
    <CardShell
      width={width}
      typeLabel={content.type}
      kicker={kicker}
      title={title}
      body={body}
      meta={meta}
      ariaLabel={`${kindLabel}${id ? `: ${id}` : ''}${body ? ` — ${body}` : ''}`}
      onClose={onClose}
      className={className}
      below={({ innerWidth }) => {
        if (!hasTabs && !figureSrc) return null;
        return (
          <div
            className="card__detail"
            style={{ padding: `0 ${CARD_PAD_X}px ${CARD_PAD_Y}px` }}
          >
            {figureSrc && (
              <button
                type="button"
                className="card__output-figure-button"
                onClick={openFigureInLightbox}
                title="Open in lightbox"
              >
                <img
                  className="card__output-figure"
                  src={figureSrc}
                  alt={description ?? output?.id ?? 'figure'}
                  style={{ width: innerWidth, height: 'auto', display: 'block' }}
                  loading="lazy"
                />
              </button>
            )}
            {hasTabs && (
              <>
                <div className="card__detail-tabs" role="tablist">
                  <TabButton label="Caption" active={tab === 'caption'} onClick={() => setTab('caption')} />
                  <TabButton label="Ingredients" active={tab === 'ingredients'} onClick={() => setTab('ingredients')} />
                  <TabButton label="Local DAG" active={tab === 'dag'} onClick={() => setTab('dag')} />
                </div>
                <div className="card__detail-panel" role="tabpanel">
                  {tab === 'caption' && <CaptionPanel description={description} />}
                  {tab === 'ingredients' && (
                    <IngredientsPanel
                      recipeInputs={output?.recipeInputs}
                      recipe={output?.recipe}
                      from={output?.from}
                      hostNode={content.hostNode}
                    />
                  )}
                  {tab === 'dag' && (
                    <LocalDagPanel
                      recipeInputs={output?.recipeInputs}
                      hostNode={content.hostNode}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        );
      }}
    />
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`card__detail-tab${active ? ' card__detail-tab--active' : ''}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {label}
    </button>
  );
}

function CaptionPanel({ description }: { description?: string }) {
  if (!description) {
    return <div className="card__detail-empty">No caption on this output.</div>;
  }
  // The title already carries the first line; show the whole paragraph
  // here so readers who want the full caption get it without re-reading.
  return <p className="card__detail-caption">{description.trim()}</p>;
}

function IngredientsPanel({
  recipeInputs,
  recipe,
  from,
  hostNode,
}: {
  recipeInputs?: string[];
  recipe?: string;
  from?: string;
  hostNode?: GraphNode;
}) {
  const hasChips = !!recipeInputs && recipeInputs.length > 0;
  if (!hasChips && !recipe) {
    return <div className="card__detail-empty">No recipe wired on this output yet.</div>;
  }
  // When `from` is present alongside `recipe`, the server hydrated the recipe
  // from a sub-analysis that owns the output. Surface the provenance so the
  // reader knows where the command actually lives — otherwise it looks like
  // the root analysis runs the recipe directly.
  const forwardedFrom = from && recipe ? from : undefined;
  return (
    <div className="card__ingredients">
      {recipe && (
        <dl className="card__detail-recipe">
          <dt className="card__detail-label">
            {forwardedFrom ? `recipe · forwarded from ${forwardedFrom}` : 'recipe'}
          </dt>
          <dd className="card__detail-recipe-value">
            <code className="card__detail-code">{recipe}</code>
          </dd>
        </dl>
      )}
      {hasChips && (
        <>
          <h5 className="card__ingredients-label">Inputs</h5>
          <ul className="card__ingredients-list">
            {recipeInputs!.map((inp) => (
              <li key={inp} className="card__ingredient-chip" title={inp}>
                {inputChipLabel(inp, hostNode)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function LocalDagPanel({
  recipeInputs,
  hostNode,
}: {
  recipeInputs?: string[];
  hostNode?: GraphNode;
}) {
  if (!recipeInputs || recipeInputs.length === 0) {
    return <div className="card__detail-empty">No upstream inputs resolved.</div>;
  }
  return (
    <ul className="card__dag">
      {recipeInputs.map((id) => (
        <DagNode key={id} id={id} hostNode={hostNode} depth={0} />
      ))}
    </ul>
  );
}

function DagNode({
  id,
  hostNode,
  depth,
}: {
  id: string;
  hostNode?: GraphNode;
  depth: number;
}) {
  const resolved = resolveRef(id, hostNode);
  const glyph = resolved?.kind === 'output' ? '▸' : '◂';
  const descr = resolved?.kind === 'input'
    ? resolved.node.description
    : resolved?.kind === 'output'
      ? resolved.node.description
      : undefined;
  const shortDescr = descr?.trim().split('\n')[0];
  const provenance = resolved?.kind === 'input'
    ? resolved.node.from ?? resolved.node.source
    : resolved?.kind === 'output'
      ? resolved.node.recipe ?? resolved.node.from
      : undefined;

  // Walk one more hop for outputs — inputs terminate at their source/from
  // string and don't carry structured upstream on the current node.
  const upstream = resolved?.kind === 'output' && depth < 1
    ? resolved.node.recipeInputs
    : undefined;

  return (
    <li className="card__dag-node">
      <span className="card__dag-glyph" aria-hidden="true">{glyph}</span>
      <span className="card__dag-id">{id}</span>
      {shortDescr && <span className="card__dag-descr"> — {shortDescr}</span>}
      {provenance && (
        <dl className="card__dag-provenance">
          <dt className="card__detail-label">
            {resolved?.kind === 'output' ? 'recipe' : 'from'}
          </dt>
          <dd className="card__dag-provenance-value">
            <code className="card__detail-code">{provenance}</code>
          </dd>
        </dl>
      )}
      {upstream && upstream.length > 0 && (
        <ul className="card__dag card__dag--nested">
          {upstream.map((uid) => (
            <DagNode key={uid} id={uid} hostNode={hostNode} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ── Helper re-exports so callers don't reach into internals ──────────
export { cleanVerdict, normalizeStatus, statusGlyph };
