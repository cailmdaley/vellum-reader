/**
 * MarginCitations — right-margin glyph column.
 *
 * Two glyph families coexist in the same rail:
 *
 *   1. **Fiber links** — internal anchors `/some-fiber` picked up from the
 *      prose. Each glyph reflects the link target's fiber status (○/◐/●/…).
 *   2. **ASTRA anchors** — inline refs `#findings.id`, `#decisions.id`,
 *      `#outputs.id`, `#inputs.id`, `#analyses.sub`. Each glyph is a
 *      one-letter kind chip (F/D/O/I/A) keyed to the anchor kind, pulled
 *      from `utils/astra-anchor.ts`. Unresolved anchors render with a
 *      broken-link affordance — rule per narrative-overnight constitution
 *      §2: "Render as an inert link with a small broken-link icon. Do not
 *      crash. Do not silently drop."
 *
 * Positioning is identical across both: the anchor's pretext line-y is
 * read off `data-pretext-line-top` (falling back to `getBoundingClientRect`
 * for the myst-to-react path). Anchors that share a line produce a single
 * group whose glyphs stack horizontally; distinct lines stack vertically
 * with a MIN_GAP floor so overlapping Y values don't collide.
 */

import { useEffect, useState } from 'react';
import type { GraphNode } from '~/utils/content-types';
import { useHoverGrace } from '~/hooks/useHoverGrace';
import { HOVER_GRACE_MS, HOVER_OPEN_DELAY_MS } from '~/utils/hover';
import { glyphForNode, statusClass } from '~/utils/fiber-status';
import {
  KIND_LEGEND,
  KIND_LETTER,
  parseAstraAnchor,
  resolveAstraAnchor,
  resolveAstraLabel,
  type AstraAnchorKind,
  type ParsedAstraAnchor,
} from '~/utils/astra-anchor';
import { MarginCardPreview } from './MarginCardPreview';

type FiberGlyph = {
  kind: 'fiber';
  slug: string;
  node: GraphNode;
  href: string;
  label: string;
  linkEls: HTMLAnchorElement[];
};

type AstraGlyph = {
  kind: 'astra';
  /** Anchor href, used for rendering + de-duplication within a line. */
  href: string;
  parsed: ParsedAstraAnchor;
  anchorKind: AstraAnchorKind;
  label: string;
  /** Broken-anchor reason — `null` when the anchor resolves against the page. */
  broken: string | null;
  linkEls: HTMLAnchorElement[];
};

type GlyphItem = (FiberGlyph | AstraGlyph) & { top: number };

/** A cluster of glyphs at one line Y, rendered side-by-side in the margin. */
interface GlyphGroup {
  top: number;
  items: GlyphItem[];
}

interface MarginCitationsProps {
  nodes: GraphNode[];
  proseRef: React.RefObject<HTMLElement>;
  wrapperRef: React.RefObject<HTMLElement>;
  changedIds?: Set<string>;
  /**
   * GraphNode for the page being rendered — used to resolve ASTRA anchor refs
   * against the analysis' findings / decisions / inputs / outputs. When
   * omitted (or when the page doesn't represent an astra-project), ASTRA
   * anchors on the page render as broken so readers still see the glyph.
   */
  currentNode?: GraphNode | null;
  /**
   * Child sub-analysis keys reachable from `currentNode` — derived from
   * graph `contains` edges. Feeds `resolveAstraAnchor` for the
   * `#analyses.<key>` case so it can tell live sub-analysis refs from
   * broken ones. Empty set is treated as "this page has no sub-analyses",
   * so such refs render broken; omit the prop entirely to fall back to
   * the legacy "lookup pending" diagnostic.
   */
  childSubKeys?: Set<string>;
}

/** Delay (ms) before a prose-link hover surfaces the tooltip. Glyph hovers are immediate. */
const LINK_HOVER_DELAY_MS = 250;
const CANVAS_RAIL_TOP = 172;
/** Min vertical gap between distinct glyph groups. Glyphs inside a group share a Y. */
const MIN_GROUP_GAP = 16;
/** Max y-distance treated as "same line" when grouping glyphs horizontally. */
const LINE_MERGE_TOLERANCE = 8;

