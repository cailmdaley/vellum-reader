/**
 * OutlinePalette — keyboard-triggered heading outline for the current document.
 *
 * Press `t` to open, arrow keys to navigate, Enter to scroll to heading,
 * Escape to dismiss. Reads h2 headings from the rendered prose DOM.
 * Scroll-spy highlights the currently visible heading.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface HeadingEntry {
  text: string;
  element: HTMLElement;
  top: number;
}

interface OutlinePaletteProps {
  open: boolean;
  onClose: () => void;
}

export function OutlinePalette({ open, onClose }: OutlinePaletteProps) {
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [activeIdx, setActiveIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  // Gather headings from the prose when opening
  useEffect(() => {
    if (!open) return;
    const prose = document.querySelector('.vellum-prose');
    if (!prose) return;
    const h2s = prose.querySelectorAll<HTMLElement>('h2');
    const entries: HeadingEntry[] = Array.from(h2s).map((el) => ({
      text: el.textContent?.trim() ?? '',
      element: el,
      top: el.getBoundingClientRect().top + window.scrollY,
    }));
    setHeadings(entries);

    // Find currently active heading (scroll spy)
    const scrollY = window.scrollY + 120; // offset for sticky header
    let active = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].top <= scrollY) {
        active = i;
        break;
      }
    }
    setActiveIdx(active);
    setSelectedIdx(active);
  }, [open]);

  // Scroll selected item into view in the list
  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[selectedIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, open]);

  const scrollToHeading = useCallback((entry: HeadingEntry) => {
    onClose();
    // Scroll with offset for sticky header
    const headerHeight = 60;
    window.scrollTo(0, entry.top - headerHeight);
  }, [onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 't') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, headings.length - 1));
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (headings[selectedIdx]) {
          scrollToHeading(headings[selectedIdx]);
        }
        return;
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, headings, selectedIdx, scrollToHeading, onClose]);

  if (!open || headings.length === 0) return null;

  return (
    <>
      <div className="outline-backdrop" onClick={onClose} />
      <div className="outline-palette">
        <div className="outline-palette__header">Outline</div>
        <div className="outline-palette__list" ref={listRef}>
          {headings.map((h, i) => (
            <button
              key={i}
              className={
                'outline-item' +
                (i === selectedIdx ? ' outline-item--selected' : '') +
                (i === activeIdx ? ' outline-item--active' : '')
              }
              onClick={() => scrollToHeading(h)}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              {h.text}
            </button>
          ))}
        </div>
        <div className="outline-palette__hint">
          <kbd>j</kbd><kbd>k</kbd> navigate · <kbd>Enter</kbd> go · <kbd>Esc</kbd> close
        </div>
      </div>
    </>
  );
}
