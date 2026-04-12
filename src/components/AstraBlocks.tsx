/**
 * AstraBlocks — structured ASTRA data rendered below the prose.
 *
 * When a fiber has decisions or findings in the graph, renders them
 * as styled blocks at the bottom of the narrative. Progressive disclosure:
 * glyph in margin → hover tooltip → this full rendering.
 */

import type { GraphNode } from '~/utils/content-types';

interface AstraBlocksProps {
  graphNode?: GraphNode;
}

export function AstraBlocks({ graphNode }: AstraBlocksProps) {
  if (!graphNode?.hasASTRA) return null;

  const decisions = graphNode.decisions ?? [];
  const findings = graphNode.findings ?? [];
  const hasFindingVerdict = graphNode.verdict && (graphNode.findingCount ?? 0) > 0;

  if (decisions.length === 0 && !hasFindingVerdict) return null;

  return (
    <aside id="astra-blocks" className="astra-blocks" aria-label="Structured research data">
      <div className="astra-blocks__divider">
        <span className="astra-blocks__divider-label">astra</span>
      </div>

      {decisions.length > 0 && (
        <section className="astra-section">
          <h3 className="astra-section__heading">
            Decisions
            <span className="astra-section__count">{decisions.length}</span>
          </h3>
          {decisions.map((d) => (
            <div
              key={d.key}
              id={`astra-decision-${d.key}`}
              className="astra-decision"
            >
              <div className="astra-decision__header">
                <span className="astra-decision__glyph">⧖</span>
                <span className="astra-decision__label">{d.label}</span>
              </div>
              {d.selectedLabel && (
                <div className="astra-decision__selected">
                  <span className="astra-decision__selected-arrow">→</span>
                  {d.selectedLabel}
                </div>
              )}
              {d.rationale && (
                <p className="astra-decision__rationale">{d.rationale}</p>
              )}
              {d.excluded && d.excluded.length > 0 && (
                <div className="astra-decision__excluded">
                  {d.excluded.map((ex) => (
                    <div key={ex.key} className="astra-excluded">
                      <span className="astra-excluded__glyph">✕</span>
                      <span className="astra-excluded__label">{ex.label}</span>
                      {ex.reason && (
                        <span className="astra-excluded__reason"> — {ex.reason}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {hasFindingVerdict && (
        <section className="astra-section">
          <h3 className="astra-section__heading">
            Findings
            <span className="astra-section__count">{graphNode.findingCount}</span>
          </h3>
          {findings.length > 0 ? (
            findings.map((f) => (
              <div key={f.key} className="astra-finding">
                <p className="astra-finding__claim">
                  {f.hasEvidence && <span className="astra-finding__evidence-dot" title="Has evidence">●</span>}
                  {f.claim}
                </p>
              </div>
            ))
          ) : (
            <div className="astra-finding">
              <p className="astra-finding__verdict">{graphNode.verdict}</p>
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