export function MarginCitations({
  nodes,
  proseRef,
  wrapperRef,
  changedIds,
  currentNode,
  childSubKeys,
}: MarginCitationsProps) {
  const [groups, setGroups] = useState<GlyphGroup[]>([]);
  const [railLeft, setRailLeft] = useState(0);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const { hoveredKey, openKey, scheduleOpen, cancelClose, scheduleClose } =
    useHoverGrace(HOVER_GRACE_MS, HOVER_OPEN_DELAY_MS);

  // Measure positions after prose paints
  useEffect(() => {
    if (!proseRef.current || !wrapperRef.current) return;

    const nodeBySlug = new Map(nodes.map((n) => [n.slug, n]));
    const cleanups: Array<() => void> = [];
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId = 0;

    const scheduleMeasure = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        measure();
      });
    };

    const measure = () => {
      for (const fn of cleanups.splice(0)) fn();
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      cancelClose();

      const prose = proseRef.current!;
      const wrapper = wrapperRef.current!;
      const wrapperRect = wrapper.getBoundingClientRect();
      const rawCanvasWidth = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--canvas-width'),
      );
      const canvasWidth = Number.isFinite(rawCanvasWidth) && rawCanvasWidth > 0 ? rawCanvasWidth : 0;
      const canvasLeft = canvasWidth > 0 ? window.innerWidth - canvasWidth : window.innerWidth;
      setRailLeft(Math.max(0, canvasLeft - wrapperRect.left + 12));

      // Pretext lays its lines into a relatively-positioned box; read the
      // box origin once so we can stamp each anchor's margin y off its
      // pretext line-top attribute rather than re-measuring with a per-
      // anchor bounding rect.
      const pretextBox = prose.querySelector<HTMLElement>('.pretext-prose');
      const pretextOriginTop = pretextBox
        ? pretextBox.getBoundingClientRect().top - wrapperRect.top
        : null;

      // Collect both fiber anchors (href starts with "/") and ASTRA anchors
      // (href starts with "#" or "../") in DOM order. Pretext wraps a single
      // source link into N <a> fragments when it breaks across lines; we
      // fold those fragments per-anchor-key below.
      const allAnchors = Array.from(prose.querySelectorAll<HTMLAnchorElement>('a[href]'));
      const items: GlyphItem[] = [];

      // Per-kind continuation tracking: when pretext emits two adjacent
      // `<a>` tags for the same source link that wrapped across a line,
      // the second one becomes a "continuation" fragment of the first
      // glyph rather than a second glyph. We track the last-emitted glyph
      // keyed by its lookup href so we can compare against the next
      // anchor's href + proximity.
      let lastItem: GlyphItem | null = null;

      for (const a of allAnchors) {
        const href = a.getAttribute('href') ?? '';
        if (!href) continue;

        // y-coordinate: prefer pretext's line-top attribute when present.
        let top: number;
        const dataLineTop = a.dataset.pretextLineTop;
        if (dataLineTop != null && pretextOriginTop != null) {
          top = pretextOriginTop + Number(dataLineTop);
        } else {
          const rect = a.getBoundingClientRect();
          top = rect.top - wrapperRect.top;
        }

        if (href.startsWith('/')) {
          // Fiber-link glyph — look up the target node. Skip anchors whose
          // slug isn't in the current project's graph (e.g. external paths
          // we don't know about).
          const slug = href.slice(1);
          if (!slug) continue;
          const node = nodeBySlug.get(slug);
          if (!node) continue;
          if (lastItem && isContinuation(lastItem, 'fiber', href, top, a)) {
            lastItem.linkEls.push(a);
            continue;
          }
          const item: GlyphItem = {
            kind: 'fiber',
            slug,
            node,
            href,
            label: node.label ?? slug,
            linkEls: [a],
            top,
          };
          items.push(item);
          lastItem = item;
          continue;
        }

        const parsed = parseAstraAnchor(href);
        if (!parsed) continue; // plain same-document heading anchor, ignore

        if (lastItem && isContinuation(lastItem, 'astra', href, top, a)) {
          lastItem.linkEls.push(a);
          continue;
        }

        // Resolve against the page's GraphNode — broken anchors still get a
        // glyph, just with the broken affordance.
        const broken = currentNode
          ? resolveAstraAnchor(parsed, currentNode, childSubKeys)
          : 'No page node for anchor resolution';
        const label = currentNode
          ? resolveAstraLabel(parsed, currentNode)
          : parsed.id;
        const item: GlyphItem = {
          kind: 'astra',
          href,
          parsed,
          anchorKind: parsed.kind,
          label,
          broken,
          linkEls: [a],
          top,
        };
        items.push(item);
        lastItem = item;
      }

      // Group items by line Y. Items within LINE_MERGE_TOLERANCE join the
      // previous group (horizontal stack); otherwise open a new group.
      // A second pass enforces MIN_GROUP_GAP between distinct groups,
      // bumping later groups downward so they don't overlap above the
      // canvas rail origin.
      const grouped: GlyphGroup[] = [];
      for (const item of items) {
        const last = grouped[grouped.length - 1];
        if (last && Math.abs(last.top - item.top) <= LINE_MERGE_TOLERANCE) {
          last.items.push(item);
        } else {
          grouped.push({ top: item.top, items: [item] });
        }
      }
      let lastTop = CANVAS_RAIL_TOP - MIN_GROUP_GAP;
      for (const group of grouped) {
        const t = Math.max(group.top, lastTop + MIN_GROUP_GAP);
        lastTop = t;
        group.top = t;
      }

      setGroups(grouped);

      // Hover wiring. We treat the whole glyph group as the hover target for
      // tooltip coordination: hovering any of the constituent anchors opens
      // that item's tooltip (keyed by a stable string that encodes group+item).
      grouped.forEach((group, gi) => {
        group.items.forEach((item, ii) => {
          const key = `${gi}:${ii}`;
          const setActive = (active: boolean) => {
            for (const el of item.linkEls) {
              el.classList.toggle('margin-active', active);
            }
          };
          const onEnter = () => {
            setActive(true);
            setActiveKey(key);
            if (hoverTimer) clearTimeout(hoverTimer);
            cancelClose();
            hoverTimer = setTimeout(() => openKey(key), LINK_HOVER_DELAY_MS);
          };
          const onLeave = () => {
            setActive(false);
            setActiveKey((prev) => (prev === key ? null : prev));
            if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
            scheduleClose();
          };
          for (const el of item.linkEls) {
            el.addEventListener('mouseenter', onEnter);
            el.addEventListener('mouseleave', onLeave);
          }
          cleanups.push(() => {
            for (const el of item.linkEls) {
              el.removeEventListener('mouseenter', onEnter);
              el.removeEventListener('mouseleave', onLeave);
            }
          });
        });
      });
    };

    const frame = requestAnimationFrame(measure);

    // Re-measure on resize. Two observe targets, same rationale as before:
    // the outer article (for column width changes) and the inner .pretext-
    // prose (for pretext's re-layout on content width changes).
    const observer = new ResizeObserver(measure);
    const proseEl = proseRef.current!;
    observer.observe(proseEl);
    const pretextBoxObs = proseEl.querySelector<HTMLElement>('.pretext-prose');
    if (pretextBoxObs) observer.observe(pretextBoxObs);

    let mutationObserver: MutationObserver | null = null;
    if (!pretextBoxObs && typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        const box = proseEl.querySelector<HTMLElement>('.pretext-prose');
        if (box) {
          observer.observe(box);
          mutationObserver?.disconnect();
          mutationObserver = null;
        }
      });
      mutationObserver.observe(proseEl, { childList: true, subtree: true });
    }

    const rootStyleObserver =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(scheduleMeasure)
        : null;
    rootStyleObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', scheduleMeasure, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
      mutationObserver?.disconnect();
      rootStyleObserver?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', scheduleMeasure);
      if (hoverTimer) clearTimeout(hoverTimer);
      for (const fn of cleanups) fn();
    };
  }, [proseRef, wrapperRef, nodes, currentNode, childSubKeys]);

  if (groups.length === 0) return null;

  const hoveredItem = (() => {
    if (!hoveredKey) return null;
    const [gi, ii] = hoveredKey.split(':').map(Number);
    const group = groups[gi];
    if (!group) return null;
    const item = group.items[ii];
    if (!item) return null;
    return { group, item, gi, ii };
  })();

  return (
    <>
      {groups.map((group, gi) => (
        <div
          key={gi}
          className="margin-glyph-row"
          style={{ position: 'absolute', top: group.top, left: railLeft }}
        >
          {group.items.map((item, ii) => renderGlyph(item, `${gi}:${ii}`, {
            activeKey,
            changedIds,
            openKey,
            scheduleOpen,
            scheduleClose,
            setActiveKey,
          }))}
        </div>
      ))}

      {hoveredItem && hoveredItem.item.kind === 'fiber' && (
        <MarginCardPreview
          content={{ type: 'fiber', node: hoveredItem.item.node }}
          top={hoveredItem.group.top + 20}
          left={railLeft}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />
      )}
      {hoveredItem && hoveredItem.item.kind === 'astra' && (
        <AstraAnchorTooltip
          item={hoveredItem.item}
          top={hoveredItem.group.top + 20}
          left={railLeft}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />
      )}
    </>
  );
}

