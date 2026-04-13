/**
 * Delta inbox — every recent change to a fiber is one card.
 *
 * Each card wraps the unified Card primitive (fiber preview) with an
 * event-type ribbon above and a Temper/Archive action bar below. The
 * constitution is explicit: delta adds an action bar, it does not fork
 * the renderer. Using the shared Card means delta cards wear the same
 * Weathered Substrate palette and pretext lockup as margin previews,
 * pinned floating cards, and workspace anatomy.
 *
 * Cards are newest-first. Temper sets `tempered: true` on the underlying
 * fiber; Archive sets `status: closed`. Both write directly to disk via
 * PATCH /content/<slug>.md. After an action lands, every other card from
 * the same fiber is dismissed locally — one commit per fiber, not per
 * event.
 *
 * Today the log emits `created`, `active`, and `closed` events. Richer
 * event types (body edits, insight additions, decision flips) will land
 * when the log route learns to diff fiber history.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFiberContent, patchFiberFrontmatter } from '~/api';
import { Card } from './Card';
import { useMode } from '~/contexts/ModeContext';
import type { FiberContent, GraphNode, LogEvent } from '~/utils/content-types';

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

const EVENT_GLYPH: Record<string, string> = {
  created: '+',
  active: '◐',
  closed: '●',
};

const EVENT_LABEL: Record<string, string> = {
  created: 'created',
  active: 'activated',
  closed: 'closed',
};

/** Shape a LogEvent into the minimal GraphNode the Card primitive needs
 *  to render its preview mode. The log carries title/status/tags/outcome;
 *  the rest of the node is left empty, which preview mode tolerates. */
function eventToNode(event: LogEvent): GraphNode {
  return {
    id: event.fiberId,
    label: event.title || event.fiberId,
    slug: event.fiberId,
    status: event.status,
    tags: event.tags,
    verdict: event.outcome,
  };
}

interface DeltaViewProps {
  events: LogEvent[];
  /** Retained for future "since last visit" affordances; not used today. */
  since?: string | null;
  onDismissFiber: (fiberId: string) => void;
  onRefresh: () => void;
}

/** Card min-width used in the CSS grid's auto-fill tracks. Keep in sync
 *  with `.delta-view__grid` in vellum.css — JS uses this to derive how
 *  many grid cells the thumb-index footprint occupies. */
const CARD_MIN_WIDTH = 280;
/** Approximate card height + gap, for turning the thumb-index's pixel
 *  height into a row-span. Cards are content-sized in practice, so this
 *  is a heuristic; undershooting means the grid reserves an extra row,
 *  overshooting means the topmost right-column card overlaps the bottom
 *  of the thumb-index. Tuned for today's card variants. */
const CARD_ROW_STEP = 210;

/** Per-fiber column span persistence. A delta card defaults to one column
 *  of the auto-fill grid; the reader can drag the right edge to claim more
 *  tracks, and the choice survives reloads so a heavy fiber (long outcome,
 *  paper-shape body) stays wide when it comes back through the inbox.
 *  Keyed by fiber id, not by event, because the constitution's commit unit
 *  is the fiber — one temper or archive collapses every event from that
 *  fiber, and the footprint should follow the same grain. */
const SPAN_STORAGE_KEY = 'vellum:delta:colspan';
type SpanMap = Record<string, number>;
function readSpanMap(): SpanMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SPAN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function writeSpanMap(map: SpanMap) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SPAN_STORAGE_KEY, JSON.stringify(map));
  } catch { /* quota full or disabled — forget in memory */ }
}

/** Listen to the thumb-index's size so the delta grid can reserve a
 *  matching top-right cutout. The thumb-index lives outside the delta
 *  tree (FiberPage mounts it ambient), so we query it by class name. */
