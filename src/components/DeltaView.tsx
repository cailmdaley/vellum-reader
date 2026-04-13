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
import { patchFiberFrontmatter } from '~/api';
import { Card } from './Card';
import { useMode } from '~/contexts/ModeContext';
import type { GraphNode, LogEvent } from '~/utils/content-types';

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

export function DeltaView({ events, onDismissFiber, onRefresh }: DeltaViewProps) {
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

      <div className="delta-view__grid">
        {events.map((event) => (
          <DeltaCard
            key={`${event.fiberId}:${event.type}:${event.at}`}
            event={event}
            onDismissFiber={onDismissFiber}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}

function DeltaCard({
  event,
  onDismissFiber,
  onRefresh,
}: {
  event: LogEvent;
  onDismissFiber: (fiberId: string) => void;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const { setMode } = useMode();
  const [pending, setPending] = useState<'temper' | 'archive' | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  function openInNarrative() {
    setMode('narrative');
    navigate(`/${event.fiberId}`);
  }

  const eventGlyph = EVENT_GLYPH[event.type] ?? '·';
  const eventLabel = EVENT_LABEL[event.type] ?? event.type;

  return (
    <div className="delta-card" data-event-type={event.type}>
      <div className="delta-card__header">
        <span className="delta-card__event">
          <span className="delta-card__event-glyph">{eventGlyph}</span>
          <span className="delta-card__event-label">{eventLabel}</span>
        </span>
        <span className="delta-card__time">{formatTimeAgo(event.at)}</span>
      </div>

      <div
        className="delta-card__body"
        ref={wrapperRef}
        role="button"
        tabIndex={0}
        onClick={openInNarrative}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openInNarrative();
          }
        }}
        title="Open in Narrative"
      >
        {width > 0 && (
          <Card
            content={{ type: 'fiber', node: eventToNode(event) }}
            width={width}
          />
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
    </div>
  );
}
