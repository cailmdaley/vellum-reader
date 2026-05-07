/**
 * HistoryCard — narrated activity log for a fiber, rendered as a flow
 * card in the right margin column in Narrative mode.
 *
 * Shape: editorial events are the **spine** — authored prose summaries that
 * agents and humans write at session boundaries via `felt history append`.
 * Mechanical events (external_edit / edit / add / rm) fold into **cluster
 * badges** attached below the editorial event they forward-look from:
 * "then N saves, +M lines, K actors." Mechanical activity that postdates
 * the most-recent editorial event surfaces as the **dangling tail** — an
 * action-signal row above the latest editorial event: "⚠ dangling: N saves
 * since last narrated · last edit Xh ago." For agents on dispatch, the
 * dangling tail is a structural cue: summarize what you find before adding
 * to it.
 *
 * **Never-narrated state.** Most fibers in a fresh kanban have only
 * mechanical activity (saves from edits, the bootstrap `add`) and no
 * editorial events yet. The card renders for these too: the dangling tail
 * carries a "⌀ no narration yet · N saves · last edit Xh ago" phrase so
 * the surface is honest about the gap *and* surfaces the agent-on-dispatch
 * cue exactly when it's most useful (a fiber that wants narrating).
 *
 * **Unavailable state.** The portolan `/fiber-history/<slug>` endpoint
 * may return `status: 'unavailable'` (felt index busy, felt missing,
 * etc). The card surfaces that explicitly with a retry-friendly phrase
 * instead of silently dropping out.
 *
 * Visual register:
 * - The card wears the same Weathered Substrate chrome as the unified Card
 *   primitive (border, palette, EB Garamond), with a komejirushi (`※`,
 *   U+203B) glyph in the chrome — the Japanese editorial-note marker.
 * - Editorial events render in full Garamond prose with author + relative
 *   timestamp.
 * - Each editorial event may carry a cluster badge below its summary —
 *   dimmer IBM Plex Mono metadata encoding what happened in the gap before
 *   the next (more recent) editorial event.
 * - The dangling tail row uses an amber accent so it reads as a warning
 *   signal without dominating the editorial prose.
 *
 * Lazy-load: the editorial spine caps at INITIAL_VISIBLE (20) items. A
 * "↑ N older" strip reveals more in pages of 20. Mechanical events are
 * cluster-folded client-side; the DOM never holds individual mech events.
 *
 * Keyboard: roving tabindex on the events list. Arrow keys move between
 * all focusable rows (dangling tail + editorial events); Home/End jump to
 * first/last. Tab enters the list at the active item; Shift+Tab leaves it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArticleProvider, ThemeProvider, useNodeRenderers } from '@myst-theme/providers';
import { DEFAULT_RENDERERS, MyST } from 'myst-to-react';
import { assignMdastKeys } from '~/utils/mdast-keys';
import type { HistoryEvent } from '~/utils/content-types';
import {
  clusterPhrase,
  computeClusterGroups,
  danglingPhrase,
} from '~/utils/history-clusters';

// myst-frontmatter's `Citations` interface requires `order` and `data`,
// not the bare `{}` that older surfaces tolerated. Build a single empty
// references object once so every event renders against the same shape;
// HistoryCard never carries citations of its own (the editorial summary
// is plain prose, no DOI bibliography).
const EMPTY_REFERENCES = {
  cite: { order: [], data: {} },
  footnotes: {},
};

// DOM id used by FiberHeader's ※n indicator to scrollIntoView the card.
// Not an `<a href="#…">` target — the ※n indicator scrolls
// programmatically because hash-based anchors break portolan's URL
// state machine (the hashchange handler can't parse `#history-card` as a
// valid mode/cityId/fiber and falls back to the map).
export const HISTORY_CARD_ANCHOR_ID = 'history-card';

// Lazy-load page size — initial render cap and increment on "load older."
const INITIAL_VISIBLE = 20;

interface HistoryCardProps {
  events: HistoryEvent[];
  /**
   * Endpoint status: 'ok' = events list is canonical (may be empty);
   * 'unavailable' = endpoint failed (felt busy or other), with `reason`
   * carrying the discriminator. Default 'ok' for legacy callers.
   */
  status?: 'ok' | 'unavailable';
  /** Failure mode when status === 'unavailable'. */
  reason?: 'busy' | 'error';
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

