/**
 * PretextProse — renders a MyST mdast tree through @chenglou/pretext.
 *
 * Gate 1 of the pretext refoundation (.felt/vellum-vite-migration/pretext-
 * refoundation/pretext-refoundation.md). The role here is deliberately narrow:
 *
 *   - Pretext owns line wrapping for paragraphs, headings, bullets, inline
 *     code, and links — the "minimum viable pretext prose renderer" the
 *     constitution's Narrative section asks for.
 *   - Anything outside that subset (images, admonitions, cross-refs, footnotes,
 *     tables, figures…) renders as a visible `[unknown: nodeType]` placeholder
 *     so survey catches what's actually missing on real fibers, rather than
 *     silently hiding it.
 *   - Text is real DOM. Each line becomes a `.pretext-prose-line` span absolute-
 *     positioned within a container whose height is pretext's total. Native
 *     selection works because the spans carry text nodes; Gate 2 will read
 *     positions directly off these elements instead of `getBoundingClientRect`.
 *
 * Canonical reference is `vellum/vendor/pretext/pages/demos/markdown-chat.model.ts`:
 * the two-phase prepared-template / rich-inline flow pattern here is that
 * demo boiled down for vellum's single-fiber body rather than virtualized
 * chat bubbles.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { MyST } from 'myst-to-react';
import {
  layoutWithLines,
  prepareWithSegments,
  type LayoutLine,
  type PreparedTextWithSegments,
} from '@chenglou/pretext';
import {
  materializeRichInlineLineRange,
  measureRichInlineStats,
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
} from '@chenglou/pretext/rich-inline';

// ───────────────────── Typography ─────────────────────
// Named families only — `system-ui` diverges between canvas measureText and
// DOM layout on macOS per pretext's README and would silently break accuracy.

const SERIF = "'EB Garamond', Georgia, 'Times New Roman', serif";
const MONO = "'IBM Plex Mono', 'JetBrains Mono', 'Courier New', ui-monospace, monospace";

// Sizes are kept close to the existing `.vellum-prose` CSS so the pretext
// column reads like the mystra-rendered column next door.
const BODY_SIZE = 18;
const BODY_LINE_HEIGHT = 32; // ~1.78 leading

const H1_SIZE = 36;
const H1_LINE_HEIGHT = 45;
const H2_SIZE = 25;
const H2_LINE_HEIGHT = 32;
const H3_SIZE = 21;
const H3_LINE_HEIGHT = 28;
const H4_SIZE = 18;
const H4_LINE_HEIGHT = 24;

const INLINE_CODE_SIZE = 14;
const BLOCK_CODE_LINE_HEIGHT = 24;

const LIST_INDENT = 24;
const LIST_MARKER_GAP = 10;
const BLOCKQUOTE_INDENT = 24;

// Block spacing — keyed to feel like the mystra column rhythm.
const BODY_BLOCK_GAP = 20;
const HEADING_TOP_GAP = { 1: 0, 2: 36, 3: 28, 4: 24 } as const;
const HEADING_BOTTOM_GAP = { 1: 12, 2: 10, 3: 8, 4: 6 } as const;
const CODE_BLOCK_GAP = 22;
const CODE_PADDING_Y = 10;
const RULE_GAP = 32;
const RULE_HEIGHT = 18;
const ISLAND_GAP = 22;

// ───────────────────── Table constants ─────────────────────
// Native pretext table renderer (step 4 of the pretext refoundation).
// Sizes deliberately parallel `.vellum-prose table` from vellum.css: a slightly
// smaller body font than prose, uppercase-mono headers, per-row bottom borders.
// Expressed in px because pretext measures everything with the same canvas
// metrics the browser will render with.
const TABLE_CELL_SIZE = 14;
const TABLE_CELL_LINE_HEIGHT = 22;
const TABLE_HEADER_SIZE = 12;
const TABLE_HEADER_LINE_HEIGHT = 20;
const TABLE_CELL_PAD_X = 12;
const TABLE_CELL_PAD_Y = 10;
const TABLE_HEADER_PAD_Y = 10;
const TABLE_MIN_COL_WIDTH = 60;
const TABLE_BLOCK_GAP = 26;

type HeadingDepth = 1 | 2 | 3 | 4;

function bodyFont(bold: boolean, italic: boolean): string {
  const weight = bold ? 700 : 400;
  return `${italic ? 'italic ' : ''}${weight} ${BODY_SIZE}px ${SERIF}`;
}

function headingFont(depth: HeadingDepth, bold: boolean, italic: boolean): string {
  const italicPrefix = italic || depth === 4 ? 'italic ' : '';
  const weight = depth === 1 || depth === 2 ? 600 : 600;
  const size =
    depth === 1 ? H1_SIZE : depth === 2 ? H2_SIZE : depth === 3 ? H3_SIZE : H4_SIZE;
  // depth === 4 is italic by design (matches .vellum-prose h4)
  const w = bold ? 700 : weight;
  return `${italicPrefix}${w} ${size}px ${SERIF}`;
}

function headingLineHeight(depth: HeadingDepth): number {
  return depth === 1
    ? H1_LINE_HEIGHT
    : depth === 2
      ? H2_LINE_HEIGHT
      : depth === 3
        ? H3_LINE_HEIGHT
        : H4_LINE_HEIGHT;
}

// ───────────────────── Mark state + inline piece ─────────────────────

type MarkState = {
  bold: boolean;
  italic: boolean;
  href: string | null;
  code: boolean;
  strike: boolean;
};

const EMPTY_MARKS: MarkState = {
  bold: false,
  italic: false,
  href: null,
  code: false,
  strike: false,
};

type InlinePiece = {
  text: string;
  font: string;
  breakMode: 'normal' | 'never';
  className: string;
  href: string | null;
};

type Variant = 'body' | HeadingDepth;

function inlineFont(variant: Variant, marks: MarkState): string {
  if (marks.code) {
    // Inline code rendered in mono at body size — no heading inline-code promotion.
    return `500 ${INLINE_CODE_SIZE}px ${MONO}`;
  }
  if (variant === 'body') return bodyFont(marks.bold, marks.italic);
  return headingFont(variant, marks.bold, marks.italic);
}

function inlineClassName(variant: Variant, marks: MarkState): string {
  const cls = ['pretext-prose-frag'];
  if (variant === 'body') cls.push('pretext-prose-frag--body');
  else cls.push(`pretext-prose-frag--h${variant}`);
  if (marks.bold) cls.push('is-strong');
  if (marks.italic) cls.push('is-em');
  if (marks.code) cls.push('is-code');
  if (marks.strike) cls.push('is-strike');
  if (marks.href) {
    cls.push('is-link');
    // ASTRA anchor refs (`#findings.id`, `#decisions.id`, …) get a kind-
    // colored underline so the reading eye can triage references without
    // leaving the prose column. Parsing is intentionally light here — the
    // shared `astra-anchor` utility is used at the margin layer where the
    // full graph is available; this surface only needs the top-level
    // category token. A malformed anchor still receives the generic
    // `is-link` treatment.
    const href = marks.href;
    const withoutParents = href.replace(/^(?:\.\.\/)+/, '');
    if (withoutParents.startsWith('#')) {
      const body = withoutParents.slice(1);
      const firstDot = body.indexOf('.');
      const head = firstDot >= 0 ? body.slice(0, firstDot) : body;
      cls.push('astra-anchor');
      switch (head) {
        case 'findings':
        case 'prior_insights':
          cls.push('astra-anchor--findings');
          break;
        case 'decisions':
          cls.push('astra-anchor--decisions');
          break;
        case 'outputs':
          cls.push('astra-anchor--outputs');
          break;
        case 'inputs':
          cls.push('astra-anchor--inputs');
          break;
        case 'analyses':
          cls.push('astra-anchor--analyses');
          break;
        default:
          // Sub-analysis-scoped anchor (`#<sub>.<category>.<id>`) or heading
          // anchor (`#abstract`). The margin layer resolves these properly;
          // here we just drop back to neutral underline.
          break;
      }
    }
  }
  return cls.join(' ');
}

function nodeToText(node: any): string {
  if (typeof node?.value === 'string') return node.value;
  if (Array.isArray(node?.children)) return node.children.map(nodeToText).join('');
  return '';
}

// Walk one paragraph's inline children and emit a flat list of InlinePieces
// that can be prepared with rich-inline. Mark state (bold/italic/link/code)
// propagates into each leaf piece.
function collectInlinePieces(
  children: any[] | undefined,
  variant: Variant,
  initialMarks: MarkState = EMPTY_MARKS,
): InlinePiece[] {
  const out: InlinePiece[] = [];

  function pushText(text: string, marks: MarkState): void {
    if (!text) return;
    // Merge with the previous piece if the attribute set matches — keeps
    // pretext's break analysis happier across adjacent plain-text nodes.
    const prev = out[out.length - 1];
    const font = inlineFont(variant, marks);
    const className = inlineClassName(variant, marks);
    if (
      prev &&
      prev.font === font &&
      prev.className === className &&
      prev.href === marks.href &&
      prev.breakMode === 'normal'
    ) {
      prev.text += text;
      return;
    }
    out.push({
      text,
      font,
      breakMode: 'normal',
      className,
      href: marks.href,
    });
  }

  function walk(nodes: any[] | undefined, marks: MarkState): void {
    if (!nodes) return;
    for (const node of nodes) {
      if (!node) continue;
      switch (node.type) {
        case 'text':
          pushText(node.value ?? '', marks);
          break;
        case 'strong':
          walk(node.children, { ...marks, bold: true });
          break;
        case 'emphasis':
          walk(node.children, { ...marks, italic: true });
          break;
        case 'delete':
          // GFM strikethrough. One use in the surveyed corpus, cheap enough
          // to handle natively so it doesn't fall through to a compat island.
          walk(node.children, { ...marks, strike: true });
          break;
        case 'inlineCode':
          pushText(node.value ?? '', { ...marks, code: true });
          break;
        case 'link':
          walk(node.children, { ...marks, href: node.url ?? null });
          break;
        case 'crossReference':
        case 'wikiLink':
        case 'abbreviation':
          // Treat as plain text for Gate 1.
          pushText(nodeToText(node), marks);
          break;
        case 'break':
          // Explicit soft break — render as a space (pretext handles wrap).
          pushText(' ', marks);
          break;
        default:
          // Fall through to text extraction so footnote/ref nodes still read.
          pushText(nodeToText(node), marks);
      }
    }
  }

  walk(children, initialMarks);
  return out;
}

// ───────────────────── Prepared block model ─────────────────────

type InlineBlock = {
  kind: 'inline';
  variant: Variant;
  flow: PreparedRichInline;
  pieces: InlinePiece[];
  lineHeight: number;
  marginTop: number;
  marginBottom: number;
  contentLeft: number;
  /** Optional list marker painted in the gutter before the first line. */
  marker?: { text: string; font: string; left: number };
  /** Blockquote rail left positions inside the block's origin. */
  blockquoteRailLefts: number[];
};

