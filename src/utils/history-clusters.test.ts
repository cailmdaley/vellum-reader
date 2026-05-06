import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from './content-types';
import {
  buildBadge,
  clusterPhrase,
  computeClusterGroups,
  danglingPhrase,
} from './history-clusters';

// ── Helpers ───────────────────────────────────────────────────────────────

function editorial(
  ts: string,
  actor = 'worker@host',
  summary = 'Session summary.',
): HistoryEvent {
  return { occurredAt: ts, actor, kind: 'editorial', summary };
}

function mech(
  ts: string,
  actor = 'external',
  sizeLines?: number,
): HistoryEvent {
  return { occurredAt: ts, actor, kind: 'external_edit', sizeLines };
}

// ── buildBadge ────────────────────────────────────────────────────────────

describe('buildBadge', () => {
  it('counts events and actors', () => {
    const mechs: HistoryEvent[] = [
      mech('2026-05-03T10:00:00Z', 'alice', 80),
      mech('2026-05-03T10:05:00Z', 'bob', 85),
      mech('2026-05-03T10:10:00Z', 'alice', 90),
    ];
    const badge = buildBadge(mechs, 75);
    expect(badge.count).toBe(3);
    expect(badge.actorCount).toBe(2); // alice + bob
    expect(badge.linesDelta).toBe(15); // 90 - 75
    expect(badge.lastOccurredAt).toBe('2026-05-03T10:10:00Z');
  });

  it('computes linesDelta as last-sizeLines minus baseline', () => {
    const mechs: HistoryEvent[] = [
      mech('T1', 'external', 100),
      mech('T2', 'external', 120),
    ];
    const badge = buildBadge(mechs, 95);
    expect(badge.linesDelta).toBe(25); // 120 - 95
  });

  it('linesDelta is undefined when baseline is unknown', () => {
    const mechs: HistoryEvent[] = [mech('T1', 'external', 100)];
    const badge = buildBadge(mechs, undefined);
    expect(badge.linesDelta).toBeUndefined();
  });

  it('linesDelta is undefined when no mech has sizeLines', () => {
    const mechs: HistoryEvent[] = [
      mech('T1', 'external'),
      mech('T2', 'external'),
    ];
    const badge = buildBadge(mechs, 80);
    expect(badge.linesDelta).toBeUndefined();
  });

  it('uses last event with sizeLines (not first) for delta', () => {
    const mechs: HistoryEvent[] = [
      mech('T1', 'external', 100),
      mech('T2', 'external'), // no sizeLines
      mech('T3', 'external', 130),
    ];
    const badge = buildBadge(mechs, 90);
    expect(badge.linesDelta).toBe(40); // 130 - 90
  });

  it('single actor: actorCount = 1', () => {
    const mechs = [mech('T1', 'external'), mech('T2', 'external')];
    expect(buildBadge(mechs, undefined).actorCount).toBe(1);
  });
});

// ── computeClusterGroups ──────────────────────────────────────────────────