export function HistoryCard({
  events,
  status = 'ok',
  reason,
  width,
  onNavigate,
}: HistoryCardProps) {
  const proseRef = useRef<HTMLOListElement>(null);

  // Lazy-load — cap initial render at INITIAL_VISIBLE editorial events.
  // "Load older" reveals 20 more per click. Reset when events array
  // changes (slug navigation) so the card always starts fresh.
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
    setFocusedIdx(0);
  }, [events]);

  // Roving tabindex — one focusable row is the active tab stop at a
  // time. Arrow keys shift the active item; focus follows. The index
  // space covers: dangling tail row (slot 0 when present) + editorial
  // events (slots 0..n-1 or 1..n when dangling tail is shown).
  const [focusedIdx, setFocusedIdx] = useState(0);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);

  // ── Data layer ──────────────────────────────────────────────────────

  const editorialEvents = useMemo(
    () => events.filter((ev) => (ev.kind ?? 'editorial') === 'editorial'),
    [events],
  );

  // Cluster computation: per-gap cluster badges + dangling tail. The
  // `neverNarrated` flag drives the dangling-tail phrasing: "no narration
  // yet" vs "since last narrated."
  const { clusterMap, danglingTail, neverNarrated } = useMemo(
    () => computeClusterGroups(events),
    [events],
  );

  // Stable mdast keys for myst-to-react, scoped per event.
  const eventsWithKeys = useMemo(
    () =>
      editorialEvents.map((ev, i) =>
        ev.summaryAst
          ? { ...ev, summaryAst: assignMdastKeys({ ...ev.summaryAst }, `history-${i}`) }
          : ev,
      ),
    [editorialEvents],
  );

  // Lazy-load: slice to visibleCount.
  const slicedEvents = useMemo(
    () => eventsWithKeys.slice(0, visibleCount),
    [eventsWithKeys, visibleCount],
  );
  const hasMore = eventsWithKeys.length > visibleCount;

  // ── Focusable slot accounting ───────────────────────────────────────
  // Slot 0 = dangling tail row (if present), else first editorial event.
  // Slots [danglingOffset .. danglingOffset + slicedEvents.length - 1] = editorial events.
  const danglingOffset = danglingTail ? 1 : 0;
  const totalFocusable = danglingOffset + slicedEvents.length;

  // Clamp focus index when the list shrinks (e.g. slug navigation or
  // lazy-load count reset).
  useEffect(() => {
    setFocusedIdx((idx) => Math.min(idx, Math.max(0, totalFocusable - 1)));
  }, [totalFocusable]);

  // ── Wikilink delegation ─────────────────────────────────────────────
  useEffect(() => {
    const node = proseRef.current;
    if (!node || !onNavigate) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      if (href.startsWith('/')) {
        e.preventDefault();
        onNavigate(href.slice(1));
      }
    };
    node.addEventListener('click', handler);
    return () => node.removeEventListener('click', handler);
  }, [onNavigate]);

  // Three render branches: unavailable (endpoint failed) → status row,
  // truly empty (no events at all, e.g. fresh fiber pre-bootstrap) →
  // null, otherwise → narrated activity log.
  if (status === 'unavailable') {
    return (
      <section
        id={HISTORY_CARD_ANCHOR_ID}
        role="region"
        aria-label="History unavailable"
        className="card card--history margin-card history-card history-card--unavailable"
        style={{ width: `${width}px` }}
      >
        <header className="history-card__chrome">
          <span className="history-card__glyph" aria-hidden="true">※</span>
          <h3 className="history-card__title">History</h3>
        </header>
        <p className="history-card__status-message">
          {reason === 'busy'
            ? 'felt index busy — history unavailable. Retry shortly.'
            : 'History unavailable.'}
        </p>
      </section>
    );
  }

  // Truly empty: no events of any kind. felt always emits at least an
  // `add` event when a fiber enters the index, so this branch fires only
  // for fibers that haven't been touched by felt yet (e.g. manually
  // created files, or a fresh install before the first `felt sync`).
  // Render a minimal "no history" state rather than null — the card
  // should be consistently present so the reader knows the surface exists
  // and what its count of 0 means.
  if (events.length === 0) {
    return (
      <section
        id={HISTORY_CARD_ANCHOR_ID}
        role="region"
        aria-label="History — no events"
        className="card card--history margin-card history-card history-card--empty"
        style={{ width: `${width}px` }}
      >
        <header className="history-card__chrome">
          <span className="history-card__glyph" aria-hidden="true">※</span>
          <h3 className="history-card__title">History</h3>
          <span className="history-card__count" aria-hidden="true">0</span>
        </header>
        <p className="history-card__status-message history-card__status-message--empty">
          ⌀ not yet indexed
        </p>
      </section>
    );
  }

  // Header count label: editorial count is the salient signal (≈ how
  // many narrated handoffs); when there are none, the dangling tail's
  // save count carries the "weight" of the fiber's activity instead.
  const countLabel = editorialEvents.length > 0
    ? String(editorialEvents.length)
    : danglingTail
      ? `0 / ${danglingTail.count}`
      : '0';

  return (
    <section
      id={HISTORY_CARD_ANCHOR_ID}
      role="region"
      aria-label={
        editorialEvents.length > 0
          ? `History — ${editorialEvents.length} editorial ${editorialEvents.length === 1 ? 'event' : 'events'}`
          : `History — never narrated, ${danglingTail?.count ?? 0} ${danglingTail?.count === 1 ? 'save' : 'saves'}`
      }
      className={`card card--history margin-card history-card${neverNarrated ? ' history-card--never-narrated' : ''}`}
      style={{ width: `${width}px` }}
    >
      <header className="history-card__chrome">
        <span className="history-card__glyph" aria-hidden="true">
          ※
        </span>
        <h3 className="history-card__title">History</h3>
        <span className="history-card__count" aria-hidden="true">
          {countLabel}
        </span>
      </header>

      <ol
        className="history-card__events"
        ref={proseRef}
        aria-label="History events"
        onKeyDown={(e) => {
          if (!totalFocusable) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = Math.min(focusedIdx + 1, totalFocusable - 1);
            setFocusedIdx(next);
            rowRefs.current[next]?.focus();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = Math.max(focusedIdx - 1, 0);
            setFocusedIdx(prev);
            rowRefs.current[prev]?.focus();
          } else if (e.key === 'Home') {
            e.preventDefault();
            setFocusedIdx(0);
            rowRefs.current[0]?.focus();
          } else if (e.key === 'End') {
            e.preventDefault();
            const last = totalFocusable - 1;
            setFocusedIdx(last);
            rowRefs.current[last]?.focus();
          }
        }}
      >
        {/* Dangling tail — unsummarized mechanical activity since the last
            editorial event (or all activity, if no editorial event has
            ever been recorded). Rendered above the latest editorial event
            (or alone when never narrated). Amber accent signals action:
            "summarize what you find before adding to it." */}
        {danglingTail && (
          <li
            className={`history-card__event history-card__event--dangling-tail${neverNarrated ? ' history-card__event--never-narrated' : ''}`}
            tabIndex={focusedIdx === 0 ? 0 : -1}
            ref={(el) => {
              rowRefs.current[0] = el;
            }}
            onFocus={() => setFocusedIdx(0)}
          >
            <div className="history-card__dangling-tail-body">
              {danglingPhrase(danglingTail, relativeTime, neverNarrated)}
            </div>
          </li>
        )}

        {/* Editorial spine — newest first. Each event may carry a cluster
            badge below its summary encoding the mechanical activity that
            followed it up to the next (more recent) editorial event. */}
        {slicedEvents.map((ev, i) => {
          const slotIdx = danglingOffset + i;
          const cluster = clusterMap.get(ev.occurredAt);
          return (
            <li
              key={`${ev.occurredAt}-${i}`}
              className="history-card__event history-card__event--editorial"
              tabIndex={focusedIdx === slotIdx ? 0 : -1}
              ref={(el) => {
                rowRefs.current[slotIdx] = el;
              }}
              onFocus={() => setFocusedIdx(slotIdx)}
            >
              <div className="history-card__event-meta">
                <span
                  className="history-card__event-kind-glyph"
                  aria-hidden="true"
                  title="editorial"
                >
                  ※
                </span>
                <span className="history-card__event-actor" title={ev.actor}>
                  {shortActor(ev.actor)}
                </span>
                <span className="history-card__event-sep" aria-hidden="true">
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
              <div className="history-card__event-summary">
                {ev.summaryAst ? (
                  <HistoryProseRoot mdast={ev.summaryAst} />
                ) : (
                  <p>{ev.summary}</p>
                )}
              </div>
              {cluster && (
                <div className="history-card__cluster-badge">
                  {clusterPhrase(cluster)}
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
    </section>
  );
}
