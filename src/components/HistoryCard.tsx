/**
 * HistoryCard — editorial event chain for a fiber, rendered as a margin
 * Card in Narrative mode.
 *
 * The card surfaces the per-fiber `felt history` editorial events
 * (agent-written prose summaries appended at session boundaries) so the
 * trail of memory across sessions is legible right next to the fiber.
 * It's a margin denizen — width set by the canvas column, not by the
 * card itself — and read-only: `felt history append` stays in the CLI.
 *
 * Visual register: the card wears the same Weathered Substrate chrome
 * as the unified Card primitive (border, palette, EB Garamond), with a
 * komejirushi (`※`, U+203B — the Japanese editorial-note marker) glyph
 * in the chrome so readers see "this is history, not another decision
 * or insight Card" at a glance.
 *
 * Bounded height with internal scroll keeps the card from dominating
 * the margin on shuttle-heavy fibers; the masthead `※n` indicator anchor
 * brings it back into view when scrolled past.
 *
 * Authoring: read-only here. The write path is `felt history append`
 * in the CLI — see the constitution.
 */

import { useEffect, useMemo, useRef } from 'react';
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

export function HistoryCard({ events, width, onNavigate }: HistoryCardProps) {
  const proseRef = useRef<HTMLOListElement>(null);

  // Stable mdast keys for myst-to-react, scoped per event so no two
  // events collide. Memoized because the events array is otherwise
  // re-allocated by the fetch effect on every refresh tick.
  const eventsWithKeys = useMemo(
    () =>
      events.map((ev, i) =>
        ev.summaryAst
          ? { ...ev, summaryAst: assignMdastKeys({ ...ev.summaryAst }, `history-${i}`) }
          : ev,
      ),
    [events],
  );

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

  if (events.length === 0) return null;

  return (
    <section
      id={HISTORY_CARD_ANCHOR_ID}
      role="region"
      aria-label={`Editorial history — ${events.length} ${events.length === 1 ? 'event' : 'events'}`}
      className="card card--history history-card"
      style={{ width: `${width}px` }}
    >
      <header className="history-card__chrome">
        <span className="history-card__glyph" aria-hidden="true">
          ※
        </span>
        <h3 className="history-card__title">History</h3>
        <span className="history-card__count" aria-hidden="true">
          {events.length}
        </span>
      </header>
      <ol className="history-card__events" ref={proseRef}>
        {eventsWithKeys.map((ev, i) => (
          <li
            key={`${ev.occurredAt}-${i}`}
            className="history-card__event"
          >
            <div className="history-card__event-meta">
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
            <div className="history-card__event-summary">
              {ev.summaryAst ? (
                <HistoryProseRoot mdast={ev.summaryAst} />
              ) : (
                <p>{ev.summary}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
