/**
 * ContextCardLayer — floating fiber preview cards in the Narrative view.
 *
 * Manages spawning, dragging, resizing, and dismissing context cards.
 * Each card is a viewport-fixed floating panel showing a fiber's content.
 * Cards are opened via a custom DOM event so any component can trigger them
 * without prop-drilling.
 *
 * Integration: Add to NarrativeView.tsx alongside other layer components:
 *
 *   <ContextCardLayer
 *     graphNodes={graphNodes}
 *     graphLinks={graphLinks}
 *     proseRef={proseRef}
 *     wrapperRef={wrapperRef}
 *     onNavigate={(slug) => navigate(`/${slug}`)}
 *   />
 *
 * To open a card, dispatch from any click handler:
 *
 *   document.dispatchEvent(new CustomEvent('vellum:open-context-card', {
 *     detail: { slug, x: event.clientX, y: event.clientY }
 *   }));
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FiberContent, GraphLink, GraphNode } from '~/utils/content-types';
import { getFiberContent } from '~/api';

import { FiberCard } from './FiberCard';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContextCard {
  /** Unique key — fiber slug + timestamp to allow duplicate cards. */
  id: string;
  /** Fiber slug to load. */
  slug: string;
  /** Viewport-relative left position (px). */
  x: number;
  /** Viewport-relative top position (px). */
  y: number;
  /** Card width (px). */
  width: number;
  /** Card height (px). */
  height: number;
  /** If true, card scrolls with prose (margin-anchored). Unused in this iteration. */
  pinned: boolean;
  /** FiberContent once loaded. */
  content?: FiberContent | null;
  /** GraphNode for this fiber. */
  node?: GraphNode;
}

interface OpenCardEvent extends CustomEvent {
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

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 240;

/**
 * Offset from click point so the card doesn't obscure the element that
 * triggered it.
 */
const SPAWN_OFFSET_X = 16;
const SPAWN_OFFSET_Y = 8;

// ── Placeholder card body ─────────────────────────────────────────────────────

/** Minimal card body used until a real FiberCard component lands. */
function FiberCardPlaceholder({
  node,
  content: _content,
  width,
  onClose,
  onNavigate,
}: {
  node?: GraphNode;
  content?: FiberContent | null;
  width: number;
  onClose?: () => void;
  onNavigate?: (slug: string) => void;
}) {
  return (
    <div
      style={{
        position: 'relative',
        padding: 14,
        width,
        background: 'var(--prose-bg)',
        border: '1px solid rgba(184,134,11,0.15)',
        borderRadius: '0 0 3px 3px',
        boxSizing: 'border-box',
      }}
    >
      {onClose && (
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 4,
            right: 8,
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            padding: 0,
          }}
          aria-label="Close card"
        >
          ×
        </button>
      )}
      {node ? (
        <>
          <div
            style={{
              fontFamily: "'EB Garamond', serif",
              fontSize: 17,
              color: 'var(--text)',
              marginRight: 20,
            }}
          >
            {node.label}
          </div>
          {node.verdict && (
            <div
              style={{
                fontFamily: "'EB Garamond', serif",
                fontSize: 14,
                color: 'var(--text-muted)',
                marginTop: 6,
              }}
            >
              {node.verdict}
            </div>
          )}
          {onNavigate && (
            <button
              onClick={() => onNavigate(node.slug)}
              style={{
                marginTop: 10,
                background: 'none',
                border: '1px solid rgba(184,134,11,0.25)',
                borderRadius: 2,
                color: 'var(--gold)',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                padding: '3px 8px',
                cursor: 'pointer',
              }}
            >
              open →
            </button>
          )}
        </>
      ) : (
        <div className="context-card-float__loading">Loading…</div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ContextCardLayer({
  graphNodes,
  onNavigate,
}: ContextCardLayerProps) {
  const [cards, setCards] = useState<ContextCard[]>([]);
  // Track which card is currently being dragged/resized via a ref to avoid
  // stale closure issues in pointer event handlers.
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

  // ── Card management helpers ──────────────────────────────────────────────

  const updateCard = useCallback((id: string, patch: Partial<ContextCard>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const removeCard = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // ── Open-card event listener ──────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as OpenCardEvent;
      const { slug, x, y } = ev.detail;
      const id = `${slug}__${Date.now()}`;

      // Clamp spawn position so the card stays inside the viewport.
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cardX = Math.min(x + SPAWN_OFFSET_X, vw - DEFAULT_WIDTH - 8);
      const cardY = Math.min(y + SPAWN_OFFSET_Y, vh - DEFAULT_HEIGHT - 8);

      const node = graphNodes.find((n) => n.slug === slug);

      const newCard: ContextCard = {
        id,
        slug,
        x: Math.max(8, cardX),
        y: Math.max(8, cardY),
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        pinned: false,
        node,
        content: undefined,
      };

      setCards((prev) => [...prev, newCard]);

      // Fetch content asynchronously.
      getFiberContent(slug).then((content) => {
        setCards((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  content,
                  // Also resolve node in case graphNodes changed between
                  // event dispatch and content fetch.
                  node: graphNodes.find((n) => n.slug === slug) ?? c.node,
                }
              : c,
          ),
        );
      });
    };

    document.addEventListener('vellum:open-context-card', handler);
    return () => document.removeEventListener('vellum:open-context-card', handler);
  }, [graphNodes]);

  // ── Escape key: dismiss topmost card ─────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setCards((prev) => {
        if (prev.length === 0) return prev;
        return prev.slice(0, -1);
      });
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // ── Pointer move/up handler (shared for drag and resize) ──────────────────

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;

      if (state.mode === 'drag') {
        setCards((prev) =>
          prev.map((c) =>
            c.id === state.cardId
              ? {
                  ...c,
                  x: e.clientX - state.startClientX + state.startCardX,
                  y: e.clientY - state.startClientY + state.startCardY,
                }
              : c,
          ),
        );
      } else {
        setCards((prev) =>
          prev.map((c) =>
            c.id === state.cardId
              ? {
                  ...c,
                  width: Math.max(200, state.startWidth + (e.clientX - state.startClientX)),
                  height: Math.max(100, state.startHeight + (e.clientY - state.startClientY)),
                }
              : c,
          ),
        );
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

  // ── Drag / resize initiators ──────────────────────────────────────────────

  const startDrag = useCallback(
    (card: ContextCard) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      // Bring this card to the front by moving it to the end of the list.
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
    (card: ContextCard) => (e: React.PointerEvent<HTMLDivElement>) => {
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
          {/* Drag handle */}
          <div
            className="context-card-float__handle"
            onPointerDown={startDrag(card)}
          >
            <span className="context-card-float__title">
              {card.node?.label ?? card.slug}
            </span>
          </div>

          {/* Card body */}
          {card.node ? (
            <FiberCard
              node={card.node}
              width={card.width}
              content={card.content ?? undefined}
              onClose={() => removeCard(card.id)}
              onNavigate={onNavigate}
            />
          ) : (
            <div className="context-card-float__loading">Loading…</div>
          )}

          {/* Resize handle — bottom-right corner */}
          <div
            className="context-card-float__resize"
            onPointerDown={startResize(card)}
          />
        </div>
      ))}
    </div>
  );
}