type CodeBlock = {
  kind: 'code';
  prepared: PreparedTextWithSegments;
  marginTop: number;
  marginBottom: number;
  contentLeft: number;
  blockquoteRailLefts: number[];
};

type RuleBlock = {
  kind: 'rule';
  marginTop: number;
  marginBottom: number;
  contentLeft: number;
  blockquoteRailLefts: number[];
};

type IslandBlock = {
  kind: 'island';
  label: string;
  detail: string;
  marginTop: number;
  marginBottom: number;
  contentLeft: number;
  blockquoteRailLefts: number[];
};

type CompatIslandBlock = {
  kind: 'compatIsland';
  /**
   * Stable index assigned during parse — survives re-renders with the same
   * mdast tree so the height map survives re-layout, and the ResizeObserver
   * measurements stay wired to the right block.
   */
  key: number;
  /** The raw mdast subtree handed off to the host renderer. */
  node: any;
  marginTop: number;
  marginBottom: number;
  contentLeft: number;
  blockquoteRailLefts: number[];
};

type TableAlign = 'left' | 'center' | 'right';

type TableCellPrepared = {
  flow: PreparedRichInline;
  pieces: InlinePiece[];
  /** Natural (unwrapped) max line width in px, measured once at parse time. */
  naturalWidth: number;
  lineHeight: number;
  align: TableAlign;
  isHeader: boolean;
};

type TableBlock = {
  kind: 'table';
  /** Rows × cols of prepared cell flows. Ragged rows are padded with empties. */
  rows: TableCellPrepared[][];
  colCount: number;
  marginTop: number;
  marginBottom: number;
  contentLeft: number;
  blockquoteRailLefts: number[];
};

type Block =
  | InlineBlock
  | CodeBlock
  | RuleBlock
  | IslandBlock
  | CompatIslandBlock
  | TableBlock;

type ParseCtx = {
  listDepth: number;
  quoteDepth: number;
  /**
   * Running counter incremented whenever we emit a `compatIsland` block.
   * Lives on the context so nested calls share one key space and the
   * resulting keys line up with the render order (and therefore with the
   * heightMap).
   */
  islandCounter: { count: number };
  /**
   * When true, unknown node types turn into compat islands (the host will
   * render them via myst-to-react). When false, they fall through to the
   * visible `[label]` debug placeholder used by PretextFiberCard where no
   * compat path is available.
   */
  useCompatIslands: boolean;
};

