/**
 * history-clusters.ts — pure computation for the "narrated activity log"
 * shape of the HistoryCard.
 *
 * The HistoryCard renders the felt history chain as a *narrated activity
 * log*: editorial events are the spine, mechanical events are folded into
 * per-gap *cluster badges* attached below the editorial event they
 * "forward-look from," and mechanical activity that postdates the most-
 * recent editorial event surfaces as a *dangling tail* — an action signal
 * for agents arriving on dispatch ("summarize what you find before adding
 * to it").
 *
 * All functions here are pure: input is HistoryEvent[], output is
 * structured data. No React, no DOM. Extracted for testability.
 */

import type { HistoryEvent } from './content-types';

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Aggregated summary of the mechanical events that fall between two
 * consecutive editorial events (forward-looking from editorial N to N+1),
 * or between the latest editorial event and "now" (dangling tail).
 */
export interface ClusterBadge {
  /** Number of mechanical events in this group. */
  count: number;
  /**
   * Net line delta across the group: last mech's sizeLines minus the
   * sizeLines at the start of the cluster. Undefined when sizeLines is
   * not available on any event in the group or on the preceding baseline.
   */
  linesDelta?: number;
  /** Number of distinct actors in this group. */
  actorCount: number;
  /**
   * Timestamp of the last mechanical event in the group.
   * Used for the recency phrase on the dangling tail.
   */
  lastOccurredAt: string;
}

// ── Core computation ──────────────────────────────────────────────────────

/**
 * Build a ClusterBadge from a list of mechanical events.
 *
 * @param mechs - mechanical events in chronological order (ascending)
 * @param sizeLinesBeforeCluster - the sizeLines value immediately before
 *   the first event in `mechs` (used for net delta). Pass undefined if
 *   unknown.
 */
export function buildBadge(
  mechs: HistoryEvent[],
  sizeLinesBeforeCluster: number | undefined,
): ClusterBadge {
  const count = mechs.length;
  const actorCount = new Set(mechs.map((ev) => ev.actor)).size;
  const lastOccurredAt = mechs[mechs.length - 1].occurredAt;

  // Net line delta: last event with sizeLines minus the baseline.
  let linesDelta: number | undefined;
  const lastWithLines = [...mechs].reverse().find((ev) => ev.sizeLines !== undefined);
  if (lastWithLines?.sizeLines !== undefined && sizeLinesBeforeCluster !== undefined) {
    linesDelta = lastWithLines.sizeLines - sizeLinesBeforeCluster;
  }

  return { count, linesDelta, actorCount, lastOccurredAt };
}

/**
 * Partition a mixed history event array into cluster badges keyed by
 * editorial event timestamp, plus a dangling tail.
 *
 * The "forward-looking cluster" model:
 * - Sort all events chronologically (ascending).
 * - For each editorial event E_N, gather all mechanical events between
 *   E_N and E_{N+1} (i.e., mechanical events with timestamps strictly
 *   after E_N and before E_{N+1}).
 * - That cluster is keyed by E_N's occurredAt.
 * - Mechanical events after the last editorial event form the dangling
 *   tail (not keyed to any editorial event).
 * - Mechanical events before the first editorial event are dropped
 *   (historical prelude, no forward-looking editorial to attach to).
 *
 * **Never-narrated case**: when there are no editorial events at all,
 * every mechanical event becomes the dangling tail with `neverNarrated:
 * true`. This is the typical state for a freshly-created fiber that's
 * been edited but not yet had an editorial event recorded — exactly
 * when the "narrate before adding" cue is most useful.
 *
 * Returns:
 * - `clusterMap`: Map<editorialTs, ClusterBadge>. Badge for event with
 *   key `ts` covers the mechanical events that followed that editorial
 *   event up to (but not including) the next editorial event.
 * - `danglingTail`: the ClusterBadge for mechanical events after the
 *   latest editorial event, or for all mechanical events when no
 *   editorial events exist. Null when there are no mechanicals (or
 *   none after the last editorial).
 * - `neverNarrated`: true iff the dangling tail covers a fiber that
 *   has zero editorial events. Drives the "no narration yet" phrase
 *   instead of "since last narrated."
 */
