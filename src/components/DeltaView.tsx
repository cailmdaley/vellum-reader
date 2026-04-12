import { useNavigate } from 'react-router-dom';
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

interface DeltaViewProps {
  events: LogEvent[];
  since: string | null;
  onAcknowledge: () => void;
}

export function DeltaView({ events, since, onAcknowledge }: DeltaViewProps) {
  const navigate = useNavigate();
  const { setMode } = useMode();
  const changedFibers = (() => {
    const seen = new Map<string, LogEvent>();
    for (const event of events) {
      if (!seen.has(event.fiberId)) seen.set(event.fiberId, event);
    }
    return Array.from(seen.values());
  })();

  if (changedFibers.length === 0) {
    return (
      <div className="delta-view delta-view--empty">
        <p className="delta-view__empty-msg">No changes since last visit.</p>
      </div>
    );
  }

  const timeAgo = since ? formatTimeAgo(since) : '';

  return (
    <div className="delta-view">
      <div className="delta-view__header">
        <span className="delta-view__summary">
          <span className="delta-view__count">{changedFibers.length}</span>
          {' '}fiber{changedFibers.length !== 1 ? 's' : ''} changed
          {timeAgo && <span className="delta-view__since"> · {timeAgo}</span>}
        </span>
        <button className="delta-view__mark-read" onClick={onAcknowledge} title="Mark all as read">
          mark read
        </button>
      </div>

      <div className="delta-view__list">
        {changedFibers.map((event) => (
          <button
            key={event.fiberId}
            className="delta-view__item"
            onClick={() => {
              setMode('narrative');
              navigate(`/${event.fiberId}`);
            }}
          >
            <span className="delta-view__item-glyph">{statusGlyph(event.status)}</span>
            <span className="delta-view__item-body">
              <span className="delta-view__item-title">{event.title || event.fiberId}</span>
              <span className="delta-view__item-meta">{event.fiberId}</span>
            </span>
            <span className="delta-view__item-type">{event.type}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