function emptyCtx(useCompatIslands = false): ParseCtx {
  return {
    listDepth: 0,
    quoteDepth: 0,
    islandCounter: { count: 0 },
    useCompatIslands,
  };
}

function contentLeftFor(ctx: ParseCtx): number {
  return ctx.listDepth * LIST_INDENT + ctx.quoteDepth * BLOCKQUOTE_INDENT;
}

function quoteRails(ctx: ParseCtx): number[] {
  const out: number[] = [];
  for (let i = 0; i < ctx.quoteDepth; i++) {
    out.push(ctx.listDepth * LIST_INDENT + i * BLOCKQUOTE_INDENT + 4);
  }
  return out;
}

function buildInlineBlock(
  children: any[] | undefined,
  variant: Variant,
  ctx: ParseCtx,
): InlineBlock | null {
  const pieces = collectInlinePieces(children, variant);
  if (pieces.length === 0) return null;

  const flow = prepareRichInline(
    pieces.map((p) => ({
      text: p.text,
      font: p.font,
      break: p.breakMode,
      extraWidth: 0,
    })),
  );

  const [marginTop, marginBottom] =
    variant === 'body'
      ? [0, BODY_BLOCK_GAP]
      : [HEADING_TOP_GAP[variant], HEADING_BOTTOM_GAP[variant]];

  const lineHeight = variant === 'body' ? BODY_LINE_HEIGHT : headingLineHeight(variant);

  return {
    kind: 'inline',
    variant,
    flow,
    pieces,
    lineHeight,
    marginTop,
    marginBottom,
    contentLeft: contentLeftFor(ctx),
    blockquoteRailLefts: quoteRails(ctx),
  };
}

function buildCodeBlock(value: string, ctx: ParseCtx): CodeBlock {
  const prepared = prepareWithSegments(
    value.replace(/\n$/, ''),
    `500 ${INLINE_CODE_SIZE}px ${MONO}`,
    { whiteSpace: 'pre-wrap' },
  );
  return {
    kind: 'code',
    prepared,
    marginTop: CODE_BLOCK_GAP,
    marginBottom: CODE_BLOCK_GAP,
    contentLeft: contentLeftFor(ctx),
    blockquoteRailLefts: quoteRails(ctx),
  };
}

function buildRuleBlock(ctx: ParseCtx): RuleBlock {
  return {
    kind: 'rule',
    marginTop: RULE_GAP,
    marginBottom: RULE_GAP,
    contentLeft: contentLeftFor(ctx),
    blockquoteRailLefts: quoteRails(ctx),
  };
}

function buildIslandBlock(node: any, ctx: ParseCtx): IslandBlock {
  const label = typeof node?.type === 'string' ? node.type : 'unknown';
  const detail = nodeToText(node).slice(0, 120);
  return {
    kind: 'island',
    label,
    detail,
    marginTop: ISLAND_GAP,
    marginBottom: ISLAND_GAP,
    contentLeft: contentLeftFor(ctx),
    blockquoteRailLefts: quoteRails(ctx),
  };
}

function buildCompatIslandBlock(node: any, ctx: ParseCtx): CompatIslandBlock {
  const key = ctx.islandCounter.count++;
  return {
    kind: 'compatIsland',
    key,
    node,
    marginTop: ISLAND_GAP,
    marginBottom: ISLAND_GAP,
    contentLeft: contentLeftFor(ctx),
    blockquoteRailLefts: quoteRails(ctx),
  };
}

function buildUnknownBlock(node: any, ctx: ParseCtx): IslandBlock | CompatIslandBlock {
  return ctx.useCompatIslands
    ? buildCompatIslandBlock(node, ctx)
    : buildIslandBlock(node, ctx);
}

// Construct a table block. MyST's `table` carries an `align` array per column
// plus `tableRow` → `tableCell` children; the first row is the header. Cell
// children are treated as inline-only for the current corpus (no cell in
// surveyed fibers carries block content like a nested list); any unknown
// cell-level node falls through the normal inline extraction path in
// `collectInlinePieces`. Column-width allocation happens later in layout —
// here we only do the work that does not depend on `contentWidth`.
function buildTableBlock(node: any, ctx: ParseCtx): TableBlock | null {
  const rowNodes: any[] = Array.isArray(node?.children) ? node.children : [];
  const rawRows = rowNodes.filter((r) => r && r.type === 'tableRow');
  if (rawRows.length === 0) return null;

  const colCount = rawRows.reduce(
    (max, row) => Math.max(max, Array.isArray(row.children) ? row.children.length : 0),
    0,
  );
  if (colCount === 0) return null;

  const aligns: TableAlign[] = [];
  for (let c = 0; c < colCount; c++) {
    const raw = Array.isArray(node.align) ? node.align[c] : null;
    aligns.push(raw === 'center' || raw === 'right' ? raw : 'left');
  }

  const prepareCell = (cellNode: any, isHeader: boolean, align: TableAlign): TableCellPrepared => {
    const variant: Variant = 'body';
    // Headers use the existing body font stream but with a bold mark so
    // `prepareRichInline` lays them out at the right advance widths. The
    // actual font swap to mono/uppercase happens at render time via the
    // `pretext-prose-table__header` class — the measurement cost of that
    // swap is negligible in the current corpus (short header labels), so
    // keeping the layout font identical to body content sidesteps a
    // second font string per cell.
    const headerMarks: MarkState = isHeader
      ? { ...EMPTY_MARKS, bold: true }
      : EMPTY_MARKS;
    const children: any[] = Array.isArray(cellNode?.children) ? cellNode.children : [];
    const pieces = collectInlinePieces(children, variant, headerMarks);
    if (pieces.length === 0) {
      // Placeholder empty flow so we still reserve a cell slot.
      const emptyFlow = prepareRichInline([
        { text: '', font: inlineFont('body', EMPTY_MARKS), break: 'normal', extraWidth: 0 },
      ]);
      return {
        flow: emptyFlow,
        pieces: [],
        naturalWidth: 0,
        lineHeight: isHeader ? TABLE_HEADER_LINE_HEIGHT : TABLE_CELL_LINE_HEIGHT,
        align,
        isHeader,
      };
    }
    const flow = prepareRichInline(
      pieces.map((p) => ({
        text: p.text,
        font: p.font,
        break: p.breakMode,
        extraWidth: 0,
      })),
    );
    // Natural width = max line width when no wrapping is forced. 1e6 is well
    // past any real column bound and avoids a degenerate "fit on one line"
    // edge case. `measureRichInlineStats` returns the widest line; with a
    // huge bound there is only one line, so `maxLineWidth` is the unwrapped
    // content width.
    const stats = measureRichInlineStats(flow, 1_000_000);
    return {
      flow,
      pieces,
      naturalWidth: stats.maxLineWidth,
      lineHeight: isHeader ? TABLE_HEADER_LINE_HEIGHT : TABLE_CELL_LINE_HEIGHT,
      align,
      isHeader,
    };
  };

  const rows: TableCellPrepared[][] = rawRows.map((row, rowIdx) => {
    const isHeader = rowIdx === 0;
    const cellNodes: any[] = Array.isArray(row.children) ? row.children : [];
    const out: TableCellPrepared[] = [];
    for (let c = 0; c < colCount; c++) {
      const cellNode = cellNodes[c];
      out.push(prepareCell(cellNode ?? { children: [] }, isHeader, aligns[c]));
    }
    return out;
  });

  return {
    kind: 'table',
    rows,
    colCount,
    marginTop: TABLE_BLOCK_GAP,
    marginBottom: TABLE_BLOCK_GAP,
    contentLeft: contentLeftFor(ctx),
    blockquoteRailLefts: quoteRails(ctx),
  };
}

