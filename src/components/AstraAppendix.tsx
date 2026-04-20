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
 * Prior insights (GraphFinding.kind === 'prior_insight') are intentionally
 * absent from the top level. In ASTRA they are decision-level evidence; a
 * later iteration will surface them inside the decision cards themselves,
 * via the per-option `insights:` refs already carried in the ASTRA fixture.
 *
 * Empty sections hide themselves; a fiber with no ASTRA at all renders
 * nothing.
 */

import type { GraphNode } from '~/utils/content-types';
import { Card } from './Card';

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

export function AstraAppendix({
  node,
  width,
  onNavigate,
  childSubKeys,
  subAnalysisLabels,
  subAnalysisSlugs,
}: AstraAppendixProps) {
  if (!node) return null;

  const decisions = node.decisions ?? [];
  const allFindings = node.findings ?? [];
  const findings = allFindings.filter((f) => f.kind !== 'prior_insight');
  const inputs = node.inputs ?? [];
  const outputs = node.outputs ?? [];
  const subKeys = childSubKeys ? Array.from(childSubKeys) : [];

  const hasAny =
    decisions.length > 0 ||
    findings.length > 0 ||
    inputs.length > 0 ||
    outputs.length > 0 ||
    subKeys.length > 0;
  if (!hasAny) return null;

  // Cards must be at least this wide for pretext to lay text cleanly —
  // mirrors the minimum used by WorkspaceAnatomy's canvas path.
  const cardWidth = Math.max(200, width);

  const hasMethods =
    decisions.length > 0 || inputs.length > 0 || subKeys.length > 0;
  const hasAppendix = decisions.length > 0 || outputs.length > 0;

  return (
    <aside
      id="astra-appendix"
      className="astra-appendix"
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
            {findings.map((finding) => (
              <div
                key={finding.key}
                id={`astra-finding-${finding.key}`}
                className="astra-appendix__item"
              >
                <Card
                  width={cardWidth}
                  content={{ type: 'finding', finding, hostSlug: node.slug, hostNode: node }}
                />
              </div>
            ))}
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
                {decisions.map((decision) => (
                  <div
                    key={decision.key}
                    id={`astra-decision-${decision.key}`}
                    className="astra-appendix__item"
                  >
                    <Card
                      width={cardWidth}
                      content={{ type: 'decision', decision, hostSlug: node.slug }}
                      onNavigate={onNavigate}
                    />
                  </div>
                ))}
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
                {outputs.map((output) => (
                  <div
                    key={output.id}
                    id={`astra-output-${output.id}`}
                    className="astra-appendix__item"
                  >
                    <Card
                      width={cardWidth}
                      content={{ type: 'output', output, hostNode: node }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