describe('computeClusterGroups', () => {
  it('empty events: no clusters, no dangling tail', () => {
    const { clusterMap, danglingTail } = computeClusterGroups([]);
    expect(clusterMap.size).toBe(0);
    expect(danglingTail).toBeNull();
  });

  it('only editorial events: empty clusters, no dangling tail', () => {
    const events = [
      editorial('2026-05-01T10:00:00Z'),
      editorial('2026-05-02T10:00:00Z'),
    ];
    const { clusterMap, danglingTail } = computeClusterGroups(events);
    expect(clusterMap.size).toBe(0);
    expect(danglingTail).toBeNull();
  });

  it('only mechanical events (no editorial): all dangling tail, neverNarrated=true', () => {
    // The "never narrated" case — fiber has been edited but no editorial
    // event recorded yet. Every mech becomes the dangling tail so the
    // card can render the "no narration yet" cue.
    const events = [mech('T1', 'external', 80), mech('T2', 'external', 85)];
    const { clusterMap, danglingTail, neverNarrated } = computeClusterGroups(events);
    expect(clusterMap.size).toBe(0);
    expect(neverNarrated).toBe(true);
    expect(danglingTail).not.toBeNull();
    expect(danglingTail!.count).toBe(2);
    // linesDelta = last sizeLines (85) - baseline (first mech sizeLines, 80) = 5
    expect(danglingTail!.linesDelta).toBe(5);
  });

  it('only mechanical events with a single mech: dangling tail with count=1', () => {
    const events = [mech('T1', 'external', 80)];
    const { danglingTail, neverNarrated } = computeClusterGroups(events);
    expect(neverNarrated).toBe(true);
    expect(danglingTail).not.toBeNull();
    expect(danglingTail!.count).toBe(1);
  });

  it('mechs before first editorial are dropped (historical prelude)', () => {
    const E1 = editorial('2026-05-01T12:00:00Z');
    const events = [mech('2026-05-01T10:00:00Z'), E1];
    const { clusterMap, danglingTail } = computeClusterGroups(events);
    // No cluster for E1 (no mechs after it) and no dangling tail
    expect(clusterMap.size).toBe(0);
    expect(danglingTail).toBeNull();
  });

  it('standard three-editorial timeline: clusters keyed to each editorial', () => {
    // E1 [M1 M2] E2 [M3] E3 [M4 M5 dangling]
    const E1 = editorial('2026-05-01T10:00:00Z');
    const M1 = mech('2026-05-01T11:00:00Z', 'external', 85);
    const M2 = mech('2026-05-01T12:00:00Z', 'external', 90);
    const E2 = editorial('2026-05-01T13:00:00Z');
    const M3 = mech('2026-05-01T14:00:00Z', 'external', 95);
    const E3 = editorial('2026-05-01T15:00:00Z');
    const M4 = mech('2026-05-01T16:00:00Z', 'external', 97);
    const M5 = mech('2026-05-01T17:00:00Z', 'external', 99);

    const events = [E1, M1, M2, E2, M3, E3, M4, M5];
    const { clusterMap, danglingTail } = computeClusterGroups(events);

    // E1 cluster: M1 + M2 (mechs after E1 before E2)
    const c1 = clusterMap.get(E1.occurredAt);
    expect(c1).toBeDefined();
    expect(c1!.count).toBe(2);
    // baseline for E1's cluster = prevSizeLines at moment E1 is encountered
    // = undefined (no mech before E1) → linesDelta undefined
    expect(c1!.linesDelta).toBeUndefined();

    // E2 cluster: M3 (mechs after E2 before E3)
    const c2 = clusterMap.get(E2.occurredAt);
    expect(c2).toBeDefined();
    expect(c2!.count).toBe(1);
    // baseline for E2's cluster = prevSizeLines at E2 = M2.sizeLines = 90
    expect(c2!.linesDelta).toBe(5); // 95 - 90

    // E3: no cluster (mechs after E3 are dangling tail)
    expect(clusterMap.has(E3.occurredAt)).toBe(false);

    // Dangling tail: M4 + M5
    expect(danglingTail).not.toBeNull();
    expect(danglingTail!.count).toBe(2);
    // baseline at E3 encounter = M3.sizeLines = 95
    expect(danglingTail!.linesDelta).toBe(4); // 99 - 95
    expect(danglingTail!.lastOccurredAt).toBe(M5.occurredAt);
  });

  it('mechs only after latest editorial: all dangling tail', () => {
    const E1 = editorial('2026-05-01T10:00:00Z');
    const M1 = mech('2026-05-01T11:00:00Z', 'external', 90);
    const M2 = mech('2026-05-01T12:00:00Z', 'external', 95);
    const { clusterMap, danglingTail } = computeClusterGroups([E1, M1, M2]);
    expect(clusterMap.size).toBe(0);
    expect(danglingTail).not.toBeNull();
    expect(danglingTail!.count).toBe(2);
    expect(danglingTail!.lastOccurredAt).toBe(M2.occurredAt);
  });

  it('events arrive out-of-order: sorted before processing', () => {
    // Provide events shuffled; the algorithm should sort them first.
    const E1 = editorial('2026-05-01T10:00:00Z');
    const M1 = mech('2026-05-01T11:00:00Z', 'external', 85);
    const E2 = editorial('2026-05-01T12:00:00Z');
    // Shuffled order:
    const events = [E2, E1, M1];
    const { clusterMap, danglingTail } = computeClusterGroups(events);
    const c1 = clusterMap.get(E1.occurredAt);
    expect(c1).toBeDefined();
    expect(c1!.count).toBe(1);
    expect(danglingTail).toBeNull();
  });

  it('undefined kind treated as editorial', () => {
    // Legacy events with no `kind` field should be treated as editorial.
    const legacyEditorial: HistoryEvent = {
      occurredAt: '2026-05-01T10:00:00Z',
      actor: 'worker@host',
      summary: 'Old summary.',
      // kind: undefined
    };
    const M1 = mech('2026-05-01T11:00:00Z', 'external', 80);
    const { clusterMap, danglingTail } = computeClusterGroups([legacyEditorial, M1]);
    expect(danglingTail).not.toBeNull();
    expect(danglingTail!.count).toBe(1);
    expect(clusterMap.size).toBe(0);
  });
});