interface GlyphRenderCtx {
  activeKey: string | null;
  changedIds?: Set<string>;
  openKey: (k: string) => void;
  scheduleOpen: (k: string) => void;
  scheduleClose: () => void;
  setActiveKey: React.Dispatch<React.SetStateAction<string | null>>;
}

function renderGlyph(item: GlyphItem, key: string, ctx: GlyphRenderCtx) {
  const active = ctx.activeKey === key;
  if (item.kind === 'fiber') {
    const cls =
      `margin-glyph margin-glyph--fiber margin-glyph--${statusClass(item.node.status)}` +
      (ctx.changedIds?.has(item.slug) ? ' margin-glyph--changed' : '') +
      (item.node.tempered ? ' margin-glyph--tempered' : '') +
      (active ? ' margin-glyph--active' : '');
    return (
      <div
        key={key}
        className={cls}
        onClick={() => ctx.openKey(key)}
        onMouseEnter={() => {
          for (const el of item.linkEls) el.classList.add('margin-active');
          ctx.setActiveKey(key);
          ctx.scheduleOpen(key);
        }}
        onMouseLeave={() => {
          for (const el of item.linkEls) el.classList.remove('margin-active');
          ctx.setActiveKey((p) => (p === key ? null : p));
          ctx.scheduleClose();
        }}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') ctx.openKey(key);
        }}
        aria-label={`Open ${item.label} in marginalia`}
      >
        <span className="margin-glyph__dot">{glyphForNode(item.node)}</span>
        <span className="margin-glyph__label">{item.label}</span>
      </div>
    );
  }

  // ASTRA anchor glyph
  const cls =
    `margin-glyph margin-glyph--astra margin-glyph--astra-${item.anchorKind}` +
    (item.broken ? ' margin-glyph--astra-broken' : '') +
    (active ? ' margin-glyph--active' : '');
  const letter = KIND_LETTER[item.anchorKind];
  return (
    <div
      key={key}
      className={cls}
      onMouseEnter={() => {
        for (const el of item.linkEls) el.classList.add('margin-active');
        ctx.setActiveKey(key);
        ctx.scheduleOpen(key);
      }}
      onMouseLeave={() => {
        for (const el of item.linkEls) el.classList.remove('margin-active');
        ctx.setActiveKey((p) => (p === key ? null : p));
        ctx.scheduleClose();
      }}
      aria-label={
        item.broken
          ? `Broken anchor: ${item.label}`
          : `${KIND_LEGEND[item.anchorKind]}: ${item.label}`
      }
    >
      <span className="margin-glyph__dot" aria-hidden="true">{letter}</span>
      <span className="margin-glyph__label">{item.label}</span>
      {item.broken && (
        <span className="margin-glyph__broken" aria-hidden="true">⚠</span>
      )}
    </div>
  );
}

