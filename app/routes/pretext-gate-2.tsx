/**
 * /pretext-gate-2 — Workspace Gate 2 visual + performance QA surface.
 *
 * Renders the whole ASTRA graph as a dense grid of pretext-powered cards at a
 * fixed width, inside a pannable viewport. The point of Gate 2 per the
 * [[vellum-reader/workspace]] constitution is to answer:
 *
 *   At single-zoom, do 100–200 real cards pan smoothly?
 *
 * "Smoothly" means: pointer-drag pan via CSS `transform: translate(...)`
 * (never reflow), a frame-time HUD that shows a rolling mean and a p95 so the
 * user can eyeball 60fps without DevTools, and no visible jank.
 *
 * Deliberately NOT in this gate:
 *   - Virtualization (render only visible cards). Gate 2 is the surface that
 *     will tell us whether it's needed at all.
 *   - Hand-placement persistence. Cards flow through a simple CSS grid so we
 *     can focus on pretext + transform performance, not layout choreography.
 *   - Zoom. Width is fixed at `CARD_WIDTH`; zoom-as-width lives in Gate 3.
 *   - Media panes. FiberCardWithMedia falls back to a text-only composition
 *     when `media` is undefined, which is what we want here — every card is
 *     real text through pretext, and nothing else.
 *
 * Safe to delete once the workspace renderer absorbs this as real behavior
 * and the gate passes in [[vellum-reader/workspace]] Evidence.
 */

