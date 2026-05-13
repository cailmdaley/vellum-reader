/**
 * StructuredBlocks — structured structured data rendered below the prose.
 *
 * When a fiber has decisions or findings in the graph, renders them
 * as styled blocks at the bottom of the narrative. Progressive disclosure:
 * glyph in margin → hover tooltip → this full rendering.
 */

import type { GraphNode } from '~/utils/content-types';

interface StructuredBlocksProps {
  graphNode?: GraphNode;
}

export function StructuredBlocks({ graphNode }: StructuredBlocksProps) {
  if (!graphNode?.hasStructuredData) return null;

  const decisions = graphNode.decisions ?? [];
  const findings = graphNode.findings ?? [];
  const hasFindingVerdict = graphNode.verdict && (graphNode.findingCount ?? 0) > 0;

  if (decisions.length === 0 && !hasFindingVerdict) return null;

  return (
    <aside id="structured-blocks" className="structured-blocks" aria-label="Structured research data">
      <div className="structured-blocks__divider">
        <span className="structured-blocks__divider-label">structured</span>
      </div>

      {decisions.length > 0 && (
        <section className="structured-section">
          <h3 className="structured-section__heading">
            Decisions
            <span className="structured-section__count">{decisions.length}</span>
          </h3>
          {decisions.map((d) => (
            <div
              key={d.key}
              id={`structured-decision-${d.key}`}
              className="structured-decision"
            >
              <div className="structured-decision__header">
                <span className="structured-decision__glyph">◇</span>
                <span className="structured-decision__label">{d.label}</span>
              </div>
              {d.selectedLabel && (
                <div className="structured-decision__selected">
                  <span className="structured-decision__selected-arrow">→</span>
                  {d.selectedLabel}
                </div>
              )}
              {d.rationale && (
                <p className="structured-decision__rationale">{d.rationale}</p>
              )}
              {d.excluded && d.excluded.length > 0 && (
                <div className="structured-decision__excluded">
                  {d.excluded.map((ex) => (
                    <div key={ex.key} className="structured-excluded">
                      <span className="structured-excluded__glyph">✕</span>
                      <span className="structured-excluded__label">{ex.label}</span>
                      {ex.reason && (
                        <span className="structured-excluded__reason"> — {ex.reason}</span>
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
        <section className="structured-section">
          <h3 className="structured-section__heading">
            Findings
            <span className="structured-section__count">{graphNode.findingCount}</span>
          </h3>
          {findings.length > 0 ? (
            findings.map((f) => (
              <div
                key={f.key}
                id={`structured-finding-${f.key}`}
                className="structured-finding"
              >
                <p className="structured-finding__claim">
                  {f.hasEvidence && <span className="structured-finding__evidence-dot" title="Has evidence">●</span>}
                  {f.claim}
                </p>
              </div>
            ))
          ) : (
            <div className="structured-finding">
              <p className="structured-finding__verdict">{graphNode.verdict}</p>
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