function parseBlocks(nodes: any[] | undefined, ctx: ParseCtx): Block[] {
  if (!nodes) return [];
  const out: Block[] = [];

  for (const node of nodes) {
    if (!node) continue;
    switch (node.type) {
      case 'blockBreak':
        // mystra emits a frontmatter delimiter; ignore.
        continue;
      case 'paragraph': {
        // Paragraphs can hold inherently-block content as inline children —
        // most commonly a lone `image` node, which mdast classifies as
        // phrasing even though it's really a block-level figure. Walk the
        // children, buffer consecutive inline nodes, and flush the buffer
        // each time we hit a block-ish child (currently: `image`). Each
        // block-ish child becomes its own compat island so MyST renders
        // the actual `<img>`, and the inline runs before/after keep their
        // text composition. Without this split, `collectInlinePieces`'s
        // `default` branch would call `nodeToText` on the image and push
        // the empty string, silently dropping it.
        const children: any[] = Array.isArray(node.children) ? node.children : [];
        const inlineBuffer: any[] = [];
        const flushInline = () => {
          if (inlineBuffer.length === 0) return;
          const block = buildInlineBlock(inlineBuffer.slice(), 'body', ctx);
          if (block) out.push(block);
          inlineBuffer.length = 0;
        };
        for (const child of children) {
          if (child && child.type === 'image') {
            flushInline();
            if (ctx.useCompatIslands) {
              out.push(buildCompatIslandBlock(child, ctx));
            } else {
              out.push(buildIslandBlock(child, ctx));
            }
          } else {
            inlineBuffer.push(child);
          }
        }
        flushInline();
        continue;
      }
      case 'heading': {
        const depth = (Math.min(4, Math.max(1, node.depth ?? 1)) as HeadingDepth);
        const block = buildInlineBlock(node.children, depth, ctx);
        if (block) out.push(block);
        continue;
      }
      case 'list': {
        const items = Array.isArray(node.children) ? node.children : [];
        const itemCtx: ParseCtx = {
          ...ctx,
          listDepth: ctx.listDepth + 1,
        };
        const ordered: boolean = node.ordered === true;
        const start: number = typeof node.start === 'number' ? node.start : 1;
        items.forEach((item: any, index: number) => {
          const itemBlocks = parseBlocks(item.children, itemCtx);
          if (itemBlocks.length === 0) return;
          const first = itemBlocks[0];
          // Attach a marker to the first inline block of the item.
          if (first.kind === 'inline') {
            const markerText = ordered ? `${start + index}.` : '•';
            first.marker = {
              text: markerText,
              font: bodyFont(false, false),
              left: first.contentLeft - LIST_MARKER_GAP,
            };
          }
          // Collapse the in-list paragraph bottom margin so list items
          // pack closer together.
          for (const b of itemBlocks) {
            if (b.kind === 'inline' && b.variant === 'body') {
              b.marginBottom = 6;
            }
          }
          out.push(...itemBlocks);
        });
        // Restore a list-wide bottom gap on the last block.
        if (out.length > 0) {
          const last = out[out.length - 1];
          last.marginBottom = BODY_BLOCK_GAP;
        }
        continue;
      }
      case 'blockquote': {
        const inner = parseBlocks(node.children, {
          ...ctx,
          quoteDepth: ctx.quoteDepth + 1,
        });
        out.push(...inner);
        continue;
      }
      case 'code': {
        out.push(buildCodeBlock(node.value ?? '', ctx));
        continue;
      }
      case 'thematicBreak':
        out.push(buildRuleBlock(ctx));
        continue;
      case 'table': {
        const block = buildTableBlock(node, ctx);
        if (block) out.push(block);
        else out.push(buildUnknownBlock(node, ctx));
        continue;
      }
      case 'text':
      case 'strong':
      case 'emphasis':
      case 'link':
      case 'inlineCode': {
        // Naked inline at block position — wrap in a body paragraph.
        const block = buildInlineBlock([node], 'body', ctx);
        if (block) out.push(block);
        continue;
      }
      default:
        out.push(buildUnknownBlock(node, ctx));
        continue;
    }
  }

  return out;
}

// ───────────────────── Layout + materialization ─────────────────────

type InlineLineLayout = {
  kind: 'inline';
  variant: Variant;
  top: number;
  left: number;
  width: number;
  lineHeight: number;
  /**
   * True for the first wrapped line of the source inline block. Headings
   * emit their semantic tag (h1…h4) only on this line so that the
   * GhostToc scanner and anything else scanning for real heading elements
   * still finds exactly one element per source heading, even when the
   * heading wraps.
   */
  isFirstLine: boolean;
  fragments: Array<{
    leadingGap: number;
    text: string;
    /**
     * Pretext's prepared font string for this fragment, e.g.
     * "600 25px 'EB Garamond', Georgia, serif". We apply it as an inline
     * `font` shorthand on the span so the browser renders at the same
     * metrics pretext used to measure — otherwise heading fragments
     * inherit the body font-size through CSS cascade and the line widths
     * stop matching their visual size.
     */
    font: string;
    className: string;
    href: string | null;
  }>;
  marker?: { text: string; font: string; left: number };
  blockquoteRailLefts: number[];
};

type CodeLineLayout = {
  kind: 'code';
  top: number;
  left: number;
  lines: LayoutLine[];
  width: number;
  paddedHeight: number;
  blockquoteRailLefts: number[];
};

type RuleLayout = {
  kind: 'rule';
  top: number;
  left: number;
  width: number;
  variant?: 'heading';
  blockquoteRailLefts: number[];
};

type IslandLayout = {
  kind: 'island';
  label: string;
  detail: string;
  top: number;
  left: number;
  width: number;
  blockquoteRailLefts: number[];
};

