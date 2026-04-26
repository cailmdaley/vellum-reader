/**
 * AstraPaperView — vellum-native render of a lightcone paper-view Bundle.
 *
 * Sibling to `paper-view.html` from `lightcone-ui-core/templates`: same data,
 * different rendering pipeline. The iframe path stays the canonical reference;
 * this is the staging ground for affordances that we want to PR back upstream
 * once they feel right.
 *
 * Two layouts under one component (the ladder's "linear" and "personal" rungs).
 * "linear" mirrors paper-view's column shape — single centered column, paper
 * masthead, executive summary, findings list, decisions, inputs, outputs.
 * "personal" today renders the same content with extra room for vellum-only
 * affordances (annotation overlays, decision-flip, expressive type) — the
 * structural divergence lives in CSS at `:root[data-astra-layout="personal"]`
 * and grows over iterations.
 *
 * No interactivity beyond expand/collapse of decision/output cards in Stage 1.
 * Stage 2 lands inline evidence references, decision-pill popovers, figure
 * thumbnails. Stage 3 lands annotation layer + decision-flip overlay. Stage 4
 * PRs the affordances upstream into `paper-view.html`.
 *
 * Bundle in, JSX out, no portolan dependency. The host (portolan) glues this
 * into its workspace modal and pin cards via `mountVellumAstraCardSurface` /
 * the FileViewerPage astra-path dispatch in `pages/FileViewerPage.tsx`.
 *
 * See `vellum-reader/vellum-native-astra-renderer`.
 */

import { useState } from 'react';
import type {
  Bundle,
  Decision,
  DecisionOption,
  Finding,
  FindingEvidence,
  Input,
  Output,
} from 'lightcone-ui-core';

export type AstraLayout = 'linear' | 'personal';

export interface AstraPaperViewProps {
  bundle: Bundle;
  /** Inlined CSV previews keyed by output `resolved_path`. Optional today —
   *  Stage 2 wires the table outputs to them. */
  csvs?: Record<string, string>;
  /** Layout flavor. `'linear'` is the staging-ground rung; `'personal'`
   *  expressive divergence layered on top via CSS + small structural tweaks. */
  layout?: AstraLayout;
  /** Resolve an artifact path (project-root-relative as the bundle ships it)
   *  into a host-fetchable URL. Defaults to identity, which works for static
   *  deploys that flatten artifacts under their data root; portolan supplies
   *  a `/project-file/{originId}/...` resolver via the adapter. */
  resolveArtifact?: (artifactPath: string) => string;
}

/**
 * Default no-op resolver: artifact paths flow through unchanged. Portolan's
 * `/astra-bundle` endpoint already rewrites artifact paths to
 * `/project-file/...` URLs server-side, so the bundle handed to vellum is
 * already host-resolvable. The resolver is kept as a prop for future hosts
 * that need to remap (static export, alternative origin).
 */
function identity(p: string): string {
  return p;
}

/**
 * `ASTRANarrativeSection` is `string | { content: string }`. Coerce to a
 * plain string so the renderer doesn't have to branch at every call site.
 */
function narrativeText(section: string | { content: string } | undefined): string {
  if (!section) return '';
  return typeof section === 'string' ? section : section.content;
}

export function AstraPaperView({
  bundle,
  csvs: _csvs,
  layout = 'linear',
  resolveArtifact = identity,
}: AstraPaperViewProps) {
  return (
    <article
      className={`astra-paper-view astra-paper-view--${layout}`}
      data-astra-layout={layout}
      aria-label={bundle.title ? `Astra paper view: ${bundle.title}` : 'Astra paper view'}
    >
      <Masthead bundle={bundle} />
      {(() => {
        const summary = narrativeText(bundle.narrative.summary);
        return summary ? (
          <Section heading="Summary" id="summary">
            <Prose text={summary} />
          </Section>
        ) : null;
      })()}
      {bundle.findings.length > 0 && (
        <Section heading="Findings" id="findings" count={bundle.findings.length}>
          <FindingsList
            findings={bundle.findings}
            insights={bundle.insights}
            resolveArtifact={resolveArtifact}
          />
        </Section>
      )}
      {Object.keys(bundle.decisions).length > 0 && (
        <Section
          heading="Decisions"
          id="decisions"
          count={Object.keys(bundle.decisions).length}
        >
          <DecisionsList
            decisions={bundle.decisions}
            universeSelections={bundle.universe_selections}
          />
        </Section>
      )}
      {Object.keys(bundle.inputs).length > 0 && (
        <Section heading="Inputs" id="inputs" count={Object.keys(bundle.inputs).length}>
          <InputsList inputs={bundle.inputs} />
        </Section>
      )}
      {Object.keys(bundle.outputs).length > 0 && (
        <Section heading="Outputs" id="outputs" count={bundle.top_output_order.length}>
          <OutputsList
            outputs={bundle.outputs}
            order={bundle.top_output_order}
            resolveArtifact={resolveArtifact}
          />
        </Section>
      )}
      {bundle.sub_order.length > 0 && (
        <Section heading="Sub-analyses" id="sub-analyses" count={bundle.sub_order.length}>
          <SubAnalysesList bundle={bundle} resolveArtifact={resolveArtifact} />
        </Section>
      )}
    </article>
  );
}

