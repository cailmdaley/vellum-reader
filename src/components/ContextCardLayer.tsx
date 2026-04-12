/**
 * ContextCardLayer — floating cards layer for the Narrative view.
 *
 * Renders a stack of viewport-fixed, draggable, resizable cards built on
 * the unified Card primitive (`Card.tsx`). Any surface can pop a card by
 * dispatching one of two custom events:
 *
 *   // Open any Card content directly — decision, insight, plot, input,
 *   // output, myst, or a fully-assembled fiber payload.
 *   document.dispatchEvent(new CustomEvent('vellum:open-card', {
 *     detail: { content: CardContent, x, y }
 *   }));
 *
 *   // Slug-based convenience: fetch the fiber's content and spawn a
 *   // fiber-typed Card. Historical API — MarginCitations still uses it.
 *   document.dispatchEvent(new CustomEvent('vellum:open-context-card', {
 *     detail: { slug, x, y }
 *   }));
 *
 * The layer owns drag/resize state, z-ordering, and ESC-to-dismiss. Each
 * card body is rendered through the shared `Card` component so a floating
 * DecisionCard looks and behaves like a Workspace-anatomy DecisionCard.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GraphLink, GraphNode } from '~/utils/content-types';
import { getFiberContent } from '~/api';

import { Card, type CardContent } from './Card';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FloatingCard {
  /** Unique id — timestamp-salted so duplicate contents are allowed. */
  id: string;
  /** The actual Card payload to render. */
  content: CardContent;
  /** Viewport-relative left position (px). */
  x: number;
  /** Viewport-relative top position (px). */
  y: number;
  /** Card width (px). */
  width: number;
  /** Card minimum height (px) — Card composes its real height from content. */
  height: number;
}

interface OpenCardEvent extends CustomEvent {
  detail: { content: CardContent; x: number; y: number };
}

interface OpenContextCardEvent extends CustomEvent {
  detail: { slug: string; x: number; y: number };
}

