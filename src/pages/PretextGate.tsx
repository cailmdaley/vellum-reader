/**
 * /pretext-gate — Gate 0 visual QA surface for the pretext refoundation.
 *
 * Combines the two gate surfaces that originally lived at `/pretext-gate`
 * (Gate 1a) and `/pretext-gate-1b` (Gate 1b) into a single page, because the
 * refoundation constitution (.felt/vellum-vite-migration/pretext-refoundation)
 * asks for one route that "stacks the six canonical widths vertically and
 * includes a resizable mixed-media card demo."
 *
 * Two sections, same fiber picker:
 *
 *   1. Gate 1a — PretextFiberCard at the six canonical workspace widths
 *      (180/280/400/560/720/900), stacked on the same eye-line for visual
 *      comparison. Confirms EB Garamond holds editorial quality through
 *      pretext's arithmetic wrap across the expected card widths.
 *
 *   2. Gate 1b — FiberCardWithMedia with a live-resizable frame hosting a
 *      fixed 190×120 sparkline plot. Drag the gold handle on the card's
 *      bottom-right corner to reshape the frame; pretext restages outcome
 *      and highlight text around the media rectangle on every frame. No CSS
 *      float involved. Below a width threshold the media is suppressed and
 *      the card gracefully becomes text-only.
 *
 * This route exists only for Gate 0's re-port and the downstream pretext
 * refoundation gates. Safe to delete once Narrative is on pretext and the
 * workspace renderer switches to FiberCardWithMedia for real placement.
 *
 * Re-ported into vellum-next under Gate 0 from the pre-Vite Remix routes:
 *   `.felt/vellum-vite-migration/pretext-refoundation/reference/pretext-gate.route.tsx`
 *   `.felt/vellum-vite-migration/pretext-refoundation/reference/pretext-gate-1b.route.tsx`
 *
 * The Remix loader pattern (`json(...)`, `useLoaderData`) is translated to
 * vellum-next's useEffect + `api.ts` fetch pattern, matching FiberPage.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAdapter } from '~/contexts/AdapterContext';
import { FiberCardWithMedia, type MediaPane } from '~/components/FiberCardWithMedia';
import { PretextFiberCard } from '~/components/PretextFiberCard';
import type {
  FiberGraph,
  FiberContent,
  GraphNode,
} from '~/utils/content-types';

const DEFAULT_SLUG = 'vellum-reader/workspace';

// The six canonical widths from the workspace constitution's Gate 1a check.
const GATE_WIDTHS: Array<{ px: number; label: string }> = [
  { px: 180, label: 'narrow · 180px' },
  { px: 280, label: 'compact · 280px' },
  { px: 400, label: 'medium · 400px' },
  { px: 560, label: 'comfortable · 560px' },
  { px: 720, label: 'wide · 720px' },
  { px: 900, label: 'spread · 900px' },
];

// Live-resize frame geometry for the Gate 1b panel.
const MIN_CARD_WIDTH = 220;
const MAX_CARD_WIDTH = 1000;
const DEFAULT_CARD_WIDTH = 560;

// The media pane's target geometry. Fixed for Gate 1b — the whole point is
// that it *doesn't* fluidly resize with the card; text routes around it.
const MEDIA_WIDTH = 190;
const MEDIA_HEIGHT = 120;

/**
 * Synthesize a minimal GraphNode when the requested slug isn't in the structured
 * graph. Mirrors the fallback in the original reference routes so both gates
 * can render orphan fibers without a loader crash.
 */
function synthesizeNode(slug: string, content: FiberContent | null): GraphNode {
  const fm = (content?.frontmatter ?? {}) as Record<string, unknown>;
  const label =
    (typeof fm.name === 'string' && fm.name) ||
    slug.split('/').pop() ||
    slug;
  const outcome =
    (typeof fm.outcome === 'string' && fm.outcome) ||
    (typeof (fm as { verdict?: unknown }).verdict === 'string' &&
      ((fm as { verdict?: string }).verdict as string)) ||
    undefined;
  return {
    id: slug,
    slug,
    label,
    status: (typeof fm.status === 'string' && fm.status) || 'open',
    tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
    verdict: outcome,
    decisions: [],
    findings: [],
    tempered: (fm as { tempered?: boolean }).tempered ?? false,
  };
}

function nodeFromGraph(graph: FiberGraph, slug: string): GraphNode | null {
  return graph.nodes.find((n) => n.slug === slug) ?? null;
}

/**
 * Deterministic sparkline plot — no external assets, no fetches, no canvas.
 * A procedurally generated multi-frequency sine so the shape looks like
 * real scientific data without being one. Gate 1b only needs *a* fixed
 * rectangle; the visual content is incidental.
 */
