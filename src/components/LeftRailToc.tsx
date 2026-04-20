/**
 * LeftRailToc — hierarchical table of contents for the lightcone-linear theme.
 *
 * Collapsed (32px): just a chevron at the left edge.
 * Expanded (272px): top-level section list pulled from the rendered narrative
 * H2s (summary / findings / methods / inputs / outputs) plus the paper-shaped
 * appendix sections (Findings / Methods / Appendix) emitted by AstraAppendix.
 *
 * Scan strategy: read the DOM rather than thread heading IDs through pretext.
 * Narrative H2 text is canonical (mystra emits fixed-case labels via
 * titleCase(key)); appendix sections already carry stable ids. MutationObserver
 * re-scans when pretext re-layouts, so the list stays live.
 *
 * Scroll-spy via IntersectionObserver. First intersecting section wins; a
 * top/bottom rootMargin biases the "active" window to the upper third of the
 * viewport so the rail highlights the section the reader is *reading*, not
 * the one whose heading is barely visible at the fold.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const NARRATIVE_KEYS = ['summary', 'findings', 'methods', 'inputs', 'outputs'] as const;
type NarrativeKey = (typeof NARRATIVE_KEYS)[number];

const NARRATIVE_LABELS: Record<NarrativeKey, string> = {
  summary: 'Summary',
  findings: 'Findings',
  methods: 'Methods',
  inputs: 'Inputs',
  outputs: 'Outputs',
};

const APPENDIX_SECTIONS: Array<{ key: string; label: string; selector: string }> = [
  { key: 'appendix-findings', label: 'Findings', selector: '#astra-appendix-findings' },
  { key: 'appendix-methods', label: 'Methods', selector: '#astra-appendix-methods' },
  { key: 'appendix-enumeration', label: 'Appendix', selector: '#astra-appendix-enumeration' },
];

interface TocEntry {
  key: string;
  label: string;
  group: 'narrative' | 'appendix';
  el: Element;
}

interface LeftRailTocProps {
  proseRef: React.RefObject<HTMLElement>;
}

export function LeftRailToc({ proseRef }: LeftRailTocProps) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const hoverCloseRef = useRef<number | null>(null);

  // Scan for sections in the rendered prose. Narrative H2s are matched by
  // lowercase text against the five canonical keys; appendix sections by id.
  useEffect(() => {
    const prose = proseRef.current;
    if (!prose) return;

    const scan = () => {
      const found: TocEntry[] = [];
      const seenNarrativeKeys = new Set<NarrativeKey>();

      const headings = prose.querySelectorAll<HTMLHeadingElement>('h2.pretext-prose-line--h2');
      headings.forEach((h) => {
        const text = (h.textContent ?? '').trim().toLowerCase();
        const match = NARRATIVE_KEYS.find(
          (k) => text === k || text === NARRATIVE_LABELS[k].toLowerCase(),
        );
        if (match && !seenNarrativeKeys.has(match)) {
          seenNarrativeKeys.add(match);
          found.push({
            key: match,
            label: NARRATIVE_LABELS[match],
            group: 'narrative',
            el: h,
          });
        }
      });

      for (const sec of APPENDIX_SECTIONS) {
        const el = prose.querySelector(sec.selector);
        if (el) {
          found.push({ key: sec.key, label: sec.label, group: 'appendix', el });
        }
      }

      setEntries((prev) => {
        if (
          prev.length === found.length &&
          prev.every((p, i) => p.el === found[i].el && p.key === found[i].key)
        ) {
          return prev;
        }
        return found;
      });
    };

    scan();
    // pretext re-layouts on width change and hot-reload, so re-scan when the
    // prose subtree mutates. childList + subtree is enough — heading text
    // lives inside the line span and we only care about presence, not text
    // tweaks.
    const mo = new MutationObserver(() => scan());
    mo.observe(prose, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [proseRef]);

  // Scroll-spy. `rootMargin: '-80px 0px -60% 0px'` makes the active section
  // the one in the top ~40% of the viewport — conservative so the rail feels
  // anchored to the reader's focus rather than jittering at boundaries.
  useEffect(() => {
    if (entries.length === 0) {
      setActiveKey(null);
      return;
    }
    const elToKey = new Map(entries.map((e) => [e.el, e.key] as const));
    let latest: string | null = activeKey;
    const io = new IntersectionObserver(
      (observations) => {
        // Track all currently-intersecting and pick the topmost.
        const hits = observations
          .filter((o) => o.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (hits.length > 0) {
          const key = elToKey.get(hits[0].target);
          if (key && key !== latest) {
            latest = key;
            setActiveKey(key);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: [0, 0.5, 1] },
    );
    entries.forEach((e) => io.observe(e.el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const handleMouseEnter = useCallback(() => {
    if (hoverCloseRef.current != null) {
      clearTimeout(hoverCloseRef.current);
      hoverCloseRef.current = null;
    }
    setExpanded(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverCloseRef.current != null) clearTimeout(hoverCloseRef.current);
    // Short debounce so tiny gaps between the chevron and the panel don't
    // flash the panel closed.
    hoverCloseRef.current = window.setTimeout(() => setExpanded(false), 120);
  }, []);

  const handleClick = useCallback((entry: TocEntry) => {
    // Smooth scroll; block 'start' pins the heading near the top. Apply a
    // small top offset via scroll-margin-top on the theme stylesheet rather
    // than here to keep the behavior overridable per surface.
    entry.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const narrativeEntries = useMemo(
    () => entries.filter((e) => e.group === 'narrative'),
    [entries],
  );
  const appendixEntries = useMemo(
    () => entries.filter((e) => e.group === 'appendix'),
    [entries],
  );

  if (entries.length === 0) return null;

  return (
    <nav
      className={`left-rail-toc ${
        expanded ? 'left-rail-toc--expanded' : 'left-rail-toc--collapsed'
      }`}
      aria-label="Table of contents"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        className="left-rail-toc__toggle"
        aria-label={expanded ? 'Collapse table of contents' : 'Expand table of contents'}
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="left-rail-toc__chevron" aria-hidden>
          {expanded ? '‹' : '›'}
        </span>
      </button>
      {expanded && (
        <div className="left-rail-toc__panel">
          {narrativeEntries.length > 0 && (
            <ul className="left-rail-toc__list">
              {narrativeEntries.map((entry) => (
                <li
                  key={entry.key}
                  className={`left-rail-toc__item${
                    activeKey === entry.key ? ' left-rail-toc__item--active' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="left-rail-toc__link"
                    onClick={() => handleClick(entry)}
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {appendixEntries.length > 0 && (
            <>
              <div className="left-rail-toc__divider" aria-hidden />
              <ul className="left-rail-toc__list left-rail-toc__list--appendix">
                {appendixEntries.map((entry) => (
                  <li
                    key={entry.key}
                    className={`left-rail-toc__item left-rail-toc__item--appendix${
                      activeKey === entry.key ? ' left-rail-toc__item--active' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="left-rail-toc__link"
                      onClick={() => handleClick(entry)}
                    >
                      {entry.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