function Masthead({ bundle }: { bundle: Bundle }) {
  return (
    <header className="astra-paper-view__masthead">
      {bundle.title && <h1 className="astra-paper-view__title">{bundle.title}</h1>}
      {bundle.authors.length > 0 && (
        <p className="astra-paper-view__authors">{bundle.authors.join(', ')}</p>
      )}
      {(bundle.universe || bundle.tags.length > 0) && (
        <div className="astra-paper-view__meta">
          {bundle.universe && (
            <span className="astra-paper-view__universe" title="Active universe">
              {bundle.universe}
            </span>
          )}
          {bundle.tags.length > 0 && (
            <ul className="astra-paper-view__tags">
              {bundle.tags.map((tag) => (
                <li key={tag} className="astra-paper-view__tag">
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </header>
  );
}

function Section({
  heading,
  id,
  count,
  children,
}: {
  heading: string;
  id: string;
  count?: number;
  children: React.ReactNode;
}) {
  const headingId = `astra-paper-view__section-${id}`;
  return (
    <section className="astra-paper-view__section" aria-labelledby={headingId}>
      <h2 id={headingId} className="astra-paper-view__section-heading">
        <span>{heading}</span>
        {typeof count === 'number' && count > 0 && (
          <span className="astra-paper-view__section-count" aria-hidden="true">
            {count}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

/**
 * Render free-form prose. Today: paragraph-split on blank lines, no markdown.
 * Stage 2 pipes this through PretextProse so wikilinks, footnotes, and astra
 * anchors light up. Kept naive for Stage 1 so the bundle render lands today.
 */
function Prose({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const paras = trimmed.split(/\n{2,}/);
  return (
    <div className="astra-paper-view__prose">
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function FindingsList({
  findings,
  insights,
  resolveArtifact,
}: {
  findings: Finding[];
  insights: Bundle['insights'];
  resolveArtifact: (p: string) => string;
}) {
  return (
    <ul className="astra-paper-view__findings">
      {findings.map((f) => (
        <FindingItem
          key={f.id}
          finding={f}
          insights={insights}
          resolveArtifact={resolveArtifact}
        />
      ))}
    </ul>
  );
}

function FindingItem({
  finding,
  insights,
  resolveArtifact,
}: {
  finding: Finding;
  insights: Bundle['insights'];
  resolveArtifact: (p: string) => string;
}) {
  return (
    <li
      id={`astra-finding-${finding.id}`}
      className="astra-finding"
      data-finding-id={finding.id}
    >
      <p className="astra-finding__claim">{finding.claim}</p>
      {finding.notes && <Prose text={finding.notes} />}
      {finding.tags.length > 0 && (
        <ul className="astra-finding__tags">
          {finding.tags.map((t) => (
            <li key={t} className="astra-finding__tag">
              {t}
            </li>
          ))}
        </ul>
      )}
      {finding.evidence.length > 0 && (
        <Evidence
          evidence={finding.evidence}
          insights={insights}
          resolveArtifact={resolveArtifact}
        />
      )}
    </li>
  );
}

function Evidence({
  evidence,
  insights,
  resolveArtifact,
}: {
  evidence: FindingEvidence[];
  insights: Bundle['insights'];
  resolveArtifact: (p: string) => string;
}) {
  return (
    <ul className="astra-finding__evidence">
      {evidence.map((e) => {
        const insight = insights[e.id];
        const url = e.artifact ? resolveArtifact(e.artifact) : null;
        return (
          <li key={e.id} className="astra-finding__evidence-item">
            <span className="astra-finding__evidence-id">{e.id}</span>
            {insight?.quote && (
              <span className="astra-finding__evidence-quote">"{insight.quote}"</span>
            )}
            {url && (
              <a
                className="astra-finding__evidence-link"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {e.artifact}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DecisionsList({
  decisions,
  universeSelections,
}: {
  decisions: Record<string, Decision>;
  universeSelections: Record<string, string>;
}) {
  const keys = Object.keys(decisions);
  return (
    <ul className="astra-paper-view__decisions">
      {keys.map((key) => (
        <DecisionItem
          key={key}
          decisionKey={key}
          decision={decisions[key]}
          universePinned={universeSelections[key]}
        />
      ))}
    </ul>
  );
}

function DecisionItem({
  decisionKey,
  decision,
  universePinned,
}: {
  decisionKey: string;
  decision: Decision;
  universePinned?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption =
    decision.selected != null
      ? decision.options.find((o) => o.id === decision.selected)
      : undefined;

  return (
    <li
      id={`astra-decision-${decisionKey}`}
      className={`astra-decision-card${open ? ' astra-decision-card--open' : ''}`}
    >
      <button
        type="button"
        className="astra-decision-card__summary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="astra-decision-card__glyph" aria-hidden="true">
          ◇
        </span>
        <span className="astra-decision-card__label">{decision.label}</span>
        {selectedOption && (
          <span className="astra-decision-card__selected">→ {selectedOption.label}</span>
        )}
        {universePinned && !decision.selected && (
          <span className="astra-decision-card__pinned" title="Universe override">
            ◎
          </span>
        )}
      </button>
      {open && (
        <div className="astra-decision-card__body">
          {decision.tags.length > 0 && (
            <ul className="astra-decision-card__tags">
              {decision.tags.map((t) => (
                <li key={t} className="astra-decision-card__tag">
                  {t}
                </li>
              ))}
            </ul>
          )}
          {decision.rationale && <Prose text={decision.rationale} />}
          <ul className="astra-decision-card__options">
            {decision.options.map((opt) => (
              <DecisionOptionItem
                key={opt.id}
                option={opt}
                selected={opt.id === decision.selected}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function DecisionOptionItem({
  option,
  selected,
}: {
  option: DecisionOption;
  selected: boolean;
}) {
  return (
    <li
      className={`astra-decision-option${selected ? ' astra-decision-option--selected' : ''}`}
    >
      <span className="astra-decision-option__label">{option.label}</span>
      {option.description && (
        <span className="astra-decision-option__description">{option.description}</span>
      )}
      {option.insights.length > 0 && (
        <ul className="astra-decision-option__insights" aria-label="Supporting insights">
          {option.insights.map((id) => (
            <li key={id} className="astra-decision-option__insight">
              {id}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function InputsList({ inputs }: { inputs: Record<string, Input> }) {
  const keys = Object.keys(inputs);
  return (
    <ul className="astra-paper-view__inputs">
      {keys.map((id) => {
        const input = inputs[id];
        return (
          <li
            key={id}
            id={`astra-input-${id}`}
            className="astra-input"
            data-input-type={input.type}
          >
            <span className="astra-input__id">{id}</span>
            <span className="astra-input__type">{input.type}</span>
            {input.source && <span className="astra-input__source">{input.source}</span>}
            {input.description && (
              <span className="astra-input__description">{input.description}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function OutputsList({
  outputs,
  order,
  resolveArtifact,
}: {
  outputs: Record<string, Output>;
  order: string[];
  resolveArtifact: (p: string) => string;
}) {
  // Render in spec order for top-level outputs, then any sub-analysis-keyed
  // outputs (`<subId>.<outId>`) appended at the end. The server bundles
  // `top_output_order` only for root-level outputs; sub outputs surface in
  // the Sub-analyses section with their own ordering.
  const topKeys = order.filter((id) => id in outputs);
  const seen = new Set(topKeys);
  const subKeys = Object.keys(outputs).filter((k) => !seen.has(k));
  return (
    <ul className="astra-paper-view__outputs">
      {[...topKeys, ...subKeys].map((key) => (
        <OutputItem
          key={key}
          outputKey={key}
          output={outputs[key]}
          resolveArtifact={resolveArtifact}
        />
      ))}
    </ul>
  );
}

function OutputItem({
  outputKey,
  output,
  resolveArtifact,
}: {
  outputKey: string;
  output: Output;
  resolveArtifact: (p: string) => string;
}) {
  const url = output.resolved_path ? resolveArtifact(output.resolved_path) : null;
  return (
    <li
      id={`astra-output-${outputKey}`}
      className="astra-output"
      data-output-type={output.type}
    >
      <div className="astra-output__header">
        <span className="astra-output__id">{outputKey}</span>
        <span className="astra-output__type">{output.type}</span>
        {output.from && (
          <span className="astra-output__from" title="Derived from input">
            ← {output.from}
          </span>
        )}
      </div>
      {output.description && (
        <p className="astra-output__description">{output.description}</p>
      )}
      {url && (
        <a
          className="astra-output__artifact"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {output.resolved_path}
        </a>
      )}
    </li>
  );
}

function SubAnalysesList({
  bundle,
  resolveArtifact: _resolveArtifact,
}: {
  bundle: Bundle;
  resolveArtifact: (p: string) => string;
}) {
  return (
    <ul className="astra-paper-view__sub-analyses">
      {bundle.sub_order.map((subId) => {
        const sub = bundle.sub_analyses[subId];
        const findings = bundle.sub_findings[subId] ?? [];
        return (
          <li key={subId} className="astra-sub-analysis" id={`astra-sub-${subId}`}>
            <div className="astra-sub-analysis__header">
              <span className="astra-sub-analysis__id">{subId}</span>
              {sub.name && <span className="astra-sub-analysis__name">{sub.name}</span>}
            </div>
            {sub.description && (
              <p className="astra-sub-analysis__description">{sub.description}</p>
            )}
            {findings.length > 0 && (
              <p className="astra-sub-analysis__finding-count">
                {findings.length} finding{findings.length === 1 ? '' : 's'}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
