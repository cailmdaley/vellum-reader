/**
 * HistoryCard — editorial + mechanical event chain for a fiber, rendered
 * as a margin Card in Narrative mode.
 *
 * The card surfaces the per-fiber `felt history` event chain so the trail
 * of agent-written summaries (editorial) and byte-level mutations
 * (mechanical) is legible right next to the fiber body. It's a margin
 * denizen — width set by the canvas column, not by the card itself — and
 * read-only: `felt history append` stays in the CLI.
 *
 * Visual register:
 * - The card wears the same Weathered Substrate chrome as the unified Card
 *   primitive (border, palette, EB Garamond), with a komejirushi (`※`,
 *   U+203B) glyph in the chrome — the Japanese editorial-note marker.
 * - Editorial events render in full Garamond prose with author + relative
 *   timestamp. They're the default (prominent) view.
 * - Mechanical events (external_edit / edit / add / rm) render as compact
 *   metadata rows — dimmer, smaller, kind-badged — and are hidden behind
 *   a toggle. Default: off. Toggling reveals them inline, interleaved with
 *   editorial events in chronological order.
 * - A small kind glyph prepends each event's meta row so the reader knows
 *   the event class at a glance.
 * - Size deltas ("+3 lines") are computed client-side from consecutive
 *   mechanical events in chronological order — more informative than the
 *   raw absolute size.
 *
 * Bounded height with internal scroll keeps the card from dominating the
 * margin on shuttle-heavy fibers; the masthead `※n` indicator anchor
 * brings it back into view when scrolled past.
 *
 * Lazy-load: the events list caps at INITIAL_VISIBLE (20) rendered items.
 * A "load older" strip below the list reveals more in pages of 20. This
 * keeps the DOM small for fibers with 100+ history events.
 *
 * Keyboard: roving tabindex on the events list. Arrow keys move between
 * events; Home/End jump to first/last. Tab enters the list at the active
 * item; Shift+Tab leaves it. The toggle footer button is in the normal
 * tab order.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArticleProvider, ThemeProvider, useNodeRenderers } from '@myst-theme/providers';
import { DEFAULT_RENDERERS, MyST } from 'myst-to-react';
import { assignMdastKeys } from '~/utils/mdast-keys';
import type { HistoryEvent } from '~/utils/content-types';

// myst-frontmatter's `Citations` interface requires `order` and `data`,
// not the bare `{}` that older surfaces tolerated. Build a single empty
// references object once so every event renders against the same shape;
// HistoryCard never carries citations of its own (the editorial summary
// is plain prose, no DOI bibliography).
const EMPTY_REFERENCES = {
  cite: { order: [], data: {} },
  footnotes: {},
};

// Anchor id for the masthead `※n` indicator's deep link. Single-element
// page so the simple id is fine; if the constitution ever sprouts more
// than one HistoryCard mount we'll thread it through props.
export const HISTORY_CARD_ANCHOR_ID = 'history-card';

// Lazy-load page size — initial render cap and increment on "load older".
const INITIAL_VISIBLE = 20;

interface HistoryCardProps {
  events: HistoryEvent[];
  /** Card width in px — driven by `--canvas-width` via the margin column. */
  width: number;
  /** Called when a wikilink inside an editorial summary is clicked. */
  onNavigate?: (slug: string) => void;
}

/**
 * Wrap MyST rendering with theme providers if none is in scope. Same
 * pattern as FiberCard's FiberProseRoot — without it, `useNodeRenderers`
 * returns `{}` and myst-to-react falls through to its DefaultComponent
 * (div/span), which loses link/wikilink/emphasis semantics.
 */
function HistoryProseRoot({ mdast }: { mdast: any }) {
  const existing = useNodeRenderers();
  const body = (
    <ArticleProvider
      kind={'Article' as any}
      references={EMPTY_REFERENCES}
      frontmatter={{}}
    >
      <MyST ast={mdast} />
    </ArticleProvider>
  );
  if (existing && Object.keys(existing).length > 0) return body;
  return (
    <ThemeProvider theme={null} setTheme={() => {}} renderers={DEFAULT_RENDERERS}>
      {body}
    </ThemeProvider>
  );
}

