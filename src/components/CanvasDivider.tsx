/**
 * CanvasDivider — draggable vertical rail between the left content and the
 * right-side canvas pane. Writes its position to `--canvas-width` on :root
 * and persists to localStorage so it survives reloads.
 *
 * Resizing uses pointer capture on the rail itself so the drag stays live
 * even when the cursor wanders into iframes, the canvas body, or the
 * narrative column. Minimum widths clamp the split so neither side can
 * collapse entirely.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'vellum:canvas-width';
const DEFAULT_WIDTH = 420;
const MIN_CANVAS = 200;
const MIN_CONTENT = 480;

function loadWidth(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_WIDTH;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw == null) return DEFAULT_WIDTH;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WIDTH;
}

function clampToViewport(width: number): number {
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const maxCanvas = Math.max(MIN_CANVAS, vw - MIN_CONTENT);
  return Math.min(Math.max(MIN_CANVAS, width), maxCanvas);
}

export function CanvasDivider() {
  const [width, setWidth] = useState<number>(() => loadWidth());
  const railRef = useRef<HTMLDivElement>(null);

  // Push the live width onto :root so .vellum-page (and anything else) can
  // reserve the right-side real estate via CSS calc.
  useEffect(() => {
    const clamped = clampToViewport(width);
    document.documentElement.style.setProperty('--canvas-width', `${clamped}px`);
    return () => {
      document.documentElement.style.removeProperty('--canvas-width');
    };
  }, [width]);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
  }, [width]);

  // Re-clamp on window resize so the split doesn't swallow the viewport at
  // smaller widths. The stored value stays put — only the applied CSS shrinks.
  useEffect(() => {
    function onResize() {
      setWidth((current) => clampToViewport(current));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rail = e.currentTarget;
    const pointerId = e.pointerId;
    rail.setPointerCapture(pointerId);
    e.preventDefault();

    const onMove = (ev: PointerEvent) => {
      const next = window.innerWidth - ev.clientX;
      setWidth(clampToViewport(next));
    };
    const onEnd = () => {
      rail.removeEventListener('pointermove', onMove);
      rail.removeEventListener('pointerup', onEnd);
      rail.removeEventListener('pointercancel', onEnd);
      try {
        rail.releasePointerCapture(pointerId);
      } catch {
        // already released
      }
    };
    rail.addEventListener('pointermove', onMove);
    rail.addEventListener('pointerup', onEnd);
    rail.addEventListener('pointercancel', onEnd);
  }, []);

  return (
    <div
      ref={railRef}
      className="vellum-canvas-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize canvas"
      onPointerDown={onPointerDown}
    />
  );
}
