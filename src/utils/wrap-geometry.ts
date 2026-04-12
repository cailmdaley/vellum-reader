/**
 * wrap-geometry — text-slot carving around fixed rectangles.
 *
 * Pretext exposes per-line layout through `layoutNextLine(prepared, cursor,
 * maxWidth)`, but the package does not export the supporting geometry that
 * turns a set of obstacles into a max-width for each row. That lives in the
 * pretext `pages/demos/wrap-geometry.ts` source, not in the npm entry point.
 *
 * This file vendors the slice we actually need for Vellum Workspace cards:
 *   - `Interval` + `Rect` primitives
 *   - `getRectIntervalsForBand` — which rectangles intersect one text band
 *   - `carveTextLineSlots` — subtract blocked intervals from a base slot
 *   - `pickWidestSlot` — choose a usable slot when several survive
 *
 * Keep it pure: no DOM, no pretext imports, no side effects. If future work
 * needs polygon obstacles (image-based wrap hulls), add them here too —
 * upstream's API already models that, we just vendor what we use.
 *
 * See [[vellum-reader/workspace]] Gate 1b.
 */

export type Interval = {
  left: number;
  right: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Return the blocked horizontal intervals for a single text band
 * (from `bandTop` to `bandBottom`) given a set of obstacle rectangles.
 *
 * `horizontalPadding` is added to both sides of each rectangle so text does
 * not kiss the rectangle's edge. `verticalPadding` widens the band when
 * checking intersection, so lines grazing the rectangle's top/bottom rows
 * also count as blocked and we avoid a one-pixel slip-through.
 */
export function getRectIntervalsForBand(
  rects: Rect[],
  bandTop: number,
  bandBottom: number,
  horizontalPadding: number,
  verticalPadding: number,
): Interval[] {
  const intervals: Interval[] = [];
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!;
    if (bandBottom <= rect.y - verticalPadding) continue;
    if (bandTop >= rect.y + rect.height + verticalPadding) continue;
    intervals.push({
      left: rect.x - horizontalPadding,
      right: rect.x + rect.width + horizontalPadding,
    });
  }
  return intervals;
}

/**
 * Carve usable text slots out of a base interval by subtracting blocked
 * intervals. Slivers narrower than `minSlotWidth` are discarded — a 10px
 * remnant next to a media pane is not a slot we want to hand to pretext.
 *
 * Example with `base = [14, 546]`, one media rect blocking `[370, 546]`,
 * and `minSlotWidth = 40`: the result is `[{14, 370}]`.
 */
export function carveTextLineSlots(
  base: Interval,
  blocked: Interval[],
  minSlotWidth: number = 40,
): Interval[] {
  let slots: Interval[] = [base];
  for (let bi = 0; bi < blocked.length; bi++) {
    const interval = blocked[bi]!;
    const next: Interval[] = [];
    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si]!;
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot);
        continue;
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left });
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right });
    }
    slots = next;
  }
  return slots.filter((s) => s.right - s.left >= minSlotWidth);
}

/**
 * Pick the widest slot, tiebreak by left-most. Null when no slot survives.
 *
 * For Vellum cards this is a reasonable default because the editorial
 * intent is "use whichever side of the media pane is most readable." When
 * both sides tie (e.g. plate placement), left wins, which reads first.
 */
export function pickWidestSlot(slots: Interval[]): Interval | null {
  if (slots.length === 0) return null;
  let best = slots[0]!;
  for (let i = 1; i < slots.length; i++) {
    const s = slots[i]!;
    const bw = best.right - best.left;
    const sw = s.right - s.left;
    if (sw > bw) best = s;
    else if (sw === bw && s.left < best.left) best = s;
  }
  return best;
}
