/**
 * DeltaBanner — "what changed since your last visit"
 *
 * A subtle strip below the sticky header. Gold left border like a lede
 * blockquote, but thinner. Shows change count with breakdown by type.
 * Dismiss updates the last-visit timestamp.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import type { LogEvent } from '~/utils/content-server';

interface DeltaBannerProps {
  events: LogEvent[];
  since: string;
  onDismiss: () => void;
}

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} weeks ago`;
}

const STATUS_GLYPHS: Record<string, string> = {
  open: '○', active: '◐', closed: '●', suspended: '·',
  resolved: '●', suspicious: '◈', blocked: '✕',
};

export function DeltaBanner({ events, since, onDismiss }: DeltaBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  // Summarize by event type, deduplicating by fiber
  const summary = useMemo(() => {
    const byType = new Map<string, Set<string>>();
    for (const ev of events) {
      const set = byType.get(ev.type) ?? new Set();
      set.add(ev.fiberId);
      byType.set(ev.type, set);
    }
    return byType;
  }, [events]);

  // Unique fibers that changed, most recent event per fiber
  const changedFibers = useMemo(() => {
    const seen = new Map<string, LogEvent>();
    for (const ev of events) {
      if (!seen.has(ev.fiberId)) seen.set(ev.fiberId, ev);
    }
    return Array.from(seen.values());
  }, [events]);

  const uniqueCount = changedFibers.length;
  const timeAgo = formatTimeAgo(since);

  // Build the summary chips: "3 closed, 2 created, 1 updated"
  const chips: string[] = [];
  for (const [type, ids] of summary) {
    chips.push(`${ids.size} ${type}`);
  }

  return (
    <div className="delta-banner">
      <div className="delta-banner__summary">
        <span className="delta-banner__count">
          {uniqueCount} fiber{uniqueCount !== 1 ? 's' : ''} changed
        </span>
        <span className="delta-banner__since">{timeAgo}</span>
        <span className="delta-banner__sep">·</span>
        <span className="delta-banner__chips">{chips.join(', ')}</span>
        <button
          className="delta-banner__toggle"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? 'Collapse changes' : 'Expand changes'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button
          className="delta-banner__dismiss"
          onClick={onDismiss}
          aria-label="Mark as read"
          title="Mark as read"
        >
          ✓
        </button>
      </div>

      {expanded && (
        <div className="delta-banner__list">
          {changedFibers.map((ev) => (
            <a
              key={ev.fiberId}
              className="delta-banner__item"
              href={`/${ev.fiberId}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/${ev.fiberId}`);
              }}
            >
              <span className="delta-banner__item-glyph">
                {STATUS_GLYPHS[ev.status] ?? '○'}
              </span>
              <span className="delta-banner__item-title">{ev.title}</span>
              <span className="delta-banner__item-type">{ev.type}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