function AstraAnchorTooltip({
  item,
  top,
  left,
  onMouseEnter,
  onMouseLeave,
}: {
  item: Extract<GlyphItem, { kind: 'astra' }>;
  top: number;
  left: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <div
      className="margin-astra-tooltip"
      style={{ position: 'absolute', top, left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="margin-astra-tooltip__kind">{KIND_LEGEND[item.anchorKind]}</div>
      <div className="margin-astra-tooltip__label">{item.label}</div>
      {item.broken && (
        <div className="margin-astra-tooltip__broken">⚠ {item.broken}</div>
      )}
    </div>
  );
}

/**
 * Pretext emits one `<a>` per wrapped line fragment of a single source link.
 * Fold same-href adjacent fragments into one glyph when their y-coordinates
 * are within 1.5 line-heights — same heuristic both the old MarginCitations
 * used for fiber links and what we want for ASTRA anchors.
 */
function isContinuation(
  prev: GlyphItem,
  nextKind: 'fiber' | 'astra',
  href: string,
  top: number,
  anchor: HTMLAnchorElement,
): boolean {
  if (prev.kind !== nextKind) return false;
  if (prev.href !== href) return false;
  const dataLineHeight = anchor.dataset.pretextLineHeight;
  if (dataLineHeight == null) return false;
  const lineHeight = Number(dataLineHeight);
  return Math.abs(top - prev.top) <= lineHeight * 1.5;
}