export function computeClusterGroups(events: HistoryEvent[]): {
  clusterMap: Map<string, ClusterBadge>;
  danglingTail: ClusterBadge | null;
  neverNarrated: boolean;
} {
  const clusterMap = new Map<string, ClusterBadge>();
  if (events.length === 0) {
    return { clusterMap, danglingTail: null, neverNarrated: false };
  }

  // Walk chronologically so "forward-looking" means strictly later timestamps.
  const sorted = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  // Detect the never-narrated case up front: no editorial events at all
  // means every mechanical is part of the (one and only) dangling tail.
  const hasAnyEditorial = sorted.some((ev) => (ev.kind ?? 'editorial') === 'editorial');
  if (!hasAnyEditorial) {
    const mechs = sorted; // all events are mechanical here
    if (mechs.length === 0) {
      return { clusterMap, danglingTail: null, neverNarrated: false };
    }
    // Use the first mech's sizeLines as the baseline so linesDelta from
    // creation reads sensibly ("+12 lines since creation"). If the first
    // mech is an `add` event with sizeLines, that's the natural zero point.
    const baseline = mechs[0]?.sizeLines;
    return {
      clusterMap,
      danglingTail: buildBadge(mechs, baseline),
      neverNarrated: true,
    };
  }

  let currentEditorialTs: string | null = null;
  let pendingMechs: HistoryEvent[] = [];
  let prevSizeLines: number | undefined; // last known sizeLines from any mech event
  let sizeLinesBeforeCluster: number | undefined; // baseline at the start of each cluster

  for (const ev of sorted) {
    const isEditorial = (ev.kind ?? 'editorial') === 'editorial';
    if (isEditorial) {
      // Close out the cluster for the previous editorial event.
      if (currentEditorialTs !== null && pendingMechs.length > 0) {
        clusterMap.set(currentEditorialTs, buildBadge(pendingMechs, sizeLinesBeforeCluster));
      }
      // Start a new cluster window after this editorial event.
      currentEditorialTs = ev.occurredAt;
      pendingMechs = [];
      sizeLinesBeforeCluster = prevSizeLines; // baseline = size just before first mech after this editorial
    } else {
      // Mechanical event: update running sizeLines.
      if (ev.sizeLines !== undefined) prevSizeLines = ev.sizeLines;
      // Only collect if we've seen at least one editorial event.
      if (currentEditorialTs !== null) {
        pendingMechs.push(ev);
      }
      // Mechs before the first editorial event are historical prelude —
      // they don't forward-look from any editorial event, so drop them.
    }
  }

  // Remaining pendingMechs after the last editorial = dangling tail.
  const danglingTail =
    currentEditorialTs !== null && pendingMechs.length > 0
      ? buildBadge(pendingMechs, sizeLinesBeforeCluster)
      : null;

  return { clusterMap, danglingTail, neverNarrated: false };
}

// ── Phrase renderers ─────────────────────────────────────────────────────

/**
 * Render a cluster badge as a compact prose phrase:
 * "then N saves, +M lines, K actors"
 *
 * Parts are omitted when not informative:
 * - linesDelta omitted when undefined or zero.
 * - actorCount omitted when ≤ 1 (single actor adds no signal).
 */
export function clusterPhrase(badge: ClusterBadge): string {
  const parts: string[] = [`${badge.count} ${badge.count === 1 ? 'save' : 'saves'}`];
  if (badge.linesDelta !== undefined && badge.linesDelta !== 0) {
    parts.push(`${badge.linesDelta > 0 ? '+' : ''}${badge.linesDelta} lines`);
  }
  if (badge.actorCount > 1) {
    parts.push(`${badge.actorCount} actors`);
  }
  return `then ${parts.join(', ')}`;
}

/**
 * Render a dangling tail badge as an action-signal phrase. Two shapes
 * depending on whether the fiber has ever been narrated:
 *
 * - Has been narrated, but tail diverged from spine:
 *   "⚠ dangling: N saves since last narrated · last edit Xh ago"
 * - Never narrated:
 *   "⌀ no narration yet · N saves · last edit Xh ago"
 *
 * Both phrasings carry the same agent-on-dispatch cue ("summarize what
 * you find before adding to it") but the never-narrated form is honest
 * about there being no prior chain to build from. The `relativeTime`
 * function is passed in to keep this module free of DOM/Date side
 * effects (easier to test).
 */
export function danglingPhrase(
  tail: ClusterBadge,
  relativeTimeFn: (ts: string) => string,
  neverNarrated = false,
): string {
  const saves = `${tail.count} ${tail.count === 1 ? 'save' : 'saves'}`;
  const recency = ` · last edit ${relativeTimeFn(tail.lastOccurredAt)}`;
  if (neverNarrated) {
    return `⌀ no narration yet · ${saves}${recency}`;
  }
  return `⚠ dangling: ${saves} since last narrated${recency}`;
}