/**
 * Coarse relative-time formatter — "just now", "2 hours ago", "3 days
 * ago", falling back to a short ISO date for anything older than a year.
 *
 * Native `Intl.RelativeTimeFormat` produces fine output ("2 days ago"),
 * but it doesn't pick the unit for you. We pick the largest unit whose
 * value is non-zero so a 5-day gap reads as "5 days ago," not "120 hours
 * ago." Future timestamps clamp to "just now" — felt's `occurred_at` is
 * server-stamped at append time, so a future timestamp is a clock-skew
 * artifact rather than a real signal.
 */
function relativeTime(occurredAt: string): string {
  const occurred = Date.parse(occurredAt);
  if (!Number.isFinite(occurred)) return occurredAt;
  const now = Date.now();
  const seconds = (occurred - now) / 1000;
  const abs = Math.abs(seconds);

  if (abs < 30) return 'just now';

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [unit, secondsPerUnit] of units) {
    if (abs >= secondsPerUnit) {
      const value = Math.round(seconds / secondsPerUnit);
      // Anything older than a year falls back to a short date so the
      // reader gets a real anchor instead of a vague "2 years ago".
      if (unit === 'year' && Math.abs(value) >= 1) {
        try {
          return new Date(occurred).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
        } catch {
          return occurredAt;
        }
      }
      return rtf.format(value, unit);
    }
  }
  return 'just now';
}

/**
 * Trim the actor identity — `cd280747@dapmcw68` is verbose for the
 * margin column. Cut the host suffix; humans read by user, hosts are
 * carried for telemetry. Leaves `external` and other unhosted actor
 * strings untouched.
 */
function shortActor(actor: string): string {
  const at = actor.indexOf('@');
  return at > 0 ? actor.slice(0, at) : actor;
}

/**
 * Visual vocabulary per event kind.
 *
 * `glyph` is rendered in IBM Plex Mono before the actor line so a reader
 * can parse the kind at a glance without reading the label. `label` is the
 * accessible text fallback used for the title attribute and aria-label.
 * `cssClass` is the BEM modifier applied to the event `<li>` so CSS can
 * assign color / opacity without JavaScript.
 */
function kindMeta(kind: HistoryEvent['kind']): {
  glyph: string;
  label: string;
  cssClass: string;
} {
  switch (kind) {
    case 'editorial':
    case undefined:
      return { glyph: '※', label: 'editorial', cssClass: 'history-card__event--editorial' };
    case 'external_edit':
      return { glyph: '~', label: 'file changed', cssClass: 'history-card__event--external-edit' };
    case 'edit':
      return { glyph: '∂', label: 'edited', cssClass: 'history-card__event--edit' };
    case 'add':
      return { glyph: '+', label: 'added', cssClass: 'history-card__event--add' };
    case 'rm':
      return { glyph: '−', label: 'removed', cssClass: 'history-card__event--rm' };
    default:
      return { glyph: '·', label: kind as string, cssClass: 'history-card__event--mechanical' };
  }
}

/**
 * Compact one-line description for mechanical events. For `edit` events,
 * show the changed fields. For size-bearing events, show the delta ("+3
 * lines", "−12 lines") when available, falling back to the absolute size.
 * Delta is computed from consecutive mechanical events; see
 * `mechanicalDeltaMap` in HistoryCard.
 */
function mechanicalBody(
  ev: HistoryEvent,
  delta: { lines?: number; chars?: number } | undefined,
): string {
  if (ev.kind === 'edit' && ev.fieldsChanged?.length) {
    return ev.fieldsChanged.join(', ');
  }
  const parts: string[] = [];
  if (delta?.lines !== undefined) {
    const sign = delta.lines >= 0 ? '+' : '';
    parts.push(`${sign}${delta.lines} lines`);
  } else if (ev.sizeLines != null) {
    parts.push(`${ev.sizeLines} lines`);
  }
  if (parts.length === 0) {
    if (delta?.chars !== undefined) {
      const sign = delta.chars >= 0 ? '+' : '';
      parts.push(`${sign}${delta.chars} chars`);
    } else if (ev.sizeChars != null) {
      parts.push(`${ev.sizeChars} chars`);
    }
  }
  return parts.join(', ');
}

