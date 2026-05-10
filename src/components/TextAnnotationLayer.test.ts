import { describe, expect, it } from 'vitest';
import { annotationRailGeometry, annotationRailLeft, focusAnnotationDraftInput } from './TextAnnotationLayer';

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