// ── clusterPhrase ─────────────────────────────────────────────────────────

describe('clusterPhrase', () => {
  it('count + linesDelta + actorCount when all available and informative', () => {
    const phrase = clusterPhrase({ count: 5, linesDelta: 12, actorCount: 3, lastOccurredAt: 'T' });
    expect(phrase).toBe('then 5 saves, +12 lines, 3 actors');
  });

  it('negative linesDelta renders with minus sign', () => {
    const phrase = clusterPhrase({ count: 2, linesDelta: -8, actorCount: 1, lastOccurredAt: 'T' });
    expect(phrase).toBe('then 2 saves, -8 lines');
  });

  it('omits linesDelta when undefined', () => {
    const phrase = clusterPhrase({ count: 3, linesDelta: undefined, actorCount: 2, lastOccurredAt: 'T' });
    expect(phrase).toBe('then 3 saves, 2 actors');
  });

  it('omits linesDelta when zero', () => {
    const phrase = clusterPhrase({ count: 1, linesDelta: 0, actorCount: 1, lastOccurredAt: 'T' });
    expect(phrase).toBe('then 1 save');
  });

  it('omits actorCount when 1 (single actor adds no signal)', () => {
    const phrase = clusterPhrase({ count: 4, linesDelta: 5, actorCount: 1, lastOccurredAt: 'T' });
    expect(phrase).toBe('then 4 saves, +5 lines');
  });

  it('singular "save" for count === 1', () => {
    const phrase = clusterPhrase({ count: 1, linesDelta: undefined, actorCount: 1, lastOccurredAt: 'T' });
    expect(phrase).toBe('then 1 save');
  });

  it('minimal: only count (no delta, single actor)', () => {
    const phrase = clusterPhrase({ count: 7, actorCount: 1, lastOccurredAt: 'T' });
    expect(phrase).toBe('then 7 saves');
  });
});

// ── danglingPhrase ────────────────────────────────────────────────────────

describe('danglingPhrase', () => {
  const fakeRelTime = (_ts: string) => '2h ago';

  it('renders warning prefix + save count + recency', () => {
    const phrase = danglingPhrase(
      { count: 5, actorCount: 1, lastOccurredAt: '2026-05-03T10:00:00Z' },
      fakeRelTime,
    );
    expect(phrase).toBe('⚠ dangling: 5 saves since last narrated · last edit 2h ago');
  });

  it('singular "save" for count === 1', () => {
    const phrase = danglingPhrase(
      { count: 1, actorCount: 1, lastOccurredAt: '2026-05-03T10:00:00Z' },
      fakeRelTime,
    );
    expect(phrase).toBe('⚠ dangling: 1 save since last narrated · last edit 2h ago');
  });

  it('passes lastOccurredAt to relativeTimeFn', () => {
    const captured: string[] = [];
    danglingPhrase({ count: 3, actorCount: 1, lastOccurredAt: 'sentinel-ts' }, (ts) => {
      captured.push(ts);
      return 'X';
    });
    expect(captured).toEqual(['sentinel-ts']);
  });

  it('never-narrated mode: "no narration yet" prefix instead of "dangling"', () => {
    const phrase = danglingPhrase(
      { count: 4, actorCount: 1, lastOccurredAt: '2026-05-03T10:00:00Z' },
      fakeRelTime,
      true,
    );
    expect(phrase).toBe('⌀ no narration yet · 4 saves · last edit 2h ago');
  });

  it('never-narrated singular save', () => {
    const phrase = danglingPhrase(
      { count: 1, actorCount: 1, lastOccurredAt: '2026-05-03T10:00:00Z' },
      fakeRelTime,
      true,
    );
    expect(phrase).toBe('⌀ no narration yet · 1 save · last edit 2h ago');
  });
});