type CompatIslandLayout = {
  kind: 'compatIsland';
  key: number;
  node: any;
  top: number;
  left: number;
  width: number;
  height: number;
  blockquoteRailLefts: number[];
};

type TableCellLineFragment = {
  leadingGap: number;
  text: string;
  font: string;
  className: string;
  href: string | null;
};

type TableCellLine = {
  /** Top offset relative to the cell's text area (above padding). */
  top: number;
  fragments: TableCellLineFragment[];
};

type TableCellLayout = {
  colIndex: number;
  rowIndex: number;
  lines: TableCellLine[];
  align: TableAlign;
  isHeader: boolean;
  /** Cell box width (including padding). */
  width: number;
  /** Cell box height (including padding). */
  height: number;
  /** Horizontal offset of the cell inside the table. */
  left: number;
  /** Vertical offset of the cell inside the table. */
  top: number;
  lineHeight: number;
};

type TableLayout = {
  kind: 'table';
  top: number;
  left: number;
  width: number;
  totalHeight: number;
  cells: TableCellLayout[];
  rowCount: number;
  blockquoteRailLefts: number[];
};

type LineLayout =
  | InlineLineLayout
  | CodeLineLayout
  | RuleLayout
  | IslandLayout
  | CompatIslandLayout
  | TableLayout;

type ProseLayout = {
  totalHeight: number;
  items: LineLayout[];
};

/**
 * Default reserved height for a compat island whose real height hasn't been
 * measured yet. Chosen to be tall enough that most islands (images, tables,
 * a collapsed `<details>`) don't cause a jarring reflow when the real height
 * snaps in, but short enough that an empty heightMap doesn't balloon the
 * whole prose column.
 */
const COMPAT_ISLAND_FALLBACK_HEIGHT = 120;

function layoutBlocks(
  blocks: Block[],
  contentWidth: number,
  heightMap: Map<number, number>,
): ProseLayout {
  const items: LineLayout[] = [];
  let y = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (i > 0) y += block.marginTop;
    else y += 0; // no leading top gap

    switch (block.kind) {
      case 'inline': {
        const availableWidth = Math.max(1, contentWidth - block.contentLeft);
        const lineTop = y;
        let lineIndex = 0;
        walkRichInlineLineRanges(block.flow, availableWidth, (range) => {
          const line = materializeRichInlineLineRange(block.flow, range);
          const fragments = line.fragments.map((frag) => {
            const piece = block.pieces[frag.itemIndex];
            return {
              leadingGap: frag.gapBefore,
              text: frag.text,
              font: piece?.font ?? inlineFont(block.variant, EMPTY_MARKS),
              className: piece?.className ?? 'pretext-prose-frag',
              href: piece?.href ?? null,
            };
          });
          items.push({
            kind: 'inline',
            variant: block.variant,
            top: lineTop + lineIndex * block.lineHeight,
            left: block.contentLeft,
            width: availableWidth,
            lineHeight: block.lineHeight,
            isFirstLine: lineIndex === 0,
            fragments,
            marker: lineIndex === 0 ? block.marker : undefined,
            blockquoteRailLefts: block.blockquoteRailLefts,
          });
          lineIndex++;
        });
        if (lineIndex === 0) lineIndex = 1; // reserve at least one line-height
        y += lineIndex * block.lineHeight;
        // Decorative rule below h2 headings — matches the myst view's
        // `.vellum-prose h2 { border-bottom: 1px solid var(--border-faint) }`.
        if (block.variant === 2) {
          const ruleGap = 5;
          items.push({
            kind: 'rule',
            top: y + ruleGap,
            left: block.contentLeft,
            width: Math.max(1, contentWidth - block.contentLeft),
            variant: 'heading',
            blockquoteRailLefts: block.blockquoteRailLefts,
          });
          y += ruleGap + 1;
        }
        break;
      }
      case 'code': {
        const availableWidth = Math.max(1, contentWidth - block.contentLeft - 24);
        const result = layoutWithLines(
          block.prepared,
          availableWidth,
          BLOCK_CODE_LINE_HEIGHT,
        );
        const height = result.height + CODE_PADDING_Y * 2;
        items.push({
          kind: 'code',
          top: y,
          left: block.contentLeft,
          lines: result.lines,
          width: Math.max(1, contentWidth - block.contentLeft),
          paddedHeight: height,
          blockquoteRailLefts: block.blockquoteRailLefts,
        });
        y += height;
        break;
      }
      case 'rule': {
        items.push({
          kind: 'rule',
          top: y + RULE_HEIGHT / 2,
          left: block.contentLeft,
          width: Math.max(1, contentWidth - block.contentLeft),
          blockquoteRailLefts: block.blockquoteRailLefts,
        });
        y += RULE_HEIGHT;
        break;
      }
      case 'island': {
        // Visible debug placeholder — used where no compat subtree renderer
        // is available (e.g. PretextFiberCard inside WorkspaceView). The
        // compat path below is used by full-width Narrative rendering.
        items.push({
          kind: 'island',
          label: block.label,
          detail: block.detail,
          top: y,
          left: block.contentLeft,
          width: Math.max(1, contentWidth - block.contentLeft),
          blockquoteRailLefts: block.blockquoteRailLefts,
        });
        y += 42;
        break;
      }
      case 'compatIsland': {
        // Reserve the last-measured height for this island; falls back to
        // the default until the ResizeObserver reports real content. After
        // the first measured pass the layout pins at the measured height,
        // so pretext y-coordinates for the rest of the column stay stable.
        const height =
          heightMap.get(block.key) ?? COMPAT_ISLAND_FALLBACK_HEIGHT;
        items.push({
          kind: 'compatIsland',
          key: block.key,
          node: block.node,
          top: y,
          left: block.contentLeft,
          width: Math.max(1, contentWidth - block.contentLeft),
          height,
          blockquoteRailLefts: block.blockquoteRailLefts,
        });
        y += height;
        break;
      }
      case 'table': {
        const layout = layoutTableBlock(block, contentWidth);
        layout.top = y;
        items.push(layout);
        y += layout.totalHeight;
        break;
      }
    }
    y += block.marginBottom;
  }

  return { totalHeight: y, items };
}

// ───────────────────── Table layout ─────────────────────

/**
 * Allocate column widths from natural per-column widths and the available
 * inline width. Falls back to equal distribution if every column has zero
 * natural width (empty table), otherwise proportional scaling. Every column
 * is floored at `TABLE_MIN_COL_WIDTH` so degenerate single-character columns
 * still render readably.
 */