export interface ContextCardLayerProps {
  graphNodes: GraphNode[];
  graphLinks?: GraphLink[];
  proseRef: React.RefObject<HTMLElement>;
  wrapperRef: React.RefObject<HTMLDivElement>;
  onNavigate: (slug: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 340;
const DEFAULT_HEIGHT = 200;

/** Offset from the click point so the card doesn't cover its trigger. */
const SPAWN_OFFSET_X = 16;
const SPAWN_OFFSET_Y = 8;

function clampSpawn(x: number, y: number): { x: number; y: number } {
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  return {
    x: Math.max(8, Math.min(x + SPAWN_OFFSET_X, vw - DEFAULT_WIDTH - 8)),
    y: Math.max(8, Math.min(y + SPAWN_OFFSET_Y, vh - DEFAULT_HEIGHT - 8)),
  };
}

function titleOf(content: CardContent): string {
  switch (content.type) {
    case 'fiber': return content.node.label;
    case 'decision': return content.decision.label;
    case 'insight': return 'Insight';
    case 'plot': return content.caption ?? 'Figure';
    case 'input': return content.label;
    case 'output': return content.label;
    case 'myst': return content.label;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function ContextCardLayer({
  graphNodes,
  onNavigate,
}: ContextCardLayerProps) {
  const [cards, setCards] = useState<FloatingCard[]>([]);
  // Drag/resize target tracked via ref to avoid stale closures in the
  // window-level pointer move handler.
  const dragStateRef = useRef<{
    cardId: string;
    mode: 'drag' | 'resize';
    startClientX: number;
    startClientY: number;
    startCardX: number;
    startCardY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const removeCard = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // ── open-card (generic) ───────────────────────────────────────────────────
  // Spawns a floating card for any CardContent. Callers provide the payload
  // directly; the layer doesn't fetch anything.

  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as OpenCardEvent;
      const { content, x, y } = ev.detail;
      const id = `${content.type}__${Date.now()}__${Math.random().toString(36).slice(2, 6)}`;
      const pos = clampSpawn(x, y);
      setCards((prev) => [...prev, {
        id,
        content,
        x: pos.x,
        y: pos.y,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      }]);
    };
    document.addEventListener('vellum:open-card', handler);
    return () => document.removeEventListener('vellum:open-card', handler);
  }, []);

  // ── open-context-card (slug-based, legacy) ────────────────────────────────
  // Looks up the GraphNode, fetches FiberContent asynchronously, then
  // assembles a {type:'fiber'} CardContent. The card appears immediately
  // with whatever node metadata we have and upgrades once content lands.

  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as OpenContextCardEvent;
      const { slug, x, y } = ev.detail;
      const node = graphNodes.find((n) => n.slug === slug);
      if (!node) return;

      const id = `fiber:${slug}__${Date.now()}`;
      const pos = clampSpawn(x, y);
      setCards((prev) => [...prev, {
        id,
        content: { type: 'fiber', node },
        x: pos.x,
        y: pos.y,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      }]);

      getFiberContent(slug).then((content) => {
        setCards((prev) => prev.map((c) => (
          c.id === id
            ? { ...c, content: { type: 'fiber', node, content: content ?? undefined } }
            : c
        )));
      });
    };
    document.addEventListener('vellum:open-context-card', handler);
    return () => document.removeEventListener('vellum:open-context-card', handler);
  }, [graphNodes]);

  // ── Escape: dismiss topmost card ─────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setCards((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // ── Shared pointer move/up handler (drag and resize) ──────────────────────

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;

      if (state.mode === 'drag') {
        setCards((prev) => prev.map((c) => (
          c.id === state.cardId
            ? {
                ...c,
                x: e.clientX - state.startClientX + state.startCardX,
                y: e.clientY - state.startClientY + state.startCardY,
              }
            : c
        )));
      } else {
        setCards((prev) => prev.map((c) => (
          c.id === state.cardId
            ? {
                ...c,
                width: Math.max(200, state.startWidth + (e.clientX - state.startClientX)),
                height: Math.max(100, state.startHeight + (e.clientY - state.startClientY)),
              }
            : c
        )));
      }
    };

    const onUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const startDrag = useCallback(
    (card: FloatingCard) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      // Lift to front by moving to the end of the list (highest z-index).
      setCards((prev) => {
        const without = prev.filter((c) => c.id !== card.id);
        const target = prev.find((c) => c.id === card.id);
        return target ? [...without, target] : prev;
      });
      dragStateRef.current = {
        cardId: card.id,
        mode: 'drag',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCardX: card.x,
        startCardY: card.y,
        startWidth: card.width,
        startHeight: card.height,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const startResize = useCallback(
    (card: FloatingCard) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragStateRef.current = {
        cardId: card.id,
        mode: 'resize',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCardX: card.x,
        startCardY: card.y,
        startWidth: card.width,
        startHeight: card.height,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (cards.length === 0) return null;

  return (
    <div className="context-card-layer">
      {cards.map((card, index) => (
        <div
          key={card.id}
          className="context-card-float"
          style={{
            position: 'fixed',
            left: card.x,
            top: card.y,
            width: card.width,
            minHeight: card.height,
            zIndex: 100 + index,
          }}
        >
          {/* Drag handle — the strip above the card chrome. Title echoes
              the card's own title so the handle still reads when it
              overflows or wraps the body. */}
          <div
            className="context-card-float__handle"
            onPointerDown={startDrag(card)}
          >
            <span className="context-card-float__title">{titleOf(card.content)}</span>
          </div>

          <Card
            content={card.content}
            width={card.width}
            onClose={() => removeCard(card.id)}
            onNavigate={onNavigate}
          />

          {/* Resize handle — bottom-right corner. */}
          <div
            className="context-card-float__resize"
            onPointerDown={startResize(card)}
          />
        </div>
      ))}
    </div>
  );
}
