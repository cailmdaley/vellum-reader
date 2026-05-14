import { describe, expect, it } from 'vitest';
import {
  annotationRailGeometry,
  annotationRailLeft,
  computeMarginNoteLayout,
  focusAnnotationDraftInput,
} from './TextAnnotationLayer';

describe('focusAnnotationDraftInput', () => {
  it('focuses the margin draft without letting the browser scroll to it', () => {
    const calls: FocusOptions[] = [];
    focusAnnotationDraftInput({
      focus: (options?: FocusOptions) => calls.push(options ?? {}),
    });

    expect(calls).toEqual([{ preventScroll: true }]);
  });
});

describe('annotationRailLeft', () => {
  it('places notes on the canvas rail instead of just outside the prose wrapper', () => {
    expect(annotationRailLeft({
      wrapperLeft: 198,
      wrapperWidth: 708,
      viewportWidth: 1100,
      canvasWidth: 360,
    })).toBe(554);
  });

  it('keeps fallback notes inside the viewport when no canvas rail exists', () => {
    expect(annotationRailGeometry({
      wrapperLeft: 198,
      wrapperWidth: 708,
      viewportWidth: 1100,
      canvasWidth: 0,
    })).toEqual({ left: 720, width: 170 });
  });
});

describe('computeMarginNoteLayout', () => {
  const mark = (id: string, top: number) => ({ annotation: { id }, top });

  it('keeps non-overlapping notes at their anchor Y', () => {
    // Heights are large enough to overlap if the layout cared only about
    // anchors, but the next anchor sits far enough below that the
    // waterfall reduces to identity. Verifies we don't artificially
    // push cards down when there's no collision.
    const layout = computeMarginNoteLayout(
      [mark('a', 100), mark('b', 400), mark('c', 800)],
      () => 80,
      12,
    );
    expect(layout.get('a')).toBe(100);
    expect(layout.get('b')).toBe(400);
    expect(layout.get('c')).toBe(800);
  });

  it('waterfalls adjacent tall notes by previous height + gap', () => {
    // The bug we're fixing: three multi-line notes anchored within ~10px
    // of each other. The previous formula bumped each next card by just
    // 16px, so cards ~80px tall overlapped by ~64px. Correct layout
    // stacks: 100, 100+80+12=192, 192+80+12=284.
    const layout = computeMarginNoteLayout(
      [mark('a', 100), mark('b', 105), mark('c', 110)],
      () => 80,
      12,
    );
    expect(layout.get('a')).toBe(100);
    expect(layout.get('b')).toBe(192);
    expect(layout.get('c')).toBe(284);
  });

  it('respects anchor Y when it sits below the previous bottom + gap', () => {
    // First card is short, second has its anchor below the natural
    // waterfall floor — should land at its anchor, not at the floor.
    const layout = computeMarginNoteLayout(
      [mark('a', 100), mark('b', 500)],
      (id) => (id === 'a' ? 20 : 60),
      12,
    );
    expect(layout.get('a')).toBe(100);
    expect(layout.get('b')).toBe(500);
  });

  it('uses zero height for unmounted refs without breaking the chain', () => {
    // During the first paint (before any card has been measured) heights
    // resolve to 0; the layout collapses to anchor-only positioning,
    // which is exactly what we want for the initial render before the
    // measurement pass commits the corrected positions.
    const layout = computeMarginNoteLayout(
      [mark('a', 100), mark('b', 110), mark('c', 120)],
      () => 0,
      12,
    );
    expect(layout.get('a')).toBe(100);
    expect(layout.get('b')).toBe(112);
    expect(layout.get('c')).toBe(124);
  });
});