function allocateColumnWidths(
  block: TableBlock,
  availableWidth: number,
): number[] {
  const { colCount, rows } = block;
  const natural = new Array<number>(colCount).fill(0);
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      const w = row[c]?.naturalWidth ?? 0;
      if (w > natural[c]) natural[c] = w;
    }
  }
  // Each cell reserves its own horizontal padding; the natural width measured
  // the text only, so add it back per column before fitting.
  const padded = natural.map((w) => w + TABLE_CELL_PAD_X * 2);
  const totalPadded = padded.reduce((a, b) => a + b, 0);

  if (totalPadded === 0) {
    // Empty table — distribute equally.
    const share = Math.max(TABLE_MIN_COL_WIDTH, availableWidth / colCount);
    return new Array(colCount).fill(share);
  }

  // If the natural layout already fits, honor it — short tables stay short.
  // Otherwise scale every column down proportionally to fit the column.
  let scale = 1;
  if (totalPadded > availableWidth) {
    scale = availableWidth / totalPadded;
  }
  const widths = padded.map((w) => Math.max(TABLE_MIN_COL_WIDTH, w * scale));

  // After flooring, the row may be too wide or too narrow again. If too wide,
  // shrink columns proportionally over the min floor; if the floor dominates,
  // accept the overflow — better to overflow a few px than to render a
  // 20px-wide column. In practice the surveyed tables are far from this edge.
  const total = widths.reduce((a, b) => a + b, 0);
  if (total > availableWidth) {
    const excess = total - availableWidth;
    const flexPool = widths
      .map((w, i) => ({ i, slack: w - TABLE_MIN_COL_WIDTH }))
      .filter((e) => e.slack > 0);
    const flexTotal = flexPool.reduce((a, b) => a + b.slack, 0);
    if (flexTotal > 0) {
      const ratio = Math.min(1, excess / flexTotal);
      for (const entry of flexPool) {
        widths[entry.i] -= entry.slack * ratio;
      }
    }
  }

  return widths;
}

function layoutTableBlock(block: TableBlock, contentWidth: number): TableLayout {
  const availableWidth = Math.max(1, contentWidth - block.contentLeft);
  const widths = allocateColumnWidths(block, availableWidth);
  const lefts: number[] = [];
  {
    let x = 0;
    for (const w of widths) {
      lefts.push(x);
      x += w;
    }
  }
  const totalWidth = widths.reduce((a, b) => a + b, 0);

  const cells: TableCellLayout[] = [];
  let rowTop = 0;

  for (let r = 0; r < block.rows.length; r++) {
    const row = block.rows[r];
    // Materialize every cell in the row to determine row height as the
    // maximum inner text height + vertical padding.
    const rowCellLayouts: Omit<TableCellLayout, 'height' | 'top'>[] = [];
    let maxTextHeight = 0;
    const padY =
      r === 0 && row[0]?.isHeader ? TABLE_HEADER_PAD_Y : TABLE_CELL_PAD_Y;

    for (let c = 0; c < block.colCount; c++) {
      const cell = row[c];
      const colWidth = widths[c];
      const textWidth = Math.max(1, colWidth - TABLE_CELL_PAD_X * 2);
      const lines: TableCellLine[] = [];
      let lineIdx = 0;
      walkRichInlineLineRanges(cell.flow, textWidth, (range) => {
        const line = materializeRichInlineLineRange(cell.flow, range);
        const fragments: TableCellLineFragment[] = line.fragments.map((frag) => {
          const piece = cell.pieces[frag.itemIndex];
          return {
            leadingGap: frag.gapBefore,
            text: frag.text,
            font: piece?.font ?? inlineFont('body', EMPTY_MARKS),
            className: piece?.className ?? 'pretext-prose-frag',
            href: piece?.href ?? null,
          };
        });
        lines.push({ top: lineIdx * cell.lineHeight, fragments });
        lineIdx++;
      });
      if (lines.length === 0) lines.push({ top: 0, fragments: [] });

      const textHeight = lines.length * cell.lineHeight;
      if (textHeight > maxTextHeight) maxTextHeight = textHeight;

      rowCellLayouts.push({
        colIndex: c,
        rowIndex: r,
        lines,
        align: cell.align,
        isHeader: cell.isHeader,
        width: colWidth,
        left: lefts[c],
        lineHeight: cell.lineHeight,
      });
    }

    const rowHeight = maxTextHeight + padY * 2;
    for (const cell of rowCellLayouts) {
      cells.push({ ...cell, height: rowHeight, top: rowTop });
    }
    rowTop += rowHeight;
  }

  return {
    kind: 'table',
    top: 0, // filled in by the caller once the y cursor is known
    left: block.contentLeft,
    width: totalWidth,
    totalHeight: rowTop,
    cells,
    rowCount: block.rows.length,
    blockquoteRailLefts: block.blockquoteRailLefts,
  };
}

// ───────────────────── Component ─────────────────────

interface PretextProseProps {
  mdast: any;
  /** Content width available inside the prose box (already minus padding). */
  contentWidth: number;
  /**
   * Optional prefix prepended to internal hrefs before navigation so that
   * clicking a link inside the pretext column keeps the reader in pretext
   * mode instead of bouncing back to the mystra default route.
   */
  linkPrefix?: string;
}