export function HistoryCard({ events, width, onNavigate }: HistoryCardProps) {
  const proseRef = useRef<HTMLOListElement>(null);
  const [showMechanical, setShowMechanical] = useState(false);

  // Stage 7: lazy-load — cap initial render at INITIAL_VISIBLE events.
  // "Load older" reveals 20 more per click. Reset when events array changes
  // (slug navigation) so the card always starts fresh on a new fiber.
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
    setFocusedEventIdx(0);
  }, [events]);

  // Stage 8: roving tabindex — one event in the list is the active tab
  // stop at a time. Arrow keys shift the active item; focus follows.
  const [focusedEventIdx, setFocusedEventIdx] = useState(0);
  const eventRefs = useRef<Array<HTMLLIElement | null>>([]);

  const editorialEvents = useMemo(
    () => events.filter((ev) => (ev.kind ?? 'editorial') === 'editorial'),
    [events],
  );
  const mechanicalEvents = useMemo(
    () => events.filter((ev) => ev.kind !== undefined && ev.kind !== 'editorial'),
    [events],
  );

  // When showMechanical is on, show all events interleaved. Otherwise editorial only.
  const visibleEvents = useMemo(
    () => (showMechanical ? events : editorialEvents),
    [showMechanical, events, editorialEvents],
  );

  // Stage 6 (partial): compute size deltas between consecutive mechanical
  // events in chronological order so the HistoryCard can display "+3 lines"
  // instead of the raw absolute size. True byte-level diffs (for
  // external_edit events) require felt to store per-version content
  // snapshots, which it does not yet do; that extension is deferred.
  const mechanicalDeltaMap = useMemo(() => {
    const map = new Map<string, { lines?: number; chars?: number }>();
    // Sort all mechanical events ascending (oldest first) to compute deltas.
    const chron = events
      .filter((ev) => ev.kind !== undefined && ev.kind !== 'editorial')
      .slice()
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    let prevLines: number | undefined;
    let prevChars: number | undefined;
    for (const ev of chron) {
      const delta: { lines?: number; chars?: number } = {};
      if (ev.sizeLines !== undefined && prevLines !== undefined) {
        delta.lines = ev.sizeLines - prevLines;
      }
      if (ev.sizeChars !== undefined && prevChars !== undefined) {
        delta.chars = ev.sizeChars - prevChars;
      }
      if (Object.keys(delta).length) {
        map.set(ev.occurredAt, delta);
      }
      if (ev.sizeLines !== undefined) prevLines = ev.sizeLines;
      if (ev.sizeChars !== undefined) prevChars = ev.sizeChars;
    }
    return map;
  }, [events]);

  // Stable mdast keys for myst-to-react, scoped per event so no two
  // events collide. Memoized because the events array is otherwise
  // re-allocated by the fetch effect on every refresh tick.
  const eventsWithKeys = useMemo(
    () =>
      visibleEvents.map((ev, i) =>
        ev.summaryAst
          ? { ...ev, summaryAst: assignMdastKeys({ ...ev.summaryAst }, `history-${i}`) }
          : ev,
      ),
    [visibleEvents],
  );

  // Stage 7: slice to visibleCount for lazy rendering.
  const slicedEvents = useMemo(
    () => eventsWithKeys.slice(0, visibleCount),
    [eventsWithKeys, visibleCount],
  );
  const hasMore = eventsWithKeys.length > visibleCount;

  // Stage 8: clamp focused index when the event list shrinks (e.g. when
  // the mechanical toggle is turned off, reducing the list length).
  useEffect(() => {
    setFocusedEventIdx((idx) => Math.min(idx, Math.max(0, slicedEvents.length - 1)));
  }, [slicedEvents.length]);

  // Wikilink delegation — same path FiberCard uses. Native click
  // listener (not an onClick prop) so React's accessibility-tree
  // `onclick=noop` instrumentation doesn't surface the prose container
  // as a generic clickable.
  useEffect(() => {
    const node = proseRef.current;
    if (!node || !onNavigate) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      // Internal slug refs are MyST link nodes with `url: "/<slug>"`;
      // wikilink transformer (mystra) emits the same shape.
      if (href.startsWith('/')) {
        e.preventDefault();
        onNavigate(href.slice(1));
      }
    };
    node.addEventListener('click', handler);
    return () => node.removeEventListener('click', handler);
  }, [onNavigate]);

  if (editorialEvents.length === 0) return null;

  return (
    <section
      id={HISTORY_CARD_ANCHOR_ID}
      role="region"
      aria-label={`Editorial history — ${editorialEvents.length} ${editorialEvents.length === 1 ? 'event' : 'events'}`}
      className="card card--history history-card"
      style={{ width: `${width}px` }}
    >
      <header className="history-card__chrome">
        <span className="history-card__glyph" aria-hidden="true">
          ※
        </span>
        <h3 className="history-card__title">History</h3>
        <span className="history-card__count" aria-hidden="true">
          {editorialEvents.length}
        </span>
      </header>
      <ol
        className="history-card__events"
        ref={proseRef}
        aria-label="History events"
        onKeyDown={(e) => {
          const len = slicedEvents.length;
          if (!len) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = Math.min(focusedEventIdx + 1, len - 1);
            setFocusedEventIdx(next);
            eventRefs.current[next]?.focus();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = Math.max(focusedEventIdx - 1, 0);
            setFocusedEventIdx(prev);
            eventRefs.current[prev]?.focus();
          } else if (e.key === 'Home') {
            e.preventDefault();
            setFocusedEventIdx(0);
            eventRefs.current[0]?.focus();
          } else if (e.key === 'End') {
            e.preventDefault();
            const last = len - 1;
            setFocusedEventIdx(last);
            eventRefs.current[last]?.focus();
          }
        }}
      >
        {slicedEvents.map((ev, i) => {
          const { glyph, label, cssClass } = kindMeta(ev.kind);
          const isMechanical = ev.kind !== undefined && ev.kind !== 'editorial';
          const delta = isMechanical ? mechanicalDeltaMap.get(ev.occurredAt) : undefined;
          return (
            <li
              key={`${ev.occurredAt}-${i}`}
              className={`history-card__event ${cssClass}`}
              tabIndex={focusedEventIdx === i ? 0 : -1}
              ref={(el) => {
                eventRefs.current[i] = el;
              }}
              onFocus={() => setFocusedEventIdx(i)}
            >
              <div className="history-card__event-meta">
                <span
                  className="history-card__event-kind-glyph"
                  aria-hidden="true"
                  title={label}
                >
                  {glyph}
                </span>
                <span className="history-card__event-actor" title={ev.actor}>
                  {shortActor(ev.actor)}
                </span>
                <span
                  className="history-card__event-sep"
                  aria-hidden="true"
                >
                  ·
                </span>
                <time
                  className="history-card__event-time"
                  dateTime={ev.occurredAt}
                  title={ev.occurredAt}
                >
                  {relativeTime(ev.occurredAt)}
                </time>
              </div>
              {isMechanical ? (
                <div className="history-card__event-mechanical-body">
                  {mechanicalBody(ev, delta)}
                </div>
              ) : (
                <div className="history-card__event-summary">
                  {ev.summaryAst ? (
                    <HistoryProseRoot mdast={ev.summaryAst} />
                  ) : (
                    <p>{ev.summary}</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {hasMore && (
        <div className="history-card__load-more" aria-live="polite">
          <button
            type="button"
            className="history-card__load-more-btn"
            onClick={() => setVisibleCount((n) => n + INITIAL_VISIBLE)}
            aria-label={`Load ${Math.min(INITIAL_VISIBLE, eventsWithKeys.length - visibleCount)} older events`}
          >
            ↑ {Math.min(INITIAL_VISIBLE, eventsWithKeys.length - visibleCount)} older
          </button>
          <span className="history-card__load-more-count" aria-hidden="true">
            {visibleCount} / {eventsWithKeys.length}
          </span>
        </div>
      )}
      {mechanicalEvents.length > 0 && (
        <footer className="history-card__mechanical-footer">
          <button
            type="button"
            className={`history-card__mechanical-toggle${showMechanical ? ' history-card__mechanical-toggle--active' : ''}`}
            onClick={() => setShowMechanical((v) => !v)}
            aria-pressed={showMechanical}
            aria-label={showMechanical ? 'Hide file changes' : `Show ${mechanicalEvents.length} file change${mechanicalEvents.length === 1 ? '' : 's'}`}
          >
            {showMechanical
              ? 'hide file changes'
              : `+ ${mechanicalEvents.length} file change${mechanicalEvents.length === 1 ? '' : 's'}`}
          </button>
        </footer>
      )}
    </section>
  );
}
