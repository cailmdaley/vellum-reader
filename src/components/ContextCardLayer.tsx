/**
 * ContextCardLayer — floating pinned cards for the Narrative view.
 *
 * Renders pinned Cards that were promoted from a hover preview. Each
 * pinned card lives in one of two modes:
 *
 *   canvas — position tracks the document, so the card scrolls with
 *            the prose it was pinned next to. This is the default
 *            when promoting a hover preview: the card "stays put"
 *            relative to the passage that summoned it.
 *   screen — position tracks the viewport. Click the pin glyph once
 *            on a canvas-mode card to promote it: now it hangs over
 *            the reader and doesn't drift as they scroll.
 *
 * Click the pin glyph on a screen-mode card to unpin (close). Any
 * surface can pin a card by dispatching `vellum:open-card`:
 *
 *   document.dispatchEvent(new CustomEvent('vellum:open-card', {
 *     detail: {
 *       content: CardContent,
 *       x, y,               // viewport coordinates of the spawn point
 *       width?: number,     // optional width override
 *       exactPosition?: bool, // if true, spawn exactly at (x, y)
 *     },
 *   }));
 *
 * The layer owns drag/resize state, z-ordering, and ESC-to-dismiss.
 * The wrapper catches pointer-down for dragging; interactive children
 * (buttons, links) stop propagation so they don't initiate a drag.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Card, type CardContent } from './Card';
import { marginaliaWidth, readCanvasLeft, readCanvasWidth } from '~/utils/canvas-geometry';
import { useTheme } from '~/contexts/ThemeContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type PinMode = 'canvas' | 'screen';

interface FloatingCard {
  /** Unique id — timestamp-salted so every card has a distinct DOM key.
   *  Not the same as `key`, which identifies the content. */
  id: string;
  /** Content identity — see `contentKey`. A second open-card event for
   *  the same key lifts the existing card to front instead of spawning
   *  a duplicate. */
  key: string;
  content: CardContent;
  mode: PinMode;
  /**
   * Position in the coordinate frame implied by `mode`:
   *   canvas → document / page coords (x = clientX + scrollX)
   *   screen → viewport coords
   */
  x: number;
  y: number;
  width: number;
  /** Explicit height (px) once the user has resized or once spawned
   *  from a preview with a known rendered height. `null` means
   *  size-to-content — the card takes whatever height its children
   *  compose to. */
  height: number | null;
}

interface OpenCardEvent extends CustomEvent {
  detail: {
    content: CardContent;
    x: number;
    y: number;
    /** Spawn width override — e.g. the hover preview's own width. */
    width?: number;
    /** Spawn height override so the pinned card matches the hover
     *  preview's exact rendered size. When omitted the card sizes to
     *  its content. */
    height?: number;
    /** When true, skip offset + clamp; treat (x, y) as the final spawn. */
    exactPosition?: boolean;
  };
}