function useThumbIndexFootprint() {
  const [rect, setRect] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.thumb-index');
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect({ width: Math.round(r.width), height: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return rect;
}

export function DeltaView({ events, onDismissFiber, onRefresh }: DeltaViewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const thumb = useThumbIndexFootprint();

  // Column-span persistence. The grid owns the map so every card sees the
  // same state and a change to one card re-renders its siblings in-place
  // (grid auto-flow: row dense reshuffles them around the new footprint).
  const [spanMap, setSpanMap] = useState<SpanMap>(() => readSpanMap());
  function updateSpan(fiberId: string, span: number) {
    setSpanMap((prev) => {
      const next = { ...prev };
      if (span <= 1) delete next[fiberId];
      else next[fiberId] = span;
      writeSpanMap(next);
      return next;
    });
  }

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setGridWidth(Math.round(entry.contentRect.width));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The CSS grid uses repeat(auto-fill, minmax(CARD_MIN_WIDTH, 1fr)) —
  // compute the same column count here so the spacer lands in the
  // correct last-N cells.
  const totalCols = Math.max(1, Math.floor(gridWidth / (CARD_MIN_WIDTH + 12)));
  const spacerCols = Math.min(
    totalCols,
    Math.max(1, Math.ceil(thumb.width / (CARD_MIN_WIDTH + 12))),
  );
  const spacerRows = Math.max(1, Math.ceil(thumb.height / CARD_ROW_STEP));

  if (events.length === 0) {
    return (
      <div className="delta-view delta-view--empty">
        <p className="delta-view__empty-msg">Inbox clear — no recent changes.</p>
      </div>
    );
  }

  return (
    <div className="delta-view">
      <div className="delta-view__header">
        <span className="delta-view__summary">
          <span className="delta-view__count">{events.length}</span>{' '}
          event{events.length !== 1 ? 's' : ''} · newest first
        </span>
      </div>

      <div
        className="delta-view__grid"
        ref={gridRef}
        style={{ gridAutoFlow: 'row dense' } as React.CSSProperties}
      >
        {/* Reserved top-right cell — matches the thumb-index footprint
            so the grid forms an L around it instead of sliding cards
            under the fixed panel. Sized from ResizeObserver on the
            thumb-index root; on small viewports where the index is
            hidden entirely the rect is zero and the spacer collapses. */}
        {thumb.width > 0 && thumb.height > 0 && (
          <div
            className="delta-view__thumb-spacer"
            aria-hidden="true"
            style={{
              gridColumn: `${totalCols - spacerCols + 1} / span ${spacerCols}`,
              gridRow: `1 / span ${spacerRows}`,
            }}
          />
        )}
        {events.map((event) => (
          <DeltaCard
            key={`${event.fiberId}:${event.type}:${event.at}`}
            event={event}
            colSpan={Math.min(totalCols, Math.max(1, spanMap[event.fiberId] ?? 1))}
            totalCols={totalCols}
            onSpanChange={(span) => updateSpan(event.fiberId, span)}
            onDismissFiber={onDismissFiber}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}

const PIN_GLYPH = '⌖';

function DeltaCard({
  event,
  colSpan,
  totalCols,
  onSpanChange,
  onDismissFiber,
  onRefresh,
}: {
  event: LogEvent;
  colSpan: number;
  totalCols: number;
  onSpanChange: (span: number) => void;
  onDismissFiber: (fiberId: string) => void;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const { setMode } = useMode();
  const [pending, setPending] = useState<'temper' | 'archive' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Click the body (not title, not actions) to expand the card inline.
  // Expanding fetches the fiber's prose so Card renders the full body —
  // "more of the change in context" per the delta-inbox fiber. Re-click
  // collapses. Pin lifts the expanded card out of the grid as a floating
  // context card via the shared vellum:open-card event; the grid card
  // clears on pin so we don't have two copies of the same fiber in view.
  const [expanded, setExpanded] = useState(false);
  const [fiberContent, setFiberContent] = useState<FiberContent | null>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!expanded || fiberContent || fetching) return;
    setFetching(true);
    getFiberContent(event.fiberId)
      .then((c) => setFiberContent(c))
      .catch(() => { /* expansion without prose falls back to preview */ })
      .finally(() => setFetching(false));
  }, [expanded, fiberContent, fetching, event.fiberId]);

  // Pretext lockup inside Card needs a concrete pixel width to wrap into.
  // The grid cell is auto-fill minmax, so the width changes with viewport;
  // observe the wrapper and feed the measured width down.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(0);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        if (w > 0) setWidth(w);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function act(kind: 'temper' | 'archive') {
    setPending(kind);
    setError(null);
    try {
      await patchFiberFrontmatter(
        event.fiberId,
        kind === 'temper' ? { tempered: true } : { status: 'closed' },
      );
      onDismissFiber(event.fiberId);
      // Refresh so any temper/archive event that emerges from the write
      // surfaces for other fibers. The local dismissal hides this fiber
      // either way.
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
      setPending(null);
    }
  }

  function openInNarrative(e: React.MouseEvent) {
    e.stopPropagation();
    setMode('narrative');
    navigate(`/${event.fiberId}`);
  }

  function handlePin(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const node = eventToNode(event);
    document.dispatchEvent(new CustomEvent('vellum:open-card', {
      detail: {
        content: {
          type: 'fiber',
          node,
          // Pass prose through when it has been fetched, so the pinned
          // card shows the full body the reader just expanded.
          content: fiberContent ?? undefined,
        },
        x: rect.left,
        y: rect.top,
        width: Math.max(320, width),
      },
    }));
    // Lifting out means the grid card goes away — one copy in view.
    onDismissFiber(event.fiberId);
  }

  const eventGlyph = EVENT_GLYPH[event.type] ?? '·';
  const eventLabel = EVENT_LABEL[event.type] ?? event.type;

  // Drag the right edge to change how many auto-fill tracks this fiber
  // claims. The gesture is track-based, not pixel-based: we measure the
  // card's current track width from its rendered bounding box, then
  // translate pointer delta into a snapped column count. Capturing the
  // pointer on the handle keeps the gesture alive even when the card
  // reflows under the cursor as siblings rearrange around the new span.
  const cardRef = useRef<HTMLDivElement>(null);
  function onResizeHandleDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const card = cardRef.current;
    if (!card) return;
    const startX = e.clientX;
    const startSpan = colSpan;
    const trackWidth = card.getBoundingClientRect().width / Math.max(1, startSpan);
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let lastSpan = startSpan;
    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      const next = Math.min(
        totalCols,
        Math.max(1, startSpan + Math.round(dx / trackWidth)),
      );
      if (next !== lastSpan) {
        lastSpan = next;
        onSpanChange(next);
      }
    }
    function onUp() {
      handle.releasePointerCapture(e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  return (
    <div
      ref={cardRef}
      className={`delta-card${expanded ? ' delta-card--expanded' : ''}${colSpan > 1 ? ' delta-card--wide' : ''}`}
      data-event-type={event.type}
      style={colSpan > 1 ? { gridColumn: `span ${colSpan}` } : undefined}
    >
      <div className="delta-card__header">
        <button
          type="button"
          className="delta-card__title-link"
          onClick={openInNarrative}
          title="Open in Narrative"
        >
          <span className="delta-card__event-glyph">{eventGlyph}</span>
          <span className="delta-card__event-label">{eventLabel}</span>
        </button>
        <span className="delta-card__time">{formatTimeAgo(event.at)}</span>
        <button
          type="button"
          className="delta-card__pin"
          onClick={handlePin}
          aria-label="Pin as floating card"
          title="Pin as floating card"
        >
          {PIN_GLYPH}
        </button>
      </div>

      <div
        className="delta-card__body"
        ref={wrapperRef}
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {width > 0 && (
          <Card
            content={{
              type: 'fiber',
              node: eventToNode(event),
              content: expanded ? fiberContent ?? undefined : undefined,
            }}
            width={width}
          />
        )}
        {expanded && fetching && (
          <div className="delta-card__loading">Loading prose…</div>
        )}
      </div>

      {error && <div className="delta-card__error" role="alert">{error}</div>}

      <div
        className="delta-card__actions"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="delta-card__action"
          onClick={() => void act('temper')}
          disabled={pending !== null}
          title="Mark the fiber tempered — solid enough to build on"
        >
          {pending === 'temper' ? '…' : '⬡'} temper
        </button>
        <button
          type="button"
          className="delta-card__action delta-card__action--archive"
          onClick={() => void act('archive')}
          disabled={pending !== null}
          title="Close the fiber"
        >
          {pending === 'archive' ? '…' : '●'} archive
        </button>
      </div>

      {/* Right-edge drag handle. Absolute-positioned strip that spans the
          card's full height; dragging it rightward claims another grid
          track, leftward releases one. The handle stops click propagation
          so grabbing it does not toggle expansion. */}
      <div
        className="delta-card__resize"
        onPointerDown={onResizeHandleDown}
        onClick={(e) => e.stopPropagation()}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize card width"
        title="Drag to resize"
      />
    </div>
  );
}