export function PretextProse({
  mdast,
  contentWidth,
  linkPrefix,
}: PretextProseProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ProseLayout | null>(null);
  /**
   * Measured heights for compat islands, keyed by the stable counter assigned
   * at parse time. Held in a ref so a ResizeObserver callback can update it
   * without tearing down/re-registering on every layout pass; we separately
   * bump `heightMapVersion` to trigger re-layout.
   */
  const heightMapRef = useRef<Map<number, number>>(new Map());
  const [heightMapVersion, setHeightMapVersion] = useState(0);

  const blocks = useMemo(() => {
    const children: any[] = Array.isArray(mdast?.children) ? mdast.children : [];
    return parseBlocks(children, emptyCtx(true));
  }, [mdast]);

  // Reset the height map whenever the source mdast changes. Without this,
  // stale heights from a prior fiber would bleed into the new layout's key
  // space and mis-size islands until the observer fired.
  useEffect(() => {
    heightMapRef.current = new Map();
    setHeightMapVersion((v) => v + 1);
  }, [mdast]);

  useEffect(() => {
    let cancelled = false;
    try {
      const result = layoutBlocks(blocks, contentWidth, heightMapRef.current);
      if (!cancelled) setLayout(result);
    } catch (err) {
      console.error('[PretextProse] layout failed', err);
    }
    return () => {
      cancelled = true;
    };
  }, [blocks, contentWidth, heightMapVersion]);

  // Observe compat-island containers. When a child's measured height diverges
  // from the heightMap entry by more than 1px, update the map and trigger a
  // re-layout. The 1px threshold plus `prev === next` early return keeps this
  // from entering an infinite re-layout loop under fractional sub-pixel noise.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const keyAttr = el.dataset.compatIslandKey;
        if (keyAttr == null) continue;
        const key = Number(keyAttr);
        // Prefer contentRect so padding on the host element doesn't
        // double-count, and fall back to offsetHeight if the observer gave
        // us nothing (happens on the first frame with display: none hosts).
        const measured = entry.contentRect?.height ?? el.offsetHeight;
        if (!(measured > 0)) continue;
        const current = heightMapRef.current.get(key);
        if (current == null || Math.abs(current - measured) > 1) {
          heightMapRef.current.set(key, measured);
          changed = true;
        }
      }
      if (changed) setHeightMapVersion((v) => v + 1);
    });

    const nodes = container.querySelectorAll<HTMLElement>(
      '.pretext-prose-compat',
    );
    nodes.forEach((node) => observer.observe(node));

    return () => observer.disconnect();
    // `layout` is listed because every re-layout can mount/unmount compat
    // islands; we need to re-observe their fresh DOM nodes.
  }, [layout]);

  // React-router navigation for internal anchors (href starting with `/`).
  // Keeps the pretext column as part of the SPA, and optionally keeps the
  // user inside the pretext view when following internal links so Gate 1
  // side-by-side comparison doesn't bounce them back to mystra.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest<HTMLAnchorElement>('a[href^="/"]');
      if (!anchor) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const href = anchor.getAttribute('href')!;
      if (linkPrefix && !href.startsWith(linkPrefix)) {
        navigate(`${linkPrefix}${href}`);
      } else {
        navigate(href);
      }
    },
    [linkPrefix, navigate],
  );

  if (!layout) {
    return <div className="pretext-prose pretext-prose--loading" style={{ minHeight: 40 }} />;
  }

  return (
    <div
      ref={containerRef}
      className="pretext-prose"
      style={{ position: 'relative', width: contentWidth, height: layout.totalHeight }}
      onClick={handleClick}
    >
      {layout.items.map((item, idx) => renderLine(item, idx))}
    </div>
  );
}

function renderLine(
  item: LineLayout,
  idx: number,
) {
  switch (item.kind) {
    case 'inline': {
      const className = `pretext-prose-line pretext-prose-line--${
        item.variant === 'body' ? 'body' : `h${item.variant}`
      }`;
      // Pick a semantic tag for the first wrapped line of a heading block
      // so downstream scanners (GhostToc, a11y, future anchor-link
      // generation) find exactly one real heading element per source
      // heading. Continuation lines stay divs to keep the tag count stable.
      const Tag: keyof JSX.IntrinsicElements =
        item.variant !== 'body' && item.isFirstLine
          ? (`h${item.variant}` as keyof JSX.IntrinsicElements)
          : 'div';
      return (
        <Tag
          key={idx}
          className={className}
          // Stamp pretext's authoritative y and line-height on the line
          // container itself, not just on link fragments. Anything that
          // needs a pretext-authoritative coordinate for an arbitrary
          // DOM node can walk up to the nearest `.pretext-prose-line` and
          // read these attributes — Gate 2's annotation-side path reads
          // these to align left-margin marks the same way MarginCitations
          // reads link-level attributes today.
          data-pretext-line-top={item.top}
          data-pretext-line-height={item.lineHeight}
          style={{
            position: 'absolute',
            top: item.top,
            left: item.left,
            width: item.width,
            height: item.lineHeight,
            lineHeight: `${item.lineHeight}px`,
            whiteSpace: 'pre',
            // Reset the browser's default heading margins — pretext owns
            // vertical rhythm via block.marginTop/Bottom.
            margin: 0,
            fontWeight: 'inherit',
            fontSize: 'inherit',
          }}
        >
          {item.marker && (
            <span
              className="pretext-prose-marker"
              style={{
                position: 'absolute',
                left: item.marker.left - item.left,
                font: item.marker.font,
                lineHeight: `${item.lineHeight}px`,
              }}
            >
              {item.marker.text}
            </span>
          )}
          {item.blockquoteRailLefts.map((rail, railIdx) => (
            <span
              key={`rail-${railIdx}`}
              className="pretext-prose-quote-rail"
              style={{
                position: 'absolute',
                left: rail - item.left,
                top: 0,
                bottom: 0,
                width: 2,
              }}
            />
          ))}
          {item.fragments.flatMap((frag, fragIdx) => {
            // `gapBefore` is the pixel gap pretext collapsed from
            // inter-item whitespace — the space between "The" and
            // "<strong>bold</strong>" ends up here, because pretext's
            // `prepareRichInline` strips leading/trailing collapsible
            // whitespace from each source item and re-surfaces it as a
            // gap width. Rendering the gap purely as `margin-left` on
            // the fragment span leaves no text node carrying the
            // space, so `Range.toString()` — and the TreeWalker
            // accumulator in `TextAnnotationLayer.findAnnotationInDom`
            // — reads "Theboldword" with the spaces missing.
            //
            // Fix: emit a zero-size sibling span before each gapped
            // fragment whose text content is a single space. The
            // sibling is `fontSize: 0; lineHeight: 0` so the space
            // character contributes no visual width; the fragment's
            // own `marginLeft: frag.leadingGap` still handles all
            // positioning (no double-count). Annotation matching,
            // copy/paste, and assistive readers see the correct text
            // without disturbing pretext's line geometry.
            const pieces: ReactNode[] = [];
            if (frag.leadingGap > 0) {
              pieces.push(
                <span
                  key={`gap-${fragIdx}`}
                  aria-hidden="true"
                  className="pretext-prose-gap"
                  style={{
                    fontSize: 0,
                    lineHeight: 0,
                    whiteSpace: 'pre',
                  }}
                >
                  {' '}
                </span>,
              );
            }
            const fragStyle: React.CSSProperties = {
              display: 'inline-block',
              marginLeft: frag.leadingGap,
              whiteSpace: 'pre',
              // Pretext-measured font shorthand — matches the pieces we
              // passed to `prepareRichInline`, so visual size agrees with
              // the line widths pretext computed.
              font: frag.font,
            };
            if (frag.href) {
              // Stamp the line's authoritative y-coordinate + line-height
              // onto every anchor. MarginCitations prefers these over
              // getBoundingClientRect so the citation glyphs align to
              // pretext's own line grid instead of re-measuring CSS flow
              // per anchor. Gate 2 of pretext-refoundation.
              pieces.push(
                <a
                  key={fragIdx}
                  href={frag.href}
                  className={frag.className}
                  style={fragStyle}
                  data-pretext-line-top={item.top}
                  data-pretext-line-height={item.lineHeight}
                >
                  {frag.text}
                </a>,
              );
            } else {
              pieces.push(
                <span key={fragIdx} className={frag.className} style={fragStyle}>
                  {frag.text}
                </span>,
              );
            }
            return pieces;
          })}
        </Tag>
      );
    }
    case 'code': {
      return (
        <pre
          key={idx}
          className="pretext-prose-code"
          style={{
            position: 'absolute',
            top: item.top,
            left: item.left,
            width: item.width,
            height: item.paddedHeight,
            padding: `${CODE_PADDING_Y}px 12px`,
            margin: 0,
            whiteSpace: 'pre',
            overflow: 'hidden',
          }}
        >
          {item.lines.map((line, lineIdx) => (
            <div
              key={lineIdx}
              className="pretext-prose-code-line"
              style={{
                height: BLOCK_CODE_LINE_HEIGHT,
                lineHeight: `${BLOCK_CODE_LINE_HEIGHT}px`,
                font: `500 ${INLINE_CODE_SIZE}px ${MONO}`,
                whiteSpace: 'pre',
              }}
            >
              {line.text || '\u00a0'}
            </div>
          ))}
        </pre>
      );
    }
    case 'rule': {
      return (
        <div
          key={idx}
          className={`pretext-prose-rule${item.variant === 'heading' ? ' pretext-prose-rule--heading' : ''}`}
          style={{
            position: 'absolute',
            top: item.top,
            left: item.left,
            width: item.width,
            height: 1,
          }}
        />
      );
    }
    case 'island': {
      return (
        <div
          key={idx}
          className="pretext-prose-island"
          style={{
            position: 'absolute',
            top: item.top,
            left: item.left,
            width: item.width,
          }}
        >
          <span className="pretext-prose-island__label">[{item.label}]</span>
          {item.detail && (
            <span className="pretext-prose-island__detail"> {item.detail}</span>
          )}
        </div>
      );
    }
    case 'table': {
      return renderTable(item, idx);
    }
    case 'compatIsland': {
      // A compat island reserves pretext's layout height (`item.height` came
      // out of the heightMap) at the parent level, but the inner host leaves
      // `height: auto` so the ResizeObserver reads the real content height.
      // The `vellum-prose-compat` wrapper lets `.vellum-prose table/…` CSS
      // rules target the subtree without having to mirror them.
      return (
        <div
          key={`compat-${item.key}`}
          className="pretext-prose-compat"
          data-compat-island-key={item.key}
          style={{
            position: 'absolute',
            top: item.top,
            left: item.left,
            width: item.width,
          }}
        >
          <div className="pretext-prose-compat__inner vellum-prose-compat">
            <MyST ast={item.node} />
          </div>
        </div>
      );
    }
  }
}

