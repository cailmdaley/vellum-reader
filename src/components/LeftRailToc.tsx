/**
 * LeftRailToc — hierarchical table of contents for the lightcone-linear theme.
 *
 * Collapsed (32px): just a chevron at the left edge.
 * Expanded (272px): the five canonical narrative sections as top-level
 * entries (summary / findings / methods / inputs / outputs), each with its
 * appendix children nested beneath. A section is only listed when either
 * its narrative H2 is present in the prose or it has at least one child.
 *
 *   Findings
 *     → individual findings (non-prior_insight)          #structured-finding-<id>
 *   Methods
 *     → decisions                                        #structured-decision-<key>
 *   Inputs
 *     → inputs                                           #structured-input-<id>
 *   Outputs
 *     → outputs                                          #structured-output-<id>
 *
 * The top-level entry always scrolls to the narrative H2 when present;
 * clicking a child triggers the appendix tray's expand path via
 * `vellum:expand-appendix-row` (canonical; keeps ToC click and in-prose
 * anchor click behaving identically).
 *
 * Narrative H2 presence is scanned live from the DOM so the rail stays in
 * sync with pretext's re-layouts (MutationObserver on the prose subtree).
 * Children come from the graph node — no DOM scan needed; the appendix is
 * derived from the same source.
 *
 * Scroll-spy via IntersectionObserver. The topmost intersecting element
 * (narrative H2 or appendix row) wins; a generous top rootMargin biases
 * the "active" window to the upper third of the viewport so the rail
 * highlights what the reader is *reading*, not what is barely visible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '~/utils/content-types';

const NARRATIVE_KEYS = ['summary', 'findings', 'methods', 'inputs', 'outputs'] as const;
type NarrativeKey = (typeof NARRATIVE_KEYS)[number];

const NARRATIVE_LABELS: Record<NarrativeKey, string> = {
  summary: 'Summary',
  findings: 'Findings',
  methods: 'Methods',
  inputs: 'Inputs',
  outputs: 'Outputs',
};

interface ChildEntry {
  /** Stable DOM id to scroll-spy + scroll-to. */
  domId: string;
  /** `vellum:expand-appendix-row` kind token. */
  kind: 'finding' | 'decision' | 'output' | 'input';
  /** Appendix row key/id — what the expand event carries in `detail.id`. */
  rowId: string;
  label: string;
}

interface SectionEntry {
  key: NarrativeKey;
  label: string;
  /** The H2 element in the prose, if the narrative paragraph was authored.
   *  Absent when the section has children but no narrative (rare but legal —
   *  a fiber can declare outputs and skip the outputs narrative). */
  headingEl?: HTMLHeadingElement;
  children: ChildEntry[];
}

interface LeftRailTocProps {
  proseRef: React.RefObject<HTMLElement>;
  /** Current graph node — source of truth for appendix children. Undefined
   *  on fibers without an structured graph (rail degrades to narrative-only). */
  node?: GraphNode;
}

/** Build the appendix children map for each narrative section from the
 *  graph node. Pure function so it can live outside the component. */
function deriveChildren(node: GraphNode | undefined): Record<NarrativeKey, ChildEntry[]> {
  const empty: Record<NarrativeKey, ChildEntry[]> = {
    summary: [],
    findings: [],
    methods: [],
    inputs: [],
    outputs: [],
  };
  if (!node) return empty;

  // Findings — filter out prior_insights (same filter StructuredAppendix uses).
  empty.findings = (node.findings ?? [])
    .filter((f) => f.kind !== 'prior_insight')
    .map((f) => ({
      domId: `structured-finding-${f.key}`,
      kind: 'finding' as const,
      rowId: f.key,
      label: f.label ?? f.key,
    }));

  // Methods hosts the decisions list (inputs get their own section).
  empty.methods = (node.decisions ?? []).map((d) => ({
    domId: `structured-decision-${d.key}`,
    kind: 'decision' as const,
    rowId: d.key,
    label: d.label,
  }));

  empty.inputs = (node.inputs ?? []).map((i) => ({
    domId: `structured-input-${i.id}`,
    kind: 'input' as const,
    rowId: i.id,
    label: i.label ?? i.id,
  }));

  empty.outputs = (node.outputs ?? []).map((o) => ({
    domId: `structured-output-${o.id}`,
    kind: 'output' as const,
    rowId: o.id,
    label: o.label ?? o.id,
  }));

  return empty;
}

