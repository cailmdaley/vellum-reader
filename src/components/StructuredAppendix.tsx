/**
 * StructuredAppendix — paper-shaped pseudo-sections below the narrative prose.
 *
 * Pass 6 of the themes constitution. The long-tail Card listing from the
 * pre-Pass-6 shape is now reorganized into three ordered sections:
 *
 *   1. Findings — top-level, new-knowledge-from-this-analysis only. Filters
 *      on `GraphFinding.kind === 'finding'` (tagged at the mystra graph-route
 *      boundary in Pass 6 step 1). Full Card per finding.
 *   2. Methods — compact summary. Decisions as anchored label list (pointing
 *      to the appendix enumeration), inputs list, sub-analyses list. One
 *      section — not N sections for N sub-analyses; each sub-analysis is a
 *      link, not an inlined expansion.
 *   3. Appendix — the single full enumeration: every decision + output as
 *      a full Card, in structured order.
 *
 * Pass 9a: under `lightcone-linear` the findings / decisions / outputs
 * collapse into a single exclusive-open tray. At most one row is expanded
 * at a time; opening another closes the previous. Collapsed rows show
 * label + compact summary (selected-option for decisions). Expanded rows
 * render the full Card. Ref clicks in the prose can expand a row via the
 * `vellum:expand-appendix-row` CustomEvent.
 *
 * Prior insights (GraphFinding.kind === 'prior_insight') are intentionally
 * absent from the top level. In structured they are decision-level evidence; a
 * later iteration will surface them inside the decision cards themselves,
 * via the per-option `insights:` refs already carried in the structured fixture.
 *
 * Empty sections hide themselves; a fiber with no structured at all renders
 * nothing.
 */

import { useEffect, useId, useState } from 'react';
import type {
  GraphDecision,
  GraphFinding,
  GraphInput,
  GraphNode,
  GraphOutput,
} from '~/utils/content-types';
import { Card } from './Card';
import { BibliographySection } from './BibliographySection';
import { useTheme } from '~/contexts/ThemeContext';

interface StructuredAppendixProps {
  node?: GraphNode;
  /** Inline content width of the prose column — cards stage at this width. */
  width: number;
  /** Router-driven navigation; threaded into decision cards so their
   *  "open page" chrome glyph can route to the §5 decision detail page,
   *  and into the Methods sub-analysis list. */
  onNavigate?: (slug: string) => void;
  /**
   * Child-sub-analysis index for the Methods section. Keys are the `analyses.<key>`
   * path segments; the Map gives display labels; `subAnalysisSlugs` gives the
   * full slug for click-navigation. Shape matches NarrativeView's existing
   * `childSubKeys` / `subAnalysisLabels` derivation so the caller can just
   * forward them through. Undefined when graph edges aren't available.
   */
  childSubKeys?: Set<string>;
  subAnalysisLabels?: Map<string, string>;
  subAnalysisSlugs?: Map<string, string>;
}

/** Row identity in the exclusive-open tray. `kind:key` keeps findings /
 *  decisions / outputs disjoint even when an structured author reuses an id
 *  across sections. */
type RowId =
  | `finding:${string}`
  | `decision:${string}`
  | `output:${string}`
  | `input:${string}`;

/** CustomEvent payload for cross-component row expansion. Dispatched by
 *  NarrativeView's anchor-click handler under lightcone-linear. */
interface ExpandAppendixRowDetail {
  kind: 'finding' | 'decision' | 'output' | 'input';
  id: string;
}

