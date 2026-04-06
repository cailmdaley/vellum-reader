/**
 * GhostToc — minimal left-margin section navigation.
 *
 * On-screen headings: entries positioned at their actual line.
 * Off-screen headings: cluster-stack at viewport edges.
 * Before first heading scrolls into view: all entries stacked at top.
 *
 * Positions are updated via direct DOM manipulation (no React state)
 * to avoid re-render jank on scroll.
 */

import { useEffect, useRef, useState } from 'react';

interface TocEntry {
  id: string;
  text: string;
  depth: number;
  naturalTop: number;
  el: HTMLAnchorElement | null;
}

interface GhostTocProps {
  proseRef: React.RefObject<HTMLElement>;
  wrapperRef: React.RefObject<HTMLElement>;
}

const ENTRY_HEIGHT = 22;
const VIEWPORT_PAD = 60;

export function GhostToc({ proseRef, wrapperRef }: GhostTocProps) {
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const entriesRef = useRef<TocEntry[]>([]);
  const navRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number>(0);

  // Scan headings and measure natural positions
  useEffect(() => {
    const prose = proseRef.current;
    const wrapper = wrapperRef.current;
    if (!prose || !wrapper) return;

    const measure = () => {
      const wrapperRect = wrapper.getBoundingClientRect();
      const headings = prose.querySelectorAll<HTMLElement>('h2, h3');
      const next: TocEntry[] = [];

      for (const h of headings) {
        const text = h.textContent?.trim() ?? '';
        if (!text) continue;
        const id = h.id || text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
        if (!h.id) h.id = id;

        const rect = h.getBoundingClientRect();
        const top = rect.top - wrapperRect.top + window.scrollY;
        const depth = h.tagName === 'H3' ? 3 : 2;

        next.push({ id, text, depth, naturalTop: top, el: null });
      }

      entriesRef.current = next;
      setEntries(next);
    };

    const timer = setTimeout(measure, 200);
    const observer = new ResizeObserver(measure);
    observer.observe(prose);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [proseRef, wrapperRef]);

  // Scroll spy
  useEffect(() => {
    if (entries.length === 0) return;

    const observer = new IntersectionObserver(
      (intersections) => {
        for (const entry of intersections) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: '-10% 0px -70% 0px', threshold: 0 },
    );

    for (const e of entries) {
      const el = document.getElementById(e.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [entries]);

  // Direct DOM position updates — no React re-renders
  useEffect(() => {
    const items = entriesRef.current;
    if (items.length === 0) return;

    function updatePositions() {
      const scrollY = window.scrollY;
      const viewTop = scrollY + VIEWPORT_PAD;
      const viewBottom = scrollY + window.innerHeight - VIEWPORT_PAD;

      // Partition into above / visible / below
      const above: number[] = [];
      const visible: number[] = [];
      const below: number[] = [];

      for (let i = 0; i < items.length; i++) {
        if (items[i].naturalTop < viewTop) above.push(i);
        else if (items[i].naturalTop > viewBottom) below.push(i);
        else visible.push(i);
      }

      // If nothing is visible yet (haven't scrolled to first heading),
      // treat everything as "below" and stack at the top
      const allAboveViewport = visible.length === 0 && below.length === items.length;

      // Compute display positions
      const positions = new Array<number>(items.length);
      const onScreen = new Array<boolean>(items.length);

      if (allAboveViewport) {
        // Stack all at viewport top
        for (let i = 0; i < items.length; i++) {
          positions[i] = viewTop + i * ENTRY_HEIGHT;
          onScreen[i] = false;
        }
      } else {
        // Above stack
        for (let i = 0; i < above.length; i++) {
          positions[above[i]] = viewTop + i * ENTRY_HEIGHT;
          onScreen[above[i]] = false;
        }

        // Visible — natural position, but don't overlap above stack
        const aboveBottom = above.length > 0
          ? viewTop + above.length * ENTRY_HEIGHT + 8
          : viewTop;
        let lastBottom = aboveBottom;

        for (const idx of visible) {
          const top = Math.max(items[idx].naturalTop, lastBottom);
          positions[idx] = top;
          onScreen[idx] = true;
          lastBottom = top + ENTRY_HEIGHT;
        }

        // Below stack — upward from viewport bottom
        const belowStart = Math.max(
          viewBottom - below.length * ENTRY_HEIGHT,
          lastBottom + 8,
        );
        for (let i = 0; i < below.length; i++) {
          positions[below[i]] = belowStart + i * ENTRY_HEIGHT;
          onScreen[below[i]] = false;
        }
      }

      // Auto-show when near the top of the page (all entries stacked)
      const isTop = allAboveViewport || scrollY < 200;
      if (navRef.current) {
        const hasTop = navRef.current.classList.contains('ghost-toc--top');
        if (hasTop !== isTop) navRef.current.classList.toggle('ghost-toc--top', isTop);
      }

      // Batch DOM writes — read nothing after this point
      for (let i = 0; i < items.length; i++) {
        const el = items[i].el;
        if (!el) continue;
        el.style.top = `${positions[i]}px`;
        const wasOff = el.classList.contains('ghost-toc__entry--offscreen');
        if (wasOff !== !onScreen[i]) {
          el.classList.toggle('ghost-toc__entry--offscreen', !onScreen[i]);
        }
      }
    }

    function onScroll() {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePositions);
    }

    // Initial position
    updatePositions();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <nav
      ref={navRef}
      className={`ghost-toc${hovered ? ' ghost-toc--hover' : ''}`}
      aria-label="Section navigation"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {entries.map((e, i) => (
        <a
          key={e.id}
          ref={(el) => { entriesRef.current[i].el = el; }}
          href={`#${e.id}`}
          className={
            'ghost-toc__entry'
            + (e.depth === 3 ? ' ghost-toc__entry--h3' : '')
            + (e.id === activeId ? ' ghost-toc__entry--active' : '')
          }
          onClick={(ev) => {
            ev.preventDefault();
            document.getElementById(e.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          title={e.text}
        >
          {e.text.length > 22 ? e.text.slice(0, 22) + '…' : e.text}
        </a>
      ))}
    </nav>
  );
}
