/**
 * AstraProse — narrative renderer for `Bundle.narrative.*` and decision
 * rationales. Mirrors the markdown-lite that paper-view's `renderNarrative`
 * understands today: paragraph-split on blank lines, `**bold**`, and
 * `[label](#ref)` references.
 *
 * Refs use the dotted form the bundle ships in its narrative strings:
 *
 *   `[some text](#findings.foo)`
 *   `[some text](#decisions.cov)`
 *   `[some text](#decisions.cov.glass)`     (option suffix tolerated)
 *   `[some text](#inputs.glass_mocks)`
 *   `[some text](#outputs.final_distances)`
 *   `[some text](#outputs.bao_fitting.final_distances)` (sub-keyed)
 *   `[some text](#analyses.bao_fitting)`
 *   `[some text](#insights.planck2018_neff_consistency)`
 *
 * which resolve to the DOM anchors `<AstraPaperView>` sets:
 *
 *   `#astra-finding-<id>`     (findings)
 *   `#astra-decision-<key>`   (decisions, option suffix dropped)
 *   `#astra-input-<id>`       (inputs)
 *   `#astra-output-<key>`     (outputs, dotted keys preserved)
 *   `#astra-sub-<id>`         (sub-analyses)
 *   `#astra-insight-<id>`     (prior insights — vellum-only extension to
 *                              paper-view's narrative ref dialect; PR
 *                              upstream as the dialect grows)
 *
 * Clicking a ref scrolls the target into view, focuses it, and applies a
 * brief gold flash so the reader doesn't lose the thread (mirrors paper-
 * viewer.js's `scrollToPage` behavior).
 *
 * Keep this naïve — it's not a full markdown engine; it's the same dialect
 * paper-view supports today, so what we author for one renders correctly in
 * both. PR upstream when the dialect grows.
 *
 * See `vellum-reader/vellum-native-astra-renderer`.
 */

import { useCallback } from 'react';

const REF_RE = /\[([^\]]+)\]\(#([^)]+)\)/g;
const BOLD_RE = /\*\*([^*]+)\*\*/g;

const ASTRA_REF_KIND_TO_PREFIX: Record<string, string> = {
  findings: 'astra-finding-',
  decisions: 'astra-decision-',
  inputs: 'astra-input-',
  outputs: 'astra-output-',
  analyses: 'astra-sub-',
  insights: 'astra-insight-',
};

/**
 * Map a dotted bundle ref (`findings.foo`, `decisions.cov.glass`,
 * `outputs.bao_fitting.final_distances`) onto the DOM anchor id that
 * `<AstraPaperView>` sets. Returns `null` for unrecognised kinds so the
 * renderer can fall through to a plain `<a href="#...">` (still scrolls to
 * the literal hash if anything matches; otherwise inert).
 *
 * Decisions keep only the first dotted segment (`cov.glass` → `cov`); option
 * anchors don't exist as separate DOM ids today, so the click drops the
 * reader on the decision card. Outputs preserve dotted keys verbatim because
 * sub-analysis outputs are addressed as `<subId>.<outputId>` end-to-end.
 */
export function refToAnchorId(ref: string): string | null {
  const dot = ref.indexOf('.');
  if (dot < 0) return null;
  const kind = ref.slice(0, dot);
  const rest = ref.slice(dot + 1);
  const prefix = ASTRA_REF_KIND_TO_PREFIX[kind];
  if (!prefix) return null;
  if (kind === 'decisions') {
    // Strip option suffix — only the decision card has an anchor.
    const optionDot = rest.indexOf('.');
    return prefix + (optionDot < 0 ? rest : rest.slice(0, optionDot));
  }
  // findings/inputs/outputs/analyses pass the rest through verbatim.
  return prefix + rest;
}

/**
 * Scroll the targeted anchor into view and flash it gold. Used by the
 * Prose ref-click handler. Falls back to a hash-jump (no flash) when the
 * id can't be resolved or isn't in the DOM yet — covers the case where
 * the user clicks a ref into a section that hasn't been expanded yet
 * (decision cards collapse-by-default in Stage 1; this still drops them
 * at the right place).
 */
export function scrollToAstraAnchor(anchorId: string): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.getElementById(anchorId);
  if (!el) return false;
  // `block: 'start'` lands the section heading at the top of the scrolling
  // ancestor — the right behaviour for tall sections (sub-analyses, multi-
  // finding sections) where `center` would scroll past the heading and dump
  // the reader in the middle of the section's body. The flash highlights the
  // heading area so the eye still picks the target out.
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('astra-paper-view__flash');
  // Re-trigger the animation on repeat clicks.
  void (el as HTMLElement).offsetWidth;
  el.classList.add('astra-paper-view__flash');
  window.setTimeout(() => {
    el.classList.remove('astra-paper-view__flash');
  }, 1600);
  return true;
}