export function StructuredAppendix({
  node,
  width,
  onNavigate,
  childSubKeys,
  subAnalysisLabels,
  subAnalysisSlugs,
}: StructuredAppendixProps) {
  const { themeId } = useTheme();
  const collapsedTray = themeId === 'lightcone-linear';
  const [openRow, setOpenRow] = useState<RowId | null>(null);

  // Cross-component: prose-link click → expand the matching tray row.
  // Under lightcone-linear, inputs are promoted from the Methods bullet list
  // into their own CollapsedRow tray within the Methods section, so ref
  // clicks to `#inputs.id` expand a row rather than opening a float card.
  //
  // Under other themes (cail-personal), the appendix renders full cards
  // inline rather than a collapsed tray, so the expand-row request degrades
  // to a scroll-into-view on the target card — this keeps LeftRailToc child
  // clicks navigable under cail-personal without changing the rail's event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ExpandAppendixRowDetail>).detail;
      if (!detail) return;
      if (collapsedTray) {
        const rowId = `${detail.kind}:${detail.id}` as RowId;
        setOpenRow(rowId);
      }
      // Defer scroll until React has rendered the expanded card; two RAFs
      // survive both the state commit and pretext's measure pass.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const domId =
            detail.kind === 'finding'
              ? `structured-finding-${detail.id}`
              : detail.kind === 'decision'
                ? `structured-decision-${detail.id}`
                : detail.kind === 'output'
                  ? `structured-output-${detail.id}`
                  : `structured-input-${detail.id}`;
          const el = document.getElementById(domId);
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const onscreen = rect.top >= 0 && rect.bottom <= window.innerHeight;
          if (!onscreen) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
    };
    document.addEventListener('vellum:expand-appendix-row', handler);
    return () => document.removeEventListener('vellum:expand-appendix-row', handler);
  }, [collapsedTray]);

  // Parent-escape refs (`../decisions.id`) navigate here with a hash like
  // `#decisions.id`; re-dispatch the expand event once per mount/node-change
  // so the target tray row opens and scrolls into view on arrival. Runs after
  // a RAF to let the initial render mount the row DOM nodes the handler
  // above scrolls to.
  useEffect(() => {
    if (!collapsedTray) return;
    if (!node) return;
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const m = hash.match(/^(findings|decisions|outputs|inputs)\.([^.]+)$/);
    if (!m) return;
    const kindFromHash =
      m[1] === 'findings'
        ? ('finding' as const)
        : m[1] === 'decisions'
          ? ('decision' as const)
          : m[1] === 'outputs'
            ? ('output' as const)
            : ('input' as const);
    requestAnimationFrame(() => {
      document.dispatchEvent(
        new CustomEvent('vellum:expand-appendix-row', {
          detail: { kind: kindFromHash, id: m[2] },
        }),
      );
    });
    // Clear the hash so subsequent navigations don't re-trigger.
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [collapsedTray, node?.slug]);

  if (!node) return null;

  const decisions = node.decisions ?? [];
  const allFindings = node.findings ?? [];
  const findings = allFindings.filter((f) => f.kind !== 'prior_insight');
  const inputs = node.inputs ?? [];
  const outputs = node.outputs ?? [];
  const subKeys = childSubKeys ? Array.from(childSubKeys) : [];

  const hasBibliography = allFindings.some((f) =>
    (f.evidence ?? []).some((e) => !!e.doi),
  );
  const hasAny =
    decisions.length > 0 ||
    findings.length > 0 ||
    inputs.length > 0 ||
    outputs.length > 0 ||
    subKeys.length > 0 ||
    hasBibliography;
  if (!hasAny) return null;

  // Cards must be at least this wide for pretext to lay text cleanly —
  // mirrors the minimum used by WorkspaceAnatomy's canvas path.
  const cardWidth = Math.max(200, width);

  const hasMethods =
    decisions.length > 0 || inputs.length > 0 || subKeys.length > 0;
  const hasAppendix = decisions.length > 0 || outputs.length > 0;

  const toggle = (rowId: RowId) =>
    setOpenRow((prev) => (prev === rowId ? null : rowId));

  return (
    <aside
      id="structured-appendix"
      className={
        'structured-appendix' + (collapsedTray ? ' structured-appendix--collapsed-tray' : '')
      }
      aria-label="structured appendix"
    >
      <div className="structured-appendix__divider">
        <span className="structured-appendix__divider-label">structured</span>
      </div>

      {findings.length > 0 && (
        <section id="structured-appendix-findings" className="structured-appendix__section">
          {/* aria-label preserves source-case text. Without it, CSS
              text-transform: lowercase on .structured-appendix__heading bleeds into
              the accessible name calculation in modern Chrome — screen readers
              would announce "findings 3" instead of "Findings 3". */}
          <h3
            className="structured-appendix__heading"
            aria-label={`Findings, ${findings.length}`}
          >
            Findings <span className="structured-appendix__count">{findings.length}</span>
          </h3>
          <div className="structured-appendix__stack">
            {findings.map((finding) => {
              const rowId: RowId = `finding:${finding.key}`;
              return (
                <div
                  key={finding.key}
                  id={`structured-finding-${finding.key}`}
                  className="structured-appendix__item"
                >
                  {collapsedTray ? (
                    <CollapsedRow
                      open={openRow === rowId}
                      onToggle={() => toggle(rowId)}
                      kind="finding"
                      title={finding.label ?? finding.key}
                      summary={compactFindingSummary(finding)}
                    >
                      <Card
                        width={cardWidth}
                        content={{
                          type: 'finding',
                          finding,
                          hostSlug: node.slug,
                          hostNode: node,
                        }}
                      />
                    </CollapsedRow>
                  ) : (
                    <Card
                      width={cardWidth}
                      content={{
                        type: 'finding',
                        finding,
                        hostSlug: node.slug,
                        hostNode: node,
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {hasMethods && (
        <section id="structured-appendix-methods" className="structured-appendix__section">
          <h3 className="structured-appendix__heading" aria-label="Methods">Methods</h3>
          <div className="structured-appendix__methods">
            {decisions.length > 0 && (
              <div className="structured-appendix__methods-group">
                <div className="structured-appendix__methods-label">Decisions</div>
                <ul className="structured-appendix__methods-list">
                  {decisions.map((decision) => (
                    <li key={decision.key}>
                      <a
                        href={`#structured-decision-${decision.key}`}
                        className="structured-appendix__methods-link"
                      >
                        {decision.label}
                      </a>
                      {decision.selectedLabel && (
                        <span className="structured-appendix__methods-selected">
                          {' '}· {decision.selectedLabel}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {inputs.length > 0 && (
              <div className="structured-appendix__methods-group">
                <div className="structured-appendix__methods-label">Inputs</div>
                {collapsedTray ? (
                  <div className="structured-appendix__stack">
                    {inputs.map((input) => {
                      const rowId: RowId = `input:${input.id}`;
                      return (
                        <div
                          key={input.id}
                          id={`structured-input-${input.id}`}
                          className="structured-appendix__item"
                        >
                          <CollapsedRow
                            open={openRow === rowId}
                            onToggle={() => toggle(rowId)}
                            kind="input"
                            title={input.label ?? input.id}
                            summary={compactInputSummary(input)}
                          >
                            <Card
                              width={cardWidth}
                              content={{ type: 'input', input, hostNode: node }}
                            />
                          </CollapsedRow>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <ul className="structured-appendix__methods-list">
                    {inputs.map((input) => (
                      <li key={input.id}>
                        <span className="structured-appendix__methods-id">{input.id}</span>
                        {input.description && (
                          <span className="structured-appendix__methods-desc">
                            {' '}— {input.description}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {subKeys.length > 0 && (
              <div className="structured-appendix__methods-group">
                <div className="structured-appendix__methods-label">Sub-analyses</div>
                <ul className="structured-appendix__methods-list">
                  {subKeys.map((key) => {
                    const label = subAnalysisLabels?.get(key) ?? key;
                    const slug = subAnalysisSlugs?.get(key);
                    return (
                      <li key={key}>
                        {slug && onNavigate ? (
                          <a
                            href={`/${slug}`}
                            onClick={(e) => {
                              e.preventDefault();
                              onNavigate(slug);
                            }}
                            className="structured-appendix__methods-link"
                          >
                            {label}
                          </a>
                        ) : (
                          <span>{label}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {hasAppendix && (
        <section id="structured-appendix-enumeration" className="structured-appendix__section">
          <h3
            className="structured-appendix__heading"
            aria-label={`Appendix, ${decisions.length + outputs.length}`}
          >
            Appendix
            <span className="structured-appendix__count">
              {decisions.length + outputs.length}
            </span>
          </h3>
          {decisions.length > 0 && (
            <div
              id="structured-appendix-decisions"
              className="structured-appendix__subsection"
            >
              <h4
                className="structured-appendix__subheading"
                aria-label={`Decisions, ${decisions.length}`}
              >
                Decisions <span className="structured-appendix__count">{decisions.length}</span>
              </h4>
              <div className="structured-appendix__stack">
                {decisions.map((decision) => {
                  const rowId: RowId = `decision:${decision.key}`;
                  return (
                    <div
                      key={decision.key}
                      id={`structured-decision-${decision.key}`}
                      className="structured-appendix__item"
                    >
                      {collapsedTray ? (
                        <CollapsedRow
                          open={openRow === rowId}
                          onToggle={() => toggle(rowId)}
                          kind="decision"
                          title={decision.label}
                          summary={compactDecisionSummary(decision)}
                        >
                          <Card
                            width={cardWidth}
                            content={{ type: 'decision', decision, hostSlug: node.slug }}
                            onNavigate={onNavigate}
                          />
                        </CollapsedRow>
                      ) : (
                        <Card
                          width={cardWidth}
                          content={{ type: 'decision', decision, hostSlug: node.slug }}
                          onNavigate={onNavigate}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {outputs.length > 0 && (
            <div
              id="structured-appendix-outputs"
              className="structured-appendix__subsection"
            >
              <h4
                className="structured-appendix__subheading"
                aria-label={`Outputs, ${outputs.length}`}
              >
                Outputs <span className="structured-appendix__count">{outputs.length}</span>
              </h4>
              <div className="structured-appendix__stack">
                {outputs.map((output) => {
                  const rowId: RowId = `output:${output.id}`;
                  return (
                    <div
                      key={output.id}
                      id={`structured-output-${output.id}`}
                      className="structured-appendix__item"
                    >
                      {collapsedTray ? (
                        <CollapsedRow
                          open={openRow === rowId}
                          onToggle={() => toggle(rowId)}
                          kind="output"
                          title={output.label ?? output.id}
                          summary={compactOutputSummary(output)}
                        >
                          <Card
                            width={cardWidth}
                            content={{ type: 'output', output, hostNode: node }}
                          />
                        </CollapsedRow>
                      ) : (
                        <Card
                          width={cardWidth}
                          content={{ type: 'output', output, hostNode: node }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      <BibliographySection node={node} />
    </aside>
  );
}

/** CollapsedRow — exclusive-open wrapper for a single appendix entry.
 *
 *  Head is always visible (label + compact summary + caret). Body is the
 *  full Card, mounted only when `open` so pretext doesn't do layout work
 *  on the closed rows. Click head to toggle; parent enforces exclusivity. */
interface CollapsedRowProps {
  open: boolean;
  onToggle: () => void;
  kind: 'finding' | 'decision' | 'output' | 'input';
  title: string;
  summary?: string;
  children: React.ReactNode;
}

function CollapsedRow({ open, onToggle, kind, title, summary, children }: CollapsedRowProps) {
  // Stable per-row ids so screen readers can follow the disclosure
  // relationship between head (aria-expanded) and body (the panel that
  // appears). Without aria-controls + id, the button announces "expanded"
  // but the panel below is just a generic <div> with no semantic tie-back.
  const reactId = useId();
  const bodyId = `structured-appendix-row-body-${reactId}`;
  const headId = `structured-appendix-row-head-${reactId}`;
  return (
    <div
      className={
        'structured-appendix__row' +
        ` structured-appendix__row--${kind}` +
        (open ? ' structured-appendix__row--open' : '')
      }
    >
      <button
        type="button"
        id={headId}
        className="structured-appendix__row-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="structured-appendix__row-caret" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="structured-appendix__row-title">{title}</span>
        {summary && (
          <span className="structured-appendix__row-summary">{summary}</span>
        )}
      </button>
      {open && (
        <div
          className="structured-appendix__row-body"
          id={bodyId}
          role="region"
          aria-labelledby={headId}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** For decisions, the constitution is explicit: the collapsed head shows
 *  the selected option, not the full tag stack. */
function compactDecisionSummary(d: GraphDecision): string | undefined {
  return d.selectedLabel ?? undefined;
}

/** For findings, a compact glance at the claim — truncated to ~80 chars
 *  so the row head stays one line. */
function compactFindingSummary(f: GraphFinding): string | undefined {
  const text = f.claim?.trim();
  if (!text) return undefined;
  return text.length > 80 ? text.slice(0, 77) + '…' : text;
}

/** For inputs, the first line of the description — or the `from:` pointer
 *  if no description, since inputs are often catalog references rather than
 *  prose. Truncated to keep the row head one line. */
function compactInputSummary(i: GraphInput): string | undefined {
  const text =
    i.description?.trim().split('\n')[0] ??
    (i.from ? `from: ${i.from}` : i.source ? `from: ${i.source}` : undefined);
  if (!text) return undefined;
  return text.length > 80 ? text.slice(0, 77) + '…' : text;
}

/** For outputs, the `kind` badge + short description. */
function compactOutputSummary(o: GraphOutput): string | undefined {
  const desc = o.description?.trim();
  const head = o.kind ? `${o.kind}` : '';
  if (!desc) return head || undefined;
  const trimmed = desc.length > 60 ? desc.slice(0, 57) + '…' : desc;
  return head ? `${head} · ${trimmed}` : trimmed;
}
