/**
 * MarginFindingsStepper — wraps FindingsStepper as an absolute-positioned
 * margin card, anchored vertically to the findings H2 in the prose.
 *
 * Mounted by NarrativeView in lightcone-margin and cail-personal themes
 * (where the constitution wants the stepper in the margin, next to the
 * prose, so the reader doesn't lose narrative flow by scrolling past an
 * inline block). Same positioning vocabulary as MarginCitations:
 * compute a wrapper-relative top + a railLeft off --canvas-width, and
 * render inside `.vellum-prose-wrapper` with `position: absolute`.
 *
 * Detection of the findings heading: pretext doesn't plumb mdast
 * `identifier` into the DOM, so we match on `.pretext-prose-line--h2`
 * elements whose text content is "Findings". This matches mystra's
 * title-cased rendering of the fixed 5-key narrative.
 */

import { useEffect, useState } from 'react';
import { FindingsStepper } from './FindingsStepper';
import {
  marginaliaWidth,
  readCanvasWidth,
} from '~/utils/canvas-geometry';

interface MarginFindingsStepperProps {
  proseRef: React.RefObject<HTMLElement>;
  wrapperRef: React.RefObject<HTMLElement>;
}

export function MarginFindingsStepper({
  proseRef,
  wrapperRef,
}: MarginFindingsStepperProps) {
  const [top, setTop] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [width, setWidth] = useState(() =>
    marginaliaWidth(readCanvasWidth()),
  );

  useEffect(() => {
    const prose = proseRef.current;
    const wrapper = wrapperRef.current;
    if (!prose || !wrapper) return;

    let raf = 0;
    const measure = () => {
      const proseEl = proseRef.current;
      const wrapperEl = wrapperRef.current;
      if (!proseEl || !wrapperEl) {
        setTop(null);
        return;
      }
      const wrapperRect = wrapperEl.getBoundingClientRect();

      // Find the "Findings" heading among rendered h2 spans. Pretext
      // splits long headings across multiple .pretext-prose-line--h2
      // spans, but a single-word heading like "Findings" stays on one
      // line in practice; take the first match and use its top.
      const headings = proseEl.querySelectorAll<HTMLElement>(
        '.pretext-prose-line--h2',
      );
      let headingEl: HTMLElement | null = null;
      for (const h of Array.from(headings)) {
        if (h.textContent?.trim().toLowerCase() === 'findings') {
          headingEl = h;
          break;
        }
      }
      // Fallback: not every fiber has a `narrative.findings` section,
      // but the stepper should still appear when the fiber has findings.
      // Anchor to the FiberHeader bottom (end of the title plate) if the
      // Findings h2 is absent, so the card always has a home.
      const pretextBox = proseEl.querySelector<HTMLElement>('.pretext-prose');
      if (headingEl) {
        const lineTopAttr = headingEl.getAttribute('data-pretext-line-top');
        if (lineTopAttr && pretextBox) {
          const pretextTop =
            pretextBox.getBoundingClientRect().top - wrapperRect.top;
          const offset = Number.parseFloat(lineTopAttr);
          if (Number.isFinite(offset)) {
            setTop(pretextTop + offset);
          } else {
            setTop(headingEl.getBoundingClientRect().top - wrapperRect.top);
          }
        } else {
          setTop(headingEl.getBoundingClientRect().top - wrapperRect.top);
        }
      } else {
        // Anchor to the fiber-header's bottom edge if it exists, else to
        // pretext's top, else to the wrapper's own top + a small inset.
        const fiberHeader = proseEl.querySelector<HTMLElement>(
          '.vellum-fiber-header',
        );
        if (fiberHeader) {
          const rect = fiberHeader.getBoundingClientRect();
          setTop(rect.bottom - wrapperRect.top);
        } else if (pretextBox) {
          const rect = pretextBox.getBoundingClientRect();
          setTop(rect.top - wrapperRect.top);
        } else {
          setTop(24);
        }
      }

      // railLeft: same recipe as MarginCitations. The margin column is
      // pinned to the right edge of the viewport by --canvas-width; we
      // express its left inside wrapper coordinates.
      const canvasWidth = readCanvasWidth();
      const canvasLeft =
        canvasWidth > 0 ? window.innerWidth - canvasWidth : window.innerWidth;
      setLeft(Math.max(0, canvasLeft - wrapperRect.left + 12));
      setWidth(marginaliaWidth(canvasWidth));
    };

    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };

    schedule();

    const ro = new ResizeObserver(schedule);
    ro.observe(prose);
    ro.observe(wrapper);

    const mo = new MutationObserver(schedule);
    mo.observe(prose, { childList: true, subtree: true, characterData: true });

    window.addEventListener('resize', schedule);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [proseRef, wrapperRef]);

  if (top == null) return null;
  return (
    <div
      className="astra-findings-stepper-margin-host"
      style={{ position: 'absolute', top, left, width }}
    >
      <FindingsStepper variant="margin" />
    </div>
  );
}