export interface AstraProseProps {
  text: string;
  /** Optional className extension; the base `astra-paper-view__prose` is
   *  always applied. */
  className?: string;
}

/**
 * Render free-form prose with paragraph splitting + `**bold**` +
 * `[label](#ref)` markdown-lite. Refs become real `<a>` elements with
 * accessible text, so screen readers (and agent-browser's a11y tree) see
 * them as navigable links.
 */
export function AstraProse({ text, className }: AstraProseProps) {
  const trimmed = text.trim();
  const handleRefClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      const anchor = (event.currentTarget.dataset.anchor || '').trim();
      if (!anchor) return;
      // Plain click → smooth-scroll inside the document. Cmd/Ctrl/middle
      // clicks fall through to the browser's default open-in-new-tab even
      // though same-document anchors are usually a no-op there.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button !== 0) return;
      const ok = scrollToAstraAnchor(anchor);
      if (ok) event.preventDefault();
    },
    []
  );
  if (!trimmed) return null;
  const paragraphs = trimmed.split(/\n{2,}/);
  const cls = className
    ? `astra-paper-view__prose ${className}`
    : 'astra-paper-view__prose';
  return (
    <div className={cls}>
      {paragraphs.map((p, i) => (
        <p key={i}>{renderParagraph(p, handleRefClick)}</p>
      ))}
    </div>
  );
}

/**
 * Tokenise a paragraph into text / bold / ref nodes in one pass. Refs win
 * over bold when both could match the same span — paper-view's renderer
 * does the ref pass after bold by replacing strings, but JSX nodes can't
 * be re-scanned the same way, so we walk the string once and decide per
 * match.
 */
function renderParagraph(
  text: string,
  handleRefClick: (event: React.MouseEvent<HTMLAnchorElement>) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Build a flat list of {start, end, kind, ...} matches, sort by start,
  // then walk.
  type Hit =
    | { kind: 'ref'; start: number; end: number; label: string; ref: string }
    | { kind: 'bold'; start: number; end: number; inner: string };
  const hits: Hit[] = [];
  REF_RE.lastIndex = 0;
  for (let m = REF_RE.exec(text); m; m = REF_RE.exec(text)) {
    hits.push({
      kind: 'ref',
      start: m.index,
      end: m.index + m[0].length,
      label: m[1],
      ref: m[2],
    });
  }
  BOLD_RE.lastIndex = 0;
  for (let m = BOLD_RE.exec(text); m; m = BOLD_RE.exec(text)) {
    // Skip bolds that sit inside an already-claimed ref span.
    const start = m.index;
    const end = start + m[0].length;
    const overlapsRef = hits.some(
      (h) => h.kind === 'ref' && start < h.end && end > h.start
    );
    if (overlapsRef) continue;
    hits.push({ kind: 'bold', start, end, inner: m[1] });
  }
  hits.sort((a, b) => a.start - b.start);
  let cursor = 0;
  let key = 0;
  for (const hit of hits) {
    if (hit.start < cursor) continue; // shouldn't happen; defensive
    if (hit.start > cursor) {
      nodes.push(text.slice(cursor, hit.start));
    }
    if (hit.kind === 'bold') {
      nodes.push(<strong key={`b-${key++}`}>{hit.inner}</strong>);
    } else {
      const anchor = refToAnchorId(hit.ref);
      // Always emit a real <a> so a11y sees a link; the click handler
      // intercepts when the anchor exists, otherwise the href hash-jumps
      // (or no-ops on a missing target).
      nodes.push(
        <a
          key={`r-${key++}`}
          className="astra-paper-view__ref"
          href={anchor ? `#${anchor}` : `#${hit.ref}`}
          data-anchor={anchor || ''}
          data-ref={hit.ref}
          onClick={anchor ? handleRefClick : undefined}
        >
          {hit.label}
        </a>
      );
    }
    cursor = hit.end;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}
