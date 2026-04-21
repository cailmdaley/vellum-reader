/**
 * AstraAppendix — paper-shaped pseudo-sections below the narrative prose.
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
 *      a full Card, in ASTRA order.
 *
 * Pass 9a: under `lightcone-linear` the findings / decisions / outputs
 * collapse into a single exclusive-open tray. At most one row is expanded
 * at a time; opening another closes the previous. Collapsed rows show
 * label + compact summary (selected-option for decisions). Expanded rows
 * render the full Card. Ref clicks in the prose can expand a row via the
 * `vellum:expand-appendix-row` CustomEvent.
 *
 * Prior insights (GraphFinding.kind === 'prior_insight') are intentionally
 * absent from the top level. In ASTRA they are decision-level evidence; a
 * later iteration will surface them inside the decision cards themselves,
 * via the per-option `insights:` refs already carried in the ASTRA fixture.
 *
 * Empty sections hide themselves; a fiber with no ASTRA at all renders
 * nothing.
 */

import { useEffect, useState } from 'react';
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

interface AstraAppendixProps {
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
 *  decisions / outputs disjoint even when an ASTRA author reuses an id
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

export function AstraAppendix({
  node,
  width,
  onNavigate,
  childSubKeys,
  subAnalysisLabels,
  subAnalysisSlugs,
}: AstraAppendixProps) {
  const { themeId } = useTheme();
  const collapsedTray = themeId === 'lightcone-linear';
  const [openRow, setOpenRow] = useState<RowId | null>(null);

  // Cross-component: prose-link click → expand the matching tray row.
  // Under lightcone-linear, inputs are promoted from the Methods bullet list
  // into their own CollapsedRow tray within the Methods section, so ref
  // clicks to `#inputs.id` expand a row rather than opening a float card.
  useEffect(() => {
    if (!collapsedTray) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ExpandAppendixRowDetail>).detail;
      if (!detail) return;
      const rowId = `${detail.kind}:${detail.id}` as RowId;
      setOpenRow(rowId);
      // Defer scroll until React has rendered the expanded card; two RAFs
      // survive both the state commit and pretext's measure pass.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const domId =
            detail.kind === 'finding'
              ? `astra-finding-${detail.id}`
              : detail.kind === 'decision'
                ? `astra-decision-${detail.id}`
                : detail.kind === 'output'
                  ? `astra-output-${detail.id}`
                  : `astra-input-${detail.id}`;
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
      id="astra-appendix"
      className={
        'astra-appendix' + (collapsedTray ? ' astra-appendix--collapsed-tray' : '')
      }
      aria-label="ASTRA appendix"
    >
      <div className="astra-appendix__divider">
        <span className="astra-appendix__divider-label">astra</span>
      </div>

      {findings.length > 0 && (
        <section id="astra-appendix-findings" className="astra-appendix__section">
          <h3 className="astra-appendix__heading">
            Findings <span className="astra-appendix__count">{findings.length}</span>
          </h3>
          <div className="astra-appendix__stack">
            {findings.map((finding) => {
              const rowId: RowId = `finding:${finding.key}`;
              return (
                <div
                  key={finding.key}
                  id={`astra-finding-${finding.key}`}
                  className="astra-appendix__item"
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
        <section id="astra-appendix-methods" className="astra-appendix__section">
          <h3 className="astra-appendix__heading">Methods</h3>
          <div className="astra-appendix__methods">
            {decisions.length > 0 && (
              <div className="astra-appendix__methods-group">
                <div className="astra-appendix__methods-label">Decisions</div>
                <ul className="astra-appendix__methods-list">
                  {decisions.map((decision) => (
                    <li key={decision.key}>
                      <a
                        href={`#astra-decision-${decision.key}`}
                        className="astra-appendix__methods-link"
                      >
                        {decision.label}
                      </a>
                      {decision.selectedLabel && (
                        <span className="astra-appendix__methods-selected">
                          {' '}· {decision.selectedLabel}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {inputs.length > 0 && (
              <div className="astra-appendix__methods-group">
                <div className="astra-appendix__methods-label">Inputs</div>
                {collapsedTray ? (
                  <div className="astra-appendix__stack">
                    {inputs.map((input) => {
                      const rowId: RowId = `input:${input.id}`;
                      return (
                        <div
                          key={input.id}
                          id={`astra-input-${input.id}`}
                          className="astra-appendix__item"
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
                  <ul className="astra-appendix__methods-list">
                    {inputs.map((input) => (
                      <li key={input.id}>
                        <span className="astra-appendix__methods-id">{input.id}</span>
                        {input.description && (
                          <span className="astra-appendix__methods-desc">
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
              <div className="astra-appendix__methods-group">
                <div className="astra-appendix__methods-label">Sub-analyses</div>
                <ul className="astra-appendix__methods-list">
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
                            className="astra-appendix__methods-link"
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
        <section id="astra-appendix-enumeration" className="astra-appendix__section">
          <h3 className="astra-appendix__heading">
            Appendix
            <span className="astra-appendix__count">
              {decisions.length + outputs.length}
            </span>
          </h3>
          {decisions.length > 0 && (
            <div
              id="astra-appendix-decisions"
              className="astra-appendix__subsection"
            >
              <h4 className="astra-appendix__subheading">
                Decisions <span className="astra-appendix__count">{decisions.length}</span>
              </h4>
              <div className="astra-appendix__stack">
                {decisions.map((decision) => {
                  const rowId: RowId = `decision:${decision.key}`;
                  return (
                    <div
                      key={decision.key}
                      id={`astra-decision-${decision.key}`}
                      className="astra-appendix__item"
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
              id="astra-appendix-outputs"
              className="astra-appendix__subsection"
            >
              <h4 className="astra-appendix__subheading">
                Outputs <span className="astra-appendix__count">{outputs.length}</span>
              </h4>
              <div className="astra-appendix__stack">
                {outputs.map((output) => {
                  const rowId: RowId = `output:${output.id}`;
                  return (
                    <div
                      key={output.id}
                      id={`astra-output-${output.id}`}
                      className="astra-appendix__item"
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
  return (
    <div
      className={
        'astra-appendix__row' +
        ` astra-appendix__row--${kind}` +
        (open ? ' astra-appendix__row--open' : '')
      }
    >
      <button
        type="button"
        className="astra-appendix__row-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="astra-appendix__row-caret" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="astra-appendix__row-title">{title}</span>
        {summary && (
          <span className="astra-appendix__row-summary">{summary}</span>
        )}
      </button>
      {open && <div className="astra-appendix__row-body">{children}</div>}
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