export interface ContextCardLayerProps {
  onNavigate: (slug: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 340;
const MIN_HEIGHT = 100;

/** Offset from the click point so the card doesn't cover its trigger. */
const SPAWN_OFFSET_X = 16;
const SPAWN_OFFSET_Y = 8;

function readCanvasGeometry(): { canvasLeft: number; canvasWidth: number } {
  return { canvasLeft: readCanvasLeft(), canvasWidth: readCanvasWidth() };
}

function initialCardWidth(): number {
  return marginaliaWidth(readCanvasWidth(), DEFAULT_WIDTH);
}

/** Stable identity for a CardContent — two cards with the same key are
 *  the "same" card from the reader's perspective. Used to lift an
 *  existing card to front instead of spawning a duplicate stack. */
function contentKey(c: CardContent): string {
  switch (c.type) {
    case 'fiber':    return `fiber:${c.node.slug}`;
    case 'decision': return `decision:${c.hostSlug ?? ''}:${c.decision.key}`;
    case 'finding':  return `finding:${c.hostSlug ?? ''}:${c.finding.key}`;
    case 'plot':     return `plot:${c.src}`;
    case 'input':    return `input:${c.hostNode?.slug ?? ''}:${c.input?.id ?? c.label ?? c.from ?? ''}`;
    case 'output':   return `output:${c.hostNode?.slug ?? ''}:${c.output?.id ?? c.label ?? ''}`;
  }
}

function clampSpawn(x: number, y: number, width: number): { x: number; y: number } {
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const { canvasLeft } = readCanvasGeometry();
  return {
    x: Math.max(canvasLeft + 12, Math.min(x + SPAWN_OFFSET_X, vw - width - 8)),
    y: Math.max(8, Math.min(y + SPAWN_OFFSET_Y, vh - MIN_HEIGHT - 8)),
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export function ContextCardLayer({
  onNavigate,
}: ContextCardLayerProps) {
  const { theme } = useTheme();
  const exclusive = theme.layout.cardStacking === 'exclusive';
  // Stash in a ref so the once-registered open-card listener always reads the
  // current theme's stacking rule without re-registering on theme change.
  const exclusiveRef = useRef(exclusive);
  exclusiveRef.current = exclusive;
  const [cards, setCards] = useState<FloatingCard[]>([]);
  // Scroll offset drives canvas-mode rendering: a canvas-pinned card
  // stores page coords and we subtract the current scroll to produce
  // viewport coords for the fixed-position layer. On scroll, this
  // state updates and the cards re-render with the new offset, which
  // is how they "scroll with the document" while still living in a
  // position:fixed layer.
  const [scroll, setScroll] = useState(() => ({
    x: typeof window === 'undefined' ? 0 : window.scrollX,
    y: typeof window === 'undefined' ? 0 : window.scrollY,
  }));
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

  // ── Track window scroll for canvas-mode positioning ──────────────────────

  useEffect(() => {
    const onScroll = () => {
      setScroll({ x: window.scrollX, y: window.scrollY });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── Track --canvas-width so pinned cards follow the divider ─────────────
  // When the reader drags CanvasDivider, it writes a new --canvas-width
  // to document.documentElement.style. Each pinned card reflows to the
  // new marginalia width AND shifts its x to stay anchored to the
  // canvas column's left edge — so cards remain gutter-filling whether
  // the reader grows or shrinks the column. Drag and resize on the
  // cards are locked to the vertical axis (see pointermove handler
  // below), which makes this reflow the sole authority on width/x.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let lastCanvasLeft = readCanvasGeometry().canvasLeft;
    let lastWidth = readCanvasGeometry().canvasWidth;
    const update = () => {
      const { canvasWidth, canvasLeft } = readCanvasGeometry();
      if (canvasWidth === lastWidth && canvasLeft === lastCanvasLeft) return;
      const nextWidth = marginaliaWidth(canvasWidth);
      const dx = canvasLeft - lastCanvasLeft;
      lastCanvasLeft = canvasLeft;
      lastWidth = canvasWidth;
      setCards((prev) => prev.map((c) => {
        const nextX = c.x + dx;
        if (c.width === nextWidth && nextX === c.x) return c;
        return { ...c, width: nextWidth, x: nextX };
      }));
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // ── open-card (generic) ───────────────────────────────────────────────────
  // Spawns a floating card for any CardContent. Callers provide the payload
  // directly; the layer doesn't fetch anything.

  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as OpenCardEvent;
      const {
        content,
        x,
        y,
        width: widthOverride,
        height: heightOverride,
        exactPosition,
      } = ev.detail;
      const key = contentKey(content);
      setCards((prev) => {
        const isExclusive = exclusiveRef.current;
        // Repeat click on the same finding/decision/etc → lift the
        // existing card to front instead of stacking a duplicate. All
        // lookup + mutation lives inside the updater so there's no
        // sync/async mismatch with batched state.
        //
        // Under `cardStacking: 'exclusive'` (lightcone-margin), the match
        // becomes the sole card in the layer — any others that might
        // have lingered from a prior theme switch are dismissed.
        const match = prev.find((c) => c.key === key);
        if (match) {
          return isExclusive
            ? [match]
            : [...prev.filter((c) => c.id !== match.id), match];
        }
        const id = `${content.type}__${Date.now()}__${Math.random().toString(36).slice(2, 6)}`;
        const width = widthOverride ?? initialCardWidth();
        // When pinning from a hover preview, the caller already has a
        // validated on-screen rect — spawn exactly there so the pin feels
        // like the preview staying put. Otherwise apply the offset +
        // clamp used for fresh spawns from a click point.
        const viewportPos = exactPosition ? { x, y } : clampSpawn(x, y, width);
        // Promote viewport coords to page coords for canvas mode.
        const pos = {
          x: viewportPos.x + window.scrollX,
          y: viewportPos.y + window.scrollY,
        };
        const spawned: FloatingCard = {
          id,
          key,
          content,
          mode: 'canvas',
          x: pos.x,
          y: pos.y,
          width,
          height: heightOverride ?? null,
        };
        // Exclusive stacking: the new card replaces whatever was pinned.
        // Non-exclusive: append to the stack; older cards stay pinned.
        return isExclusive ? [spawned] : [...prev, spawned];
      });
      // The pinned card is intentionally the hover preview that stopped
      // going away — no prose-body fetch, no header-duplicating swap.
      // To read full prose the user navigates to the fiber itself.
    };
    document.addEventListener('vellum:open-card', handler);
    return () => document.removeEventListener('vellum:open-card', handler);
  }, []);

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
        // Vertical-only drag. Width tracks --canvas-width so horizontal
        // position is pinned to the marginalia column; letting the reader
        // drag x would strand cards outside the column the next time the
        // divider moves (cards would reflow width but keep the old x).
        setCards((prev) => prev.map((c) => (
          c.id === state.cardId
            ? {
                ...c,
                y: e.clientY - state.startClientY + state.startCardY,
              }
            : c
        )));
      } else {
        // Height-only resize for the same reason — width is canvas-driven.
        setCards((prev) => prev.map((c) => (
          c.id === state.cardId
            ? {
                ...c,
                height: Math.max(MIN_HEIGHT, state.startHeight + (e.clientY - state.startClientY)),
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

  const liftToFront = useCallback((id: string) => {
    setCards((prev) => {
      const without = prev.filter((c) => c.id !== id);
      const target = prev.find((c) => c.id === id);
      return target ? [...without, target] : prev;
    });
  }, []);

  const startDrag = useCallback(
    (card: FloatingCard) => (e: React.PointerEvent<HTMLDivElement>) => {
      // Don't hijack clicks on interactive elements inside the card
      // (buttons, links, inputs). Their own onClick handlers should
      // fire; only "dead space" on the card initiates a drag.
      const target = e.target as HTMLElement;
      // Don't hijack pointer-down on interactive controls (buttons,
      // links, option lists) or on selectable text — users should be
      // able to click into the card and select its prose. Drag is
      // initiated from the card's empty chrome (padding, tag row).
      if (target.closest(
        'button, a, input, textarea, [role="button"], ' +
        '.context-card-float__resize, .pretext-line, .fiber-card__prose'
      )) {
        return;
      }
      e.preventDefault();
      liftToFront(card.id);
      dragStateRef.current = {
        cardId: card.id,
        mode: 'drag',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCardX: card.x,
        startCardY: card.y,
        startWidth: card.width,
        // When height is null (size-to-content), seed the drag with
        // the rendered height so the first resize tick doesn't jump.
        startHeight: card.height ?? (
          document.getElementById(`ctxcard-${card.id}`)?.getBoundingClientRect().height
          ?? MIN_HEIGHT
        ),
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [liftToFront],
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
        // When height is null (size-to-content), seed the drag with
        // the rendered height so the first resize tick doesn't jump.
        startHeight: card.height ?? (
          document.getElementById(`ctxcard-${card.id}`)?.getBoundingClientRect().height
          ?? MIN_HEIGHT
        ),
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  // Pin-glyph click toggles canvas ↔ screen. Canvas mode pins the
  // card to the margin so it scrolls with the prose; screen mode
  // floats it fixed over the viewport. Coordinates are translated on
  // each switch so the card stays visually in place at the moment of
  // the transition.
  const handlePinToggle = useCallback((card: FloatingCard) => {
    setCards((prev) => prev.map((c) => {
      if (c.id !== card.id) return c;
      if (c.mode === 'canvas') {
        return { ...c, mode: 'screen', x: c.x - window.scrollX, y: c.y - window.scrollY };
      }
      return { ...c, mode: 'canvas', x: c.x + window.scrollX, y: c.y + window.scrollY };
    }));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (cards.length === 0) return null;

  return (
    <div className="context-card-layer">
      {cards.map((card, index) => {
        // Both modes use position: fixed (the layer is fixed); canvas
        // mode subtracts scroll so the card rides the document.
        const renderLeft = card.mode === 'canvas' ? card.x - scroll.x : card.x;
        const renderTop = card.mode === 'canvas' ? card.y - scroll.y : card.y;
        return (
          <div
            key={card.id}
            id={`ctxcard-${card.id}`}
            className={`context-card-float context-card-float--${card.mode}`}
            style={{
              position: 'fixed',
              left: renderLeft,
              top: renderTop,
              width: card.width,
              // `height: null` means size-to-content; once the user
              // resizes (or the card spawned with an explicit height
              // from a preview rect) we apply it directly so the
              // card matches the height the reader saw.
              height: card.height ?? undefined,
              zIndex: 100 + index,
            }}
            onPointerDown={startDrag(card)}
            onDoubleClick={(e) => {
              // Double-click on dead space (chrome, padding, tag row)
              // closes the card — a quick gesture that doesn't require
              // aiming at the × button. Double-clicking selectable
              // text still selects a word: the same exclusion list we
              // use for drag-initiation keeps text-selection intact.
              const target = e.target as HTMLElement;
              if (target.closest(
                'button, a, input, textarea, [role="button"], ' +
                '.context-card-float__resize, .pretext-line, .fiber-card__prose'
              )) return;
              removeCard(card.id);
            }}
          >
            <Card
              content={card.content}
              width={card.width}
              onClose={() => removeCard(card.id)}
              onPin={() => handlePinToggle(card)}
              pinMode={card.mode}
              onNavigate={onNavigate}
            />

            {/* Resize handle — bottom-edge strip (ns-resize, vertical only). */}
            <div
              className="context-card-float__resize"
              onPointerDown={startResize(card)}
            />
          </div>
        );
      })}
    </div>
  );
}