export function LeftRailToc({ proseRef, node }: LeftRailTocProps) {
  const [expanded, setExpanded] = useState(false);
  const [headings, setHeadings] = useState<Partial<Record<NarrativeKey, HTMLHeadingElement>>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const hoverCloseRef = useRef<number | null>(null);

  const children = useMemo(() => deriveChildren(node), [node]);

  // Scan for narrative H2s in the rendered prose. Match by lowercased text
  // against the five canonical keys. MutationObserver re-scans when pretext
  // re-layouts so the list stays live.
  useEffect(() => {
    const prose = proseRef.current;
    if (!prose) return;

    const scan = () => {
      const found: Partial<Record<NarrativeKey, HTMLHeadingElement>> = {};
      const nodes = prose.querySelectorAll<HTMLHeadingElement>('h2.pretext-prose-line--h2');
      nodes.forEach((h) => {
        const text = (h.textContent ?? '').trim().toLowerCase();
        const match = NARRATIVE_KEYS.find(
          (k) => text === k || text === NARRATIVE_LABELS[k].toLowerCase(),
        );
        if (match && !found[match]) found[match] = h;
      });

      setHeadings((prev) => {
        // Shallow-compare so MutationObserver churn doesn't thrash state.
        const prevKeys = Object.keys(prev) as NarrativeKey[];
        const nextKeys = Object.keys(found) as NarrativeKey[];
        if (prevKeys.length === nextKeys.length) {
          let equal = true;
          for (const k of nextKeys) {
            if (prev[k] !== found[k]) {
              equal = false;
              break;
            }
          }
          if (equal) return prev;
        }
        return found;
      });
    };

    scan();
    const mo = new MutationObserver(() => scan());
    mo.observe(prose, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [proseRef]);

  // Assemble ordered sections.
  const sections: SectionEntry[] = useMemo(() => {
    return NARRATIVE_KEYS.map((key) => ({
      key,
      label: NARRATIVE_LABELS[key],
      headingEl: headings[key],
      children: children[key],
    })).filter((s) => s.headingEl || s.children.length > 0);
  }, [headings, children]);

  // Scroll-spy across both narrative H2s and appendix row anchors. The
  // active key is either a narrative section or a child domId — rendered
  // as a highlight at either level.
  useEffect(() => {
    if (sections.length === 0) {
      setActiveKey(null);
      return;
    }
    const elToKey = new Map<Element, string>();
    for (const s of sections) {
      if (s.headingEl) elToKey.set(s.headingEl, s.key);
      for (const c of s.children) {
        const el = document.getElementById(c.domId);
        if (el) elToKey.set(el, c.domId);
      }
    }
    if (elToKey.size === 0) return;

    let latest: string | null = activeKey;
    const io = new IntersectionObserver(
      (observations) => {
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
    elToKey.forEach((_key, el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  const handleMouseEnter = useCallback(() => {
    if (hoverCloseRef.current != null) {
      clearTimeout(hoverCloseRef.current);
      hoverCloseRef.current = null;
    }
    setExpanded(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverCloseRef.current != null) clearTimeout(hoverCloseRef.current);
    hoverCloseRef.current = window.setTimeout(() => setExpanded(false), 120);
  }, []);

  const handleSectionClick = useCallback((section: SectionEntry) => {
    // Prefer the narrative H2 if present. Fall back to the first child's
    // anchor when the section is children-only (no authored narrative).
    if (section.headingEl) {
      section.headingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const first = section.children[0];
    if (!first) return;
    const el = document.getElementById(first.domId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleChildClick = useCallback((child: ChildEntry) => {
    // Route through the appendix's canonical expand path — same code path
    // as in-prose ref clicks, so the row opens exclusively, closes others,
    // and scrolls only if offscreen.
    document.dispatchEvent(
      new CustomEvent('vellum:expand-appendix-row', {
        detail: { kind: child.kind, id: child.rowId },
      }),
    );
  }, []);

  if (sections.length === 0) return null;

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
          <ul className="left-rail-toc__list">
            {sections.map((section) => (
              <li
                key={section.key}
                className={`left-rail-toc__item${
                  activeKey === section.key ? ' left-rail-toc__item--active' : ''
                }`}
              >
                <button
                  type="button"
                  className="left-rail-toc__link"
                  onClick={() => handleSectionClick(section)}
                >
                  {section.label}
                </button>
                {section.children.length > 0 && (
                  <ul className="left-rail-toc__children">
                    {section.children.map((child) => (
                      <li
                        key={child.domId}
                        className={`left-rail-toc__child${
                          activeKey === child.domId
                            ? ' left-rail-toc__child--active'
                            : ''
                        }`}
                      >
                        <button
                          type="button"
                          className="left-rail-toc__child-link"
                          onClick={() => handleChildClick(child)}
                          title={child.label}
                        >
                          {child.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
