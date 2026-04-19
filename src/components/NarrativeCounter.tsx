/**
 * NarrativeCounter — marginalia table-of-contents next to the FiberHeader.
 *
 * One section per ASTRA kind present on the current fiber (findings,
 * decisions, outputs, inputs, analyses) plus an outgoing-refs line.
 * Sits in the right-margin canvas column, absolutely positioned inside
 * the prose wrapper so it scrolls with the page — unlike the fixed
 * thumb-index above it. Replaces both the older inline `AstraLegend`
 * kind-strip and the short-lived `PageMeta` nav sub-panel.
 *
 * Each kind renders in one of two modes:
 *   - **enumerated** (count ≤ ENUMERATE_THRESHOLD): one row per item,
 *     click jumps to that item's anchor in the appendix (findings,
 *     decisions, inputs, outputs) or navigates to the sub-analysis
 *     fiber (analyses). The reader sees *which* items the page
 *     carries, not just how many.
 *   - **aggregate** (count > ENUMERATE_THRESHOLD): a single row with
 *     the count, clicking jumps to that kind's section heading in the
 *     appendix. Keeps the counter from ballooning for fibers with
 *     dozens of findings.
 *
 * Refs always render as an aggregate count — there's no central
 * listing for outgoing cites in the prose, so enumeration has no
 * useful jump target.
 *
 * Hidden on narrow viewports (≤960px) since the thumb-index itself
 * goes away there — the counter has no column to sit in.
 */

import type { GraphNode } from '~/utils/content-types';
import { useNavigate } from 'react-router-dom';

/** Upper bound for enumeration. Counts above this collapse to an
 *  aggregate row so the marginalia column doesn't stack a scrolling
 *  rail of tiny one-line items for big fibers. */
const ENUMERATE_THRESHOLD = 8;

type Kind = 'findings' | 'decisions' | 'outputs' | 'inputs' | 'analyses';

const KIND_ORDER: Kind[] = ['findings', 'decisions', 'outputs', 'inputs', 'analyses'];

const KIND_GLYPH: Record<Kind, string> = {
  findings:  '●',
  decisions: '◇',
  outputs:   '▲',
  inputs:    '◌',
  analyses:  '△',
};

const KIND_LABEL_PLURAL: Record<Kind, string> = {
  findings:  'insights',
  decisions: 'decisions',
  outputs:   'outputs',
  inputs:    'inputs',
  analyses:  'analyses',
};

const KIND_LABEL_SINGULAR: Record<Kind, string> = {
  findings:  'insight',
  decisions: 'decision',
  outputs:   'output',
  inputs:    'input',
  analyses:  'analysis',
};

/** Shorten a raw key/id (`bao_detection_highest_significance`) into a
 *  label the reader can skim. Underscores and hyphens become spaces;
 *  snake_case stays snake_case-ish visually. */
function humanizeKey(key: string): string {
  return key.replace(/[_-]+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

interface CounterItem {
  id: string;
  label: string;
  /** Heading-id in the appendix (or elsewhere in the prose). When null
   *  the row navigates instead of scrolling — used for sub-analyses. */
  anchorId: string | null;
  /** Sub-analysis fibers route via the router. Null otherwise. */
  navigateSlug?: string;
}

interface NarrativeCounterProps {
  node?: GraphNode;
  /** Outgoing `cites` targets — fibers this page wiki-links to. */
  refCount: number;
  /** Sub-analysis children derived from `contains` graph edges. */
  subAnalyses: Array<{ slug: string; label: string; key: string }>;
}

export function NarrativeCounter({ node, refCount, subAnalyses }: NarrativeCounterProps) {
  const navigate = useNavigate();
  if (!node) return null;

  // Build the per-kind item lists from the node. Each item carries a
  // label + anchor/navigate target so the row click lands on the
  // specific thing it names.
  const itemsByKind: Record<Kind, CounterItem[]> = {
    findings: (node.findings ?? []).map((f) => ({
      id: f.key,
      label: truncate(f.claim || humanizeKey(f.key), 42),
      anchorId: `astra-finding-${f.key}`,
    })),
    decisions: (node.decisions ?? []).map((d) => ({
      id: d.key,
      label: truncate(d.label || humanizeKey(d.key), 42),
      anchorId: `astra-decision-${d.key}`,
    })),
    outputs: (node.outputs ?? []).map((o) => ({
      id: o.id,
      label: truncate(o.description || humanizeKey(o.id), 42),
      anchorId: `astra-output-${o.id}`,
    })),
    inputs: (node.inputs ?? []).map((i) => ({
      id: i.id,
      label: truncate(i.description || humanizeKey(i.id), 42),
      anchorId: `astra-input-${i.id}`,
    })),
    analyses: subAnalyses.map((a) => ({
      id: a.key,
      label: truncate(a.label || humanizeKey(a.key), 42),
      anchorId: null,
      navigateSlug: a.slug,
    })),
  };

  const visibleKinds = KIND_ORDER.filter((k) => itemsByKind[k].length > 0);
  if (visibleKinds.length === 0 && refCount === 0) return null;

  const scrollTo = (id: string) => {
    const el = document.getElementById(id) ?? document.getElementById('astra-appendix');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleItemClick = (item: CounterItem) => {
    if (item.navigateSlug) navigate(`/${item.navigateSlug}`);
    else if (item.anchorId) scrollTo(item.anchorId);
  };

  const handleAggregateClick = (kind: Kind) => {
    // Aggregate-only kinds (large lists) jump to their section heading;
    // analyses has no section so it falls back to the appendix root.
    const targetId = kind === 'analyses' ? 'astra-appendix' : `astra-appendix-${kind}`;
    scrollTo(targetId);
  };

  return (
    <aside className="narrative-counter" aria-label="On this page">
      {visibleKinds.map((kind) => {
        const items = itemsByKind[kind];
        const aggregate = items.length > ENUMERATE_THRESHOLD;
        const plural = items.length === 1 ? KIND_LABEL_SINGULAR[kind] : KIND_LABEL_PLURAL[kind];
        if (aggregate) {
          return (
            <button
              key={kind}
              type="button"
              className={`narrative-counter__row narrative-counter__row--${kind}`}
              onClick={() => handleAggregateClick(kind)}
              title={`Jump to ${items.length} ${plural}`}
            >
              <span className="narrative-counter__glyph" aria-hidden="true">{KIND_GLYPH[kind]}</span>
              <span className="narrative-counter__count">{items.length}</span>
              <span className="narrative-counter__label">{plural}</span>
            </button>
          );
        }
        return (
          <div key={kind} className="narrative-counter__group">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`narrative-counter__row narrative-counter__row--${kind} narrative-counter__row--item`}
                onClick={() => handleItemClick(item)}
                title={item.label}
              >
                <span className="narrative-counter__glyph" aria-hidden="true">{KIND_GLYPH[kind]}</span>
                <span className="narrative-counter__item-label">{item.label}</span>
              </button>
            ))}
          </div>
        );
      })}
      {refCount > 0 && (
        <div
          className="narrative-counter__row narrative-counter__row--refs"
          title={`${refCount} outgoing ${refCount === 1 ? 'ref' : 'refs'}`}
        >
          <span className="narrative-counter__glyph" aria-hidden="true">○</span>
          <span className="narrative-counter__count">{refCount}</span>
          <span className="narrative-counter__label">{refCount === 1 ? 'ref' : 'refs'}</span>
        </div>
      )}
    </aside>
  );
}