// ───────────────────── Table renderer ─────────────────────

function renderTable(item: TableLayout, idx: number): ReactNode {
  return (
    <div
      key={idx}
      className="pretext-prose-table"
      role="table"
      style={{
        position: 'absolute',
        top: item.top,
        left: item.left,
        width: item.width,
        height: item.totalHeight,
      }}
    >
      {item.cells.map((cell) => (
        <div
          key={`r${cell.rowIndex}c${cell.colIndex}`}
          role={cell.isHeader ? 'columnheader' : 'cell'}
          className={`pretext-prose-table__cell${
            cell.isHeader ? ' pretext-prose-table__cell--header' : ''
          }${
            cell.rowIndex === item.rowCount - 1
              ? ' pretext-prose-table__cell--last-row'
              : ''
          }`}
          data-table-align={cell.align}
          style={{
            position: 'absolute',
            top: cell.top,
            left: cell.left,
            width: cell.width,
            height: cell.height,
            padding: `${
              cell.isHeader ? TABLE_HEADER_PAD_Y : TABLE_CELL_PAD_Y
            }px ${TABLE_CELL_PAD_X}px`,
            boxSizing: 'border-box',
          }}
        >
          <div
            className="pretext-prose-table__cell-text"
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
            }}
          >
            {cell.lines.map((line, lineIdx) => (
              <div
                key={lineIdx}
                className="pretext-prose-table__line"
                style={{
                  position: 'absolute',
                  top: line.top,
                  left: 0,
                  right: 0,
                  height: cell.lineHeight,
                  lineHeight: `${cell.lineHeight}px`,
                  // The align attribute on the cell controls text-align via
                  // CSS; keeping the fragment box as flow-level inline-block
                  // leaves pretext's gap widths intact while the parent's
                  // text-align handles the horizontal positioning.
                  whiteSpace: 'pre',
                }}
              >
                {line.fragments.flatMap((frag, fragIdx) => {
                  const pieces: ReactNode[] = [];
                  if (frag.leadingGap > 0) {
                    pieces.push(
                      <span
                        key={`gap-${fragIdx}`}
                        aria-hidden="true"
                        className="pretext-prose-gap"
                        style={{
                          fontSize: 0,
                          lineHeight: 0,
                          whiteSpace: 'pre',
                        }}
                      >
                        {' '}
                      </span>,
                    );
                  }
                  // Table cells use a smaller body font than the main column.
                  // Override the piece's prepared font string (which is the
                  // main-column body size) to the table size while preserving
                  // weight/style marks. The font is recomposed from the class
                  // name instead of the prepared string.
                  const cellFont = tableCellFontFor(cell.isHeader, frag.className);
                  const fragStyle: React.CSSProperties = {
                    display: 'inline-block',
                    marginLeft: frag.leadingGap,
                    whiteSpace: 'pre',
                    font: cellFont,
                  };
                  if (frag.href) {
                    pieces.push(
                      <a
                        key={fragIdx}
                        href={frag.href}
                        className={frag.className}
                        style={fragStyle}
                      >
                        {frag.text}
                      </a>,
                    );
                  } else {
                    pieces.push(
                      <span
                        key={fragIdx}
                        className={frag.className}
                        style={fragStyle}
                      >
                        {frag.text}
                      </span>,
                    );
                  }
                  return pieces;
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Table cells render with a smaller font than the main prose column. The
 * measurement pass in `buildTableBlock` used the body font string so pretext's
 * grapheme widths slightly over-estimate real cell rendering — that's fine
 * because it only means cells wrap one character earlier than strictly needed,
 * never later, so nothing overflows. Bold/italic/code marks are honoured via
 * the `is-strong` / `is-em` / `is-code` class names that already exist.
 */
function tableCellFontFor(isHeader: boolean, className: string): string {
  const bold = className.includes('is-strong') || isHeader;
  const italic = className.includes('is-em');
  const code = className.includes('is-code');
  if (code) return `500 ${TABLE_CELL_SIZE - 1}px ${MONO}`;
  if (isHeader) {
    // Headers render in mono, uppercase — the className doesn't carry the
    // "header" bit, so we branch on it here.
    return `600 ${TABLE_HEADER_SIZE}px ${MONO}`;
  }
  const weight = bold ? 700 : 400;
  return `${italic ? 'italic ' : ''}${weight} ${TABLE_CELL_SIZE}px ${SERIF}`;
}