import { json } from '@remix-run/node';
import type { LoaderFunction, V2_MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { getAstraGraph } from '~/utils/content-server';
import type { AstraGraph, GraphNode } from '~/utils/content-types';
import { FiberCardWithMedia } from '~/components/FiberCardWithMedia';

interface LoaderData {
  graph: AstraGraph;
}

// Card frame for Gate 2. A single "comfortable" width — the constitution
// holds three canonical widths but we exercise exactly one here so the gate
// measures transform perf, not relayout cost under width change.
const CARD_WIDTH = 320;

// The constitution targets 100–200 cards for Gate 2. The graph currently
// emits ~75 nodes (only fibers with directory-layout and frontmatter make
// it through the felt loader), so we replicate the sorted node list until
// we clear the target floor. Replicated cards render independently in the
// compositor — for pan perf this is indistinguishable from having that many
// truly distinct nodes. If the graph grows past the floor, we stop
// replicating and cap at the ceiling so the page remains a manageable
// target.
const TARGET_MIN_CARDS = 150;
const TARGET_MAX_CARDS = 220;

export const meta: V2_MetaFunction = () => [{ title: 'Pretext Gate 2 — Vellum' }];

export const loader: LoaderFunction = async () => {
  const graph = await getAstraGraph();
  return json<LoaderData>({ graph });
};

/**
 * FPS / frame-time HUD. Samples requestAnimationFrame and renders a rolling
 * mean + p95 over the last N frames. Runs continuously, not just during pan,
 * so the user can tell the difference between "cards jank on mount" and
 * "cards jank during pan."
 */
function useFrameStats(sampleSize = 120) {
  const samplesRef = useRef<number[]>([]);
  const [stats, setStats] = useState<{ mean: number; p95: number; fps: number }>(
    { mean: 0, p95: 0, fps: 0 },
  );

  useEffect(() => {
    let rafId = 0;
    let lastT = performance.now();
    let flushAt = lastT;
    let warmup = 4; // skip the first few ticks so mount-gap doesn't poison stats

    const tick = (t: number) => {
      const dt = t - lastT;
      lastT = t;
      if (warmup > 0) {
        warmup -= 1;
        rafId = requestAnimationFrame(tick);
        return;
      }
      // Clamp crazy dts (tab blur / very long frame) so a single stall
      // doesn't dominate the rolling window for seconds afterward.
      const clamped = Math.min(dt, 200);
      const samples = samplesRef.current;
      samples.push(clamped);
      if (samples.length > sampleSize) samples.shift();

      // Only flush to React state a few times per second — updating every
      // frame would itself cost frame budget and pollute the measurement.
      if (t - flushAt > 200 && samples.length > 0) {
        flushAt = t;
        const sorted = [...samples].sort((a, b) => a - b);
        const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
        const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? mean;
        setStats({ mean, p95, fps: 1000 / mean });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [sampleSize]);

  return stats;
}

/**
 * Stable, replicated card list: sort the graph's nodes, repeat until we
 * clear the target floor, then cap at the ceiling. Keys are suffixed with
 * the repeat index so React reconciles each replica independently.
 */
function buildCardList(graph: AstraGraph): Array<{ key: string; node: GraphNode }> {
  const sorted = [...graph.nodes].sort((a, b) => a.slug.localeCompare(b.slug));
  if (sorted.length === 0) return [];
  const out: Array<{ key: string; node: GraphNode }> = [];
  let rep = 0;
  while (out.length < TARGET_MIN_CARDS && out.length < TARGET_MAX_CARDS) {
    for (const node of sorted) {
      if (out.length >= TARGET_MAX_CARDS) break;
      const key = rep === 0 ? node.id : `${node.id}#${rep}`;
      out.push({ key, node });
    }
    rep += 1;
    if (rep > 10) break; // safety
  }
  return out.slice(0, TARGET_MAX_CARDS);
}

export default function PretextGate2() {
  const { graph } = useLoaderData<LoaderData>();

  const cards = buildCardList(graph);

  // Pan state: translate is applied as a `transform` on the grid container.
  // Never touch width/top/left — we want paint + composite, not reflow.
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<
    | { startX: number; startY: number; startPanX: number; startPanY: number }
    | null
  >(null);
  const [dragging, setDragging] = useState(false);

  const stats = useFrameStats();

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Left button only; ignore right-click/middle-click.
      if (e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      setDragging(true);
    },
    [pan.x, pan.y],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      setPan({ x: drag.startPanX + dx, y: drag.startPanY + dy });
    },
    [],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  const onRecenter = useCallback(() => setPan({ x: 0, y: 0 }), []);

  // Colour the HUD by health: 60fps green, 30-60 amber, <30 red. Thresholds
  // are subjective but match what a user will notice without measurements.
  const hudClass =
    stats.fps >= 55
      ? 'pretext-gate-2__hud is-healthy'
      : stats.fps >= 30
        ? 'pretext-gate-2__hud is-degraded'
        : 'pretext-gate-2__hud is-bad';

  return (
    <div className="pretext-gate pretext-gate-2">
      <header className="pretext-gate__header">
        <h1>Pretext Gate 2</h1>
        <p className="pretext-gate__lede">
          {cards.length} cards from {graph.nodes.length} real fibers, one
          fixed card width, one pan transform. Drag the canvas to pan. Can
          this many pretext-composed cards ride a CSS translate at 60fps
          without virtualization?
        </p>
        <p className="pretext-gate__current">
          <code>{cards.length}</code> cards · <code>{graph.nodes.length}</code>{' '}
          unique fibers · <code>{CARD_WIDTH}px</code> frame · drag to pan ·{' '}
          <button type="button" onClick={onRecenter}>recenter</button>
        </p>
      </header>

      <div className={hudClass} role="status" aria-live="off">
        <span className="pretext-gate-2__hud-metric">
          <span className="pretext-gate-2__hud-label">fps</span>
          <span className="pretext-gate-2__hud-value">{stats.fps.toFixed(0)}</span>
        </span>
        <span className="pretext-gate-2__hud-metric">
          <span className="pretext-gate-2__hud-label">mean</span>
          <span className="pretext-gate-2__hud-value">{stats.mean.toFixed(1)}ms</span>
        </span>
        <span className="pretext-gate-2__hud-metric">
          <span className="pretext-gate-2__hud-label">p95</span>
          <span className="pretext-gate-2__hud-value">{stats.p95.toFixed(1)}ms</span>
        </span>
        <span className="pretext-gate-2__hud-metric">
          <span className="pretext-gate-2__hud-label">cards</span>
          <span className="pretext-gate-2__hud-value">{cards.length}</span>
        </span>
      </div>

      <section
        className={`pretext-gate-2__viewport${dragging ? ' is-dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="pretext-gate-2__canvas"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
          }}
        >
          {cards.map(({ key, node }) => (
            <div
              key={key}
              className="pretext-gate-2__cell"
              style={{ width: `${CARD_WIDTH}px` }}
            >
              <FiberCardWithMedia node={node} width={CARD_WIDTH} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
