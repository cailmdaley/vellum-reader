/**
 * /pretext-gate-1b — Workspace Gate 1b visual QA surface.
 *
 * One fiber, one media rectangle, one live-resizable card frame. Drag the
 * bottom-right handle and watch pretext restage the outcome + highlight text
 * around the media pane as the card's width changes. The point of Gate 1b
 * is to confirm that the per-line, obstacle-aware layout grammar composes
 * gracefully as the frame reshapes, no CSS floats involved.
 *
 * Defaults to `?slug=vellum-reader/workspace` and the same fiber picker as
 * /pretext-gate. Safe to delete once Gate 1b passes and the workspace
 * renderer switches to FiberCardWithMedia for real placement.
 *
 * See [[vellum-reader/workspace]] Evidence / Gate 1b.
 */

import { json } from '@remix-run/node';
import type { LoaderFunction, V2_MetaFunction } from '@remix-run/node';
import { Form, useLoaderData, useSearchParams } from '@remix-run/react';
import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import { getFiberContent, getAstraGraph } from '~/utils/content-server';
import type { FiberContent, AstraGraph, GraphNode } from '~/utils/content-types';
import {
  FiberCardWithMedia,
  type MediaPane,
} from '~/components/FiberCardWithMedia';

interface LoaderData {
  slug: string;
  content: FiberContent | null;
  graph: AstraGraph;
}

const DEFAULT_SLUG = 'vellum-reader/workspace';
const MIN_CARD_WIDTH = 220;
const MAX_CARD_WIDTH = 1000;
const DEFAULT_CARD_WIDTH = 560;

// The media pane's target geometry. Fixed for Gate 1b — the whole point is
// that it *doesn't* fluidly resize with the card; text routes around it.
const MEDIA_WIDTH = 190;
const MEDIA_HEIGHT = 120;

export const meta: V2_MetaFunction = () => [{ title: 'Pretext Gate 1b — Vellum' }];

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') || DEFAULT_SLUG;
  const [content, graph] = await Promise.all([
    getFiberContent(slug),
    getAstraGraph(),
  ]);
  return json<LoaderData>({ slug, content, graph });
};

function nodeFromGraph(graph: AstraGraph, slug: string): GraphNode | null {
  return graph.nodes.find((n) => n.slug === slug) ?? null;
}

/**
 * Synthesize a minimal GraphNode when the requested slug isn't in the ASTRA
 * graph. Mirrors the fallback in /pretext-gate so the two gates behave the
 * same when loading orphan fibers.
 */
function synthesizeNode(slug: string, content: FiberContent | null): GraphNode {
  const fm = (content?.frontmatter ?? {}) as Record<string, unknown>;
  const label =
    (typeof fm.title === 'string' && fm.title) ||
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

export default function PretextGate1b() {
  const { slug, content, graph } = useLoaderData<LoaderData>();
  const [searchParams] = useSearchParams();

  const node = nodeFromGraph(graph, slug) ?? synthesizeNode(slug, content);

  const [cardWidth, setCardWidth] = useState<number>(DEFAULT_CARD_WIDTH);
  const [dragging, setDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      dragStartRef.current = { startX: e.clientX, startWidth: cardWidth };
      setDragging(true);
    },
    [cardWidth],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.startX;
      const next = Math.max(
        MIN_CARD_WIDTH,
        Math.min(MAX_CARD_WIDTH, Math.round(dragStartRef.current.startWidth + dx)),
      );
      setCardWidth(next);
    },
    [],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = null;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  const candidateNodes = [...graph.nodes].sort((a, b) => a.slug.localeCompare(b.slug));

  const media: MediaPane = {
    width: MEDIA_WIDTH,
    height: MEDIA_HEIGHT,
    placement: 'east',
    ariaLabel: 'Example sparkline plot',
    render: () => <Sparkline width={MEDIA_WIDTH} height={MEDIA_HEIGHT} />,
  };

  return (
    <div className="pretext-gate pretext-gate-1b">
      <header className="pretext-gate__header">
        <h1>Pretext Gate 1b</h1>
        <p className="pretext-gate__lede">
          One fiber, one media rectangle, one live-resizable card. Grab the
          corner and drag — pretext routes outcome and highlight text around
          the plot as the frame reshapes. No CSS float.
        </p>
        <Form method="get" className="pretext-gate__picker">
          <label>
            fiber
            <select name="slug" defaultValue={searchParams.get('slug') ?? DEFAULT_SLUG}>
              {candidateNodes.map((n) => (
                <option key={n.slug} value={n.slug}>
                  {n.slug}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">load</button>
        </Form>
        <p className="pretext-gate__current">
          <code>{slug}</code> — {node.label} · frame {cardWidth}px
        </p>
      </header>

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
