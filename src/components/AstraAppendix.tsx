/**
 * AstraAppendix — long-tail Card listing of every ASTRA entry a fiber
 * carries, rendered at the end of the narrative prose.
 *
 * Where margin glyphs surface ASTRA structure one-at-a-time on hover,
 * the appendix is the at-a-glance index: decisions, insights, inputs,
 * and outputs all laid out as full Cards in the prose column's inline
 * size. Reuses the unified Card primitive — no bespoke renderers — so
 * appendix cards look and layout identically to workspace anatomy cards
 * and pinned margin previews.
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
   *  "open page" chrome glyph can route to the §5 decision detail page. */
  onNavigate?: (slug: string) => void;
}

export function AstraAppendix({ node, width, onNavigate }: AstraAppendixProps) {
  if (!node) return null;

  const decisions = node.decisions ?? [];
  const findings = node.findings ?? [];
  const inputs = node.inputs ?? [];
  const outputs = node.outputs ?? [];

  if (
    decisions.length === 0 &&
    findings.length === 0 &&
    inputs.length === 0 &&
    outputs.length === 0
  ) {
    return null;
  }

  // Cards must be at least this wide for pretext to lay text cleanly —
  // mirrors the minimum used by WorkspaceAnatomy's canvas path.
  const cardWidth = Math.max(200, width);

  return (
    <aside
      id="astra-appendix"
      className="astra-appendix"
      aria-label="ASTRA appendix"
    >
      <div className="astra-appendix__divider">
        <span className="astra-appendix__divider-label">astra</span>
      </div>

      {decisions.length > 0 && (
        <section id="astra-appendix-decisions" className="astra-appendix__section">
          <h3 className="astra-appendix__heading">
            Decisions <span className="astra-appendix__count">{decisions.length}</span>
          </h3>
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
        </section>
      )}

      {findings.length > 0 && (
        <section id="astra-appendix-findings" className="astra-appendix__section">
          <h3 className="astra-appendix__heading">
            Insights <span className="astra-appendix__count">{findings.length}</span>
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
                  content={{ type: 'insight', finding, hostSlug: node.slug, hostNode: node }}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {inputs.length > 0 && (
        <section id="astra-appendix-inputs" className="astra-appendix__section">
          <h3 className="astra-appendix__heading">
            Inputs <span className="astra-appendix__count">{inputs.length}</span>
          </h3>
          <div className="astra-appendix__stack">
            {inputs.map((input) => (
              <div
                key={input.id}
                id={`astra-input-${input.id}`}
                className="astra-appendix__item"
              >
                <Card
                  width={cardWidth}
                  content={{ type: 'input', input, hostNode: node }}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {outputs.length > 0 && (
        <section id="astra-appendix-outputs" className="astra-appendix__section">
          <h3 className="astra-appendix__heading">
            Outputs <span className="astra-appendix__count">{outputs.length}</span>
          </h3>
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
        </section>
      )}
    </aside>
  );
}
