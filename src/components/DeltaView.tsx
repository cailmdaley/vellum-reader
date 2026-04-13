/**
 * Delta inbox — every recent change to a fiber is one card.
 *
 * Cards are newest-first. Each carries two actions: Temper sets
 * `tempered: true` on the underlying fiber; Archive sets `status: closed`.
 * Both write directly to disk via PATCH /content/<slug>.md. After an
 * action lands, every other card from the same fiber is dismissed
 * locally — one commit per fiber, not per event.
 *
 * Today the log emits `created`, `active`, and `closed` events. Richer
 * event types (body edits, insight additions, decision flips) will land
 * when the log route learns to diff fiber history.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { patchFiberFrontmatter } from '~/api';
import { useMode } from '~/contexts/ModeContext';
import type { LogEvent } from '~/utils/content-types';
import { statusGlyph } from '~/utils/fiber-status';

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

  async function act(kind: 'temper' | 'archive') {
    setPending(kind);
    setError(null);
    try {
      await patchFiberFrontmatter(event.fiberId, kind === 'temper' ? { tempered: true } : { status: 'closed' });
      onDismissFiber(event.fiberId);
      // Refresh so the temper/archive event itself surfaces for other fibers
      // too — the local dismissal will hide this fiber either way.
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
      setPending(null);
    }
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

      <button
        type="button"
        className="delta-card__title-btn"
        onClick={() => {
          setMode('narrative');
          navigate(`/${event.fiberId}`);
        }}
        title="Open in Narrative"
      >
        <span className="delta-card__status" aria-hidden="true">
          {statusGlyph(event.status)}
        </span>
        <span className="delta-card__title">{event.title || event.fiberId}</span>
      </button>

      {event.outcome && <p className="delta-card__outcome">{event.outcome}</p>}

      <div className="delta-card__meta">
        <span className="delta-card__fiberid">{event.fiberId}</span>
        {event.tags.length > 0 && (
          <span className="delta-card__tags">
            {event.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="delta-card__tag">{tag}</span>
            ))}
          </span>
        )}
      </div>

      {error && <div className="delta-card__error" role="alert">{error}</div>}

      <div className="delta-card__actions">
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