function Sparkline({ width, height }: { width: number; height: number }) {
  const N = 48;
  const padX = 6;
  const padY = 10;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    // Three-component sine, bounded to [0, 1] by construction.
    const v =
      0.5 +
      0.3 * Math.sin(t * 6.0) +
      0.12 * Math.sin(t * 13.0 + 1.4) +
      0.05 * Math.sin(t * 27.0 + 0.3);
    const x = padX + t * innerW;
    const y = padY + (1 - v) * innerH;
    points.push([x, y]);
  }
  const line = points
    .map(([x, y], i) =>
      i === 0 ? `M${x.toFixed(2)} ${y.toFixed(2)}` : `L${x.toFixed(2)} ${y.toFixed(2)}`,
    )
    .join(' ');
  const area = `${line} L${points[N - 1]![0]!.toFixed(2)} ${(
    padY + innerH
  ).toFixed(2)} L${points[0]![0]!.toFixed(2)} ${(padY + innerH).toFixed(2)} Z`;

  // A few fake axis tick marks so it reads as a plot, not a sketch.
  const ticks: number[] = [];
  for (let k = 0; k <= 4; k++) ticks.push(padX + (innerW * k) / 4);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="pretext-sparkline"
      role="img"
    >
      <rect
        className="pretext-sparkline__frame"
        x="0.5"
        y="0.5"
        width={width - 1}
        height={height - 1}
        rx="1"
        ry="1"
      />
      {ticks.map((tx) => (
        <line
          key={tx}
          className="pretext-sparkline__tick"
          x1={tx}
          x2={tx}
          y1={height - padY}
          y2={height - padY + 3}
        />
      ))}
      <path className="pretext-sparkline__area" d={area} />
      <path className="pretext-sparkline__line" d={line} />
      <text
        className="pretext-sparkline__label"
        x={padX + 2}
        y={padY + 2}
        dy="0.8em"
      >
        figure 1 · sparkline
      </text>
    </svg>
  );
}

export function PretextGate() {
  const [searchParams, setSearchParams] = useSearchParams();
  const slug = searchParams.get('slug') || DEFAULT_SLUG;
  const adapter = useAdapter();

  const [content, setContent] = useState<FiberContent | null>(null);
  const [graph, setGraph] = useState<FiberGraph>({ nodes: [], links: [] });

  useEffect(() => {
    let cancelled = false;
    adapter.getFiberContent(slug).then((next) => {
      if (!cancelled) setContent(next);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, slug]);

  useEffect(() => {
    let cancelled = false;
    adapter.getFiberGraph().then((next) => {
      if (!cancelled) setGraph(next);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  const node = useMemo(
    () => nodeFromGraph(graph, slug) ?? synthesizeNode(slug, content),
    [graph, slug, content],
  );

  const candidateNodes = useMemo(
    () => [...graph.nodes].sort((a, b) => a.slug.localeCompare(b.slug)),
    [graph.nodes],
  );

  // Live-resize state for the Gate 1b panel.
  const [cardWidth, setCardWidth] = useState<number>(DEFAULT_CARD_WIDTH);
  const [dragging, setDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      dragStartRef.current = { startX: e.clientX, startWidth: cardWidth };
      setDragging(true);
    },
    [cardWidth],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const next = Math.max(
      MIN_CARD_WIDTH,
      Math.min(MAX_CARD_WIDTH, Math.round(dragStartRef.current.startWidth + dx)),
    );
    setCardWidth(next);
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragStartRef.current = null;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  const media: MediaPane = useMemo(
    () => ({
      width: MEDIA_WIDTH,
      height: MEDIA_HEIGHT,
      placement: 'east',
      ariaLabel: 'Example sparkline plot',
      render: () => <Sparkline width={MEDIA_WIDTH} height={MEDIA_HEIGHT} />,
    }),
    [],
  );

  return (
    <div className="pretext-gate">
      <header className="pretext-gate__header">
        <h1>Pretext Gate</h1>
        <p className="pretext-gate__lede">
          One fiber, two surfaces. Above — PretextFiberCard at six canonical
          widths. Below — FiberCardWithMedia with a live-resizable frame and
          a fixed 190×120 plot. Text routes around the plot via pretext's
          per-line API, no CSS float.
        </p>
        <form
          className="pretext-gate__picker"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const selected = (form.elements.namedItem('slug') as HTMLSelectElement | null)?.value;
            if (selected) setSearchParams({ slug: selected });
          }}
        >
          <label>
            fiber
            <select name="slug" defaultValue={slug} key={slug}>
              {candidateNodes.map((n) => (
                <option key={n.slug} value={n.slug}>
                  {n.slug}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">load</button>
        </form>
        <p className="pretext-gate__current">
          <code>{slug}</code> — {node.label} · frame {cardWidth}px
        </p>
      </header>

      <section className="pretext-gate__grid">
        {GATE_WIDTHS.map(({ px, label }) => (
          <div key={px} className="pretext-gate__cell">
            <div className="pretext-gate__cell-label">{label}</div>
            <div
              className="pretext-gate__frame"
              style={{ width: `${px}px` }}
            >
              <PretextFiberCard node={node} width={px} widthLabel={label} />
            </div>
          </div>
        ))}
      </section>

      <section className="pretext-gate-1b__stage">
        <div
          className="pretext-gate-1b__card-wrap"
          style={{ width: `${cardWidth}px` }}
        >
          <FiberCardWithMedia node={node} width={cardWidth} media={media} />
          <div
            className={`pretext-gate-1b__handle${dragging ? ' is-dragging' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="separator"
            aria-label="Drag to resize card"
            aria-orientation="vertical"
          />
        </div>
        <aside className="pretext-gate-1b__legend">
          <p>
            Drag the gold handle at the bottom-right of the card to resize.
            The media rectangle holds its 190×120 geometry; body text
            reroutes around it on a per-line basis.
          </p>
          <ul>
            <li>Narrow (≤ ~320px) — media is suppressed; card reads as text-only.</li>
            <li>Medium (~420–640px) — media anchors top-right; text wraps to its left.</li>
            <li>Wide (≥ 720px) — text slot beside the media grows; outcome reads as a natural paragraph.</li>
          </ul>
        </aside>
      </section>
    </div>
  );
}
