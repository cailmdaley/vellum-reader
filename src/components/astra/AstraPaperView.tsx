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
 * Stage 2 (prior revision) wires:
 *   - Inline narrative refs (`[text](#findings.foo)` etc.) that scroll +
 *     flash the targeted anchor — see `AstraProse`.
 *   - Figure outputs render inline `<img>` thumbnails (click → open).
 *   - Table outputs render a small CSV preview when `csvs[resolved_path]`
 *     is provided.
 *   - Sub-analyses render their own narrative + findings inline (not just
 *     a count) so the wiki-format reading surface lands.
 *   - Inline "informs" decision pills under finding evidence, resolved
 *     through `bundle.decisions_by_insight`.
 *
 * Stage 3 (prior revision) — wiki-style backlinks across the bundle's
 * analytical graph:
 *   - `evidence.artifact` is usually an output key (e.g. the BAO bundle's
 *     `bao_detection_significance`), not a file path. When it matches an
 *     entry in `bundle.outputs`, the row renders as an anchor link to
 *     `#astra-output-<key>` and the click scrolls + flashes the output
 *     card — same gesture paper-viewer.js's `openOutputByArtifactKey`
 *     fires for `.pv-modal__artifact-link`. Falls back to the prior
 *     external-file behaviour when the artifact really is a path.
 *   - `output.from` chains to a sub-analysis output (`bao_fitting.final_
 *     distances`) or an input. When the dotted key resolves inside the
 *     bundle, the "← from-key" eyebrow becomes a clickable wiki-link to
 *     that anchor. Mirrors how paper-view's gallery cards drill into
 *     their producing sub.
 *
 * Stage 3 (this revision) — decision-flip overlay:
 *   - DecisionItem options become clickable buttons backed by vellum's
 *     existing `DecisionFlipContext` (the same store the graph-card flow
 *     in `<Card>` already uses). Click an alternative → the decision
 *     card flips to that hypothetical universe; the summary line and
 *     selected-option indicator update; the originally-authored option
 *     gets a small "authored" tag; a reset affordance appears under the
 *     option list. Visual-only, no write-back to felt — same contract
 *     as the graph-card flip: a thought-experiment surface for "what if
 *     the cov decision had been GLASS instead of jackknife?"
 *   - `hostSlug` prop lets the host (FileViewerPage) keyspace flips per
 *     bundle so two astra.yaml's open at once don't collide on identical
 *     decision keys (e.g. both have a `cov` decision). Defaults to the
 *     bundle's title; portolan threads the file path so persisted state
 *     would survive a remount on the same bundle.
 *
 * Stage 3 next: annotation layer (vellum's annotation primitives wired
 * into astra fields via portolan's /annotations).
 * Stage 4 PRs the affordances upstream into `paper-view.html` —
 * decision-flip is a strong candidate (paper-view.html doesn't carry the
 * mechanism today; vellum stages it on the linear rung first).
 *
 * Bundle in, JSX out, no portolan dependency. The host (portolan) glues this
 * into its workspace modal and pin cards via `mountVellumAstraCardSurface` /
 * the FileViewerPage astra-path dispatch in `pages/FileViewerPage.tsx`.
 *
 * See `vellum-reader/vellum-native-astra-renderer`.
 */

import { useCallback, useState } from 'react';
import type {
  Bundle,
  Decision,
  DecisionOption,
  Finding,
  FindingEvidence,
  Input,
  Output,
  PaperMetadata,
} from 'lightcone-ui-core';
import { useDecisionFlip } from '../../contexts/DecisionFlipContext';
import { AstraProse, scrollToAstraAnchor } from './AstraProse';
import { PaperModal } from './PaperModal';

/**
 * Handler the citation row calls when the reader clicks a paper. Opens
 * the in-modal evidence panel (PDF + insights rail) at the corresponding
 * DOI. `focusInsightId` lets the click on a specific insight's row scroll
 * the rail to that row and flash it (mirrors paper-viewer.js's
 * focusInsightId option).
 */
type OpenPaper = (doi: string, focusInsightId?: string | null) => void;

export type AstraLayout = 'linear' | 'personal';

export interface AstraPaperViewProps {
  bundle: Bundle;
  /** Inlined CSV previews keyed by output `resolved_path`. Stage 2 renders a
   *  small head-rows preview underneath table outputs when present. */
  csvs?: Record<string, string>;
  /** Layout flavor. `'linear'` is the staging-ground rung; `'personal'`
   *  expressive divergence layered on top via CSS + small structural tweaks. */
  layout?: AstraLayout;
  /** Resolve an artifact path (project-root-relative as the bundle ships it)
   *  into a host-fetchable URL. Defaults to identity, which works for static
   *  deploys that flatten artifacts under their data root; portolan supplies
   *  a `/project-file/{originId}/...` resolver via the adapter. */
  resolveArtifact?: (artifactPath: string) => string;
  /** Resolve a `cache_key` into a fetchable PDF URL for the in-modal
   *  evidence preview. Defaults to `/papers/<cache_key>/paper.pdf` (the
   *  mount portolan's `HttpApiAstraView.handlePaperPdf` exposes). Static
   *  deploys can override to point at a flattened paper bundle. */
  resolvePaperPdf?: (cacheKey: string) => string;
  /** Stable per-bundle key used as the host slug for `useDecisionFlip`. Two
   *  astra.yaml's open at the same time often share decision keys (e.g.
   *  both have `cov`); without a per-bundle keyspace their flips would
   *  collide. Hosts thread their stable identity for the bundle (file path
   *  in portolan, project slug elsewhere); when omitted, falls back to
   *  `bundle.title` so anonymous mounts still get isolated state. */
  hostSlug?: string;
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
 * Display name for an artifact path. Picks the final path segment so the
 * artifact link reads as `final_distances.csv` instead of the full
 * `/project-file/local/Users/.../final_distances.csv` URL the host adapter
 * resolves to. The full path stays in `href` and `title` so reader tooling
 * (status bar on hover, screen readers describing the link's destination)
 * still sees it. Without this the long monospace URL forced the article
 * column wider than its container at sticky-note card sizes — see card
 * overflow notes in [[vellum-reader/vellum-native-astra-renderer]].
 */
function artifactBasename(path: string): string {
  if (!path) return path;
  // Trim query/fragment; final URL segment is the basename.
  const cleaned = path.split('?')[0].split('#')[0];
  const segments = cleaned.split('/').filter(Boolean);
  return segments[segments.length - 1] || cleaned;
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
  csvs,
  layout = 'linear',
  resolveArtifact = identity,
  resolvePaperPdf,
  hostSlug,
}: AstraPaperViewProps) {
  const decisionsByInsight = bundle.decisions_by_insight ?? {};
  const decisionLabel = (key: string): string =>
    bundle.decisions[key]?.label ?? key;
  // Stable per-bundle key for the decision-flip context. Falls back to the
  // bundle's title (shared across mounts of the same bundle) and finally to
  // a sentinel so `useDecisionFlip` never receives an empty host slug — an
  // empty host short-circuits the override store and silently swallows
  // clicks (the noop branch).
  const flipHostSlug = hostSlug || bundle.title || 'astra-bundle';

  // Paper modal state. Lifted here so a single modal services both the
  // Findings (`<Evidence>`) and the Insights section — opening the modal
  // from either surface goes through the same code path. `null` means
  // closed; a non-null `{doi, focusInsightId}` means open.
  const [openPaper, setOpenPaper] = useState<{
    doi: string;
    focusInsightId: string | null;
  } | null>(null);
  const handleOpenPaper = useCallback<OpenPaper>((doi, focusInsightId) => {
    setOpenPaper({ doi, focusInsightId: focusInsightId ?? null });
  }, []);
  const handleClosePaper = useCallback(() => setOpenPaper(null), []);

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
            <AstraProse text={summary} />
          </Section>
        ) : null;
      })()}
      {(() => {
        const findingsNarrative = narrativeText(bundle.narrative.findings);
        const inputsNarrative = narrativeText(bundle.narrative.inputs);
        const methodsNarrative = narrativeText(bundle.narrative.methods);
        const outputsNarrative = narrativeText(bundle.narrative.outputs);
        return (
          <>
            {bundle.findings.length > 0 && (
              <Section
                heading="Findings"
                id="findings"
                count={bundle.findings.length}
              >
                {findingsNarrative && <AstraProse text={findingsNarrative} />}
                <FindingsList
                  findings={bundle.findings}
                  insights={bundle.insights}
                  papers={bundle.papers}
                  outputs={bundle.outputs}
                  decisionsByInsight={decisionsByInsight}
                  decisionLabel={decisionLabel}
                  resolveArtifact={resolveArtifact}
                  onOpenPaper={handleOpenPaper}
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
                  hostSlug={flipHostSlug}
                />
              </Section>
            )}
            {Object.keys(bundle.inputs).length > 0 && (
              <Section
                heading="Inputs"
                id="inputs"
                count={Object.keys(bundle.inputs).length}
              >
                {inputsNarrative && <AstraProse text={inputsNarrative} />}
                <InputsList inputs={bundle.inputs} />
              </Section>
            )}
            {Object.keys(bundle.insights).length > 0 && (
              <Section
                heading="Insights"
                id="insights"
                count={Object.keys(bundle.insights).length}
              >
                <InsightsList
                  insights={bundle.insights}
                  papers={bundle.papers}
                  decisionsByInsight={decisionsByInsight}
                  decisionLabel={decisionLabel}
                  onOpenPaper={handleOpenPaper}
                />
              </Section>
            )}
            {methodsNarrative && (
              <Section heading="Methods" id="methods">
                <AstraProse text={methodsNarrative} />
              </Section>
            )}
            {Object.keys(bundle.outputs).length > 0 && (
              <Section
                heading="Outputs"
                id="outputs"
                count={bundle.top_output_order.length}
              >
                {outputsNarrative && <AstraProse text={outputsNarrative} />}
                <OutputsList
                  outputs={bundle.outputs}
                  inputs={bundle.inputs}
                  order={bundle.top_output_order}
                  csvs={csvs}
                  resolveArtifact={resolveArtifact}
                />
              </Section>
            )}
            {bundle.sub_order.length > 0 && (
              <Section
                heading="Sub-analyses"
                id="sub-analyses"
                count={bundle.sub_order.length}
              >
                <SubAnalysesList
                  bundle={bundle}
                  csvs={csvs}
                  papers={bundle.papers}
                  decisionsByInsight={decisionsByInsight}
                  decisionLabel={decisionLabel}
                  resolveArtifact={resolveArtifact}
                  onOpenPaper={handleOpenPaper}
                />
              </Section>
            )}
          </>
        );
      })()}
      {openPaper && (
        <PaperModal
          doi={openPaper.doi}
          focusInsightId={openPaper.focusInsightId}
          bundle={bundle}
          resolvePaperPdf={resolvePaperPdf}
          onClose={handleClosePaper}
        />
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

function FindingsList({
  findings,
  insights,
  papers,
  outputs,
  decisionsByInsight,
  decisionLabel,
  resolveArtifact,
  onOpenPaper,
}: {
  findings: Finding[];
  insights: Bundle['insights'];
  papers: Bundle['papers'];
  outputs: Bundle['outputs'];
  decisionsByInsight: Record<string, string[]>;
  decisionLabel: (key: string) => string;
  resolveArtifact: (p: string) => string;
  onOpenPaper: OpenPaper;
}) {
  return (
    <ul className="astra-paper-view__findings">
      {findings.map((f) => (
        <FindingItem
          key={f.id}
          finding={f}
          insights={insights}
          papers={papers}
          outputs={outputs}
          decisionsByInsight={decisionsByInsight}
          decisionLabel={decisionLabel}
          resolveArtifact={resolveArtifact}
          onOpenPaper={onOpenPaper}
        />
      ))}
    </ul>
  );
}

function FindingItem({
  finding,
  insights,
  papers,
  outputs,
  decisionsByInsight,
  decisionLabel,
  resolveArtifact,
  onOpenPaper,
}: {
  finding: Finding;
  insights: Bundle['insights'];
  papers: Bundle['papers'];
  outputs: Bundle['outputs'];
  decisionsByInsight: Record<string, string[]>;
  decisionLabel: (key: string) => string;
  resolveArtifact: (p: string) => string;
  onOpenPaper: OpenPaper;
}) {
  // Aggregate every decision informed by this finding's evidence — paper-
  // view does the same on the insights rail. Dedup so the pill row stays
  // tight when several pieces of evidence point at the same decision.
  const informedDecisions = Array.from(
    new Set(
      finding.evidence.flatMap((e) => decisionsByInsight[e.id] ?? [])
    )
  );
  return (
    <li
      id={`astra-finding-${finding.id}`}
      className="astra-finding"
      data-finding-id={finding.id}
      tabIndex={-1}
    >
      <p className="astra-finding__claim">{finding.claim}</p>
      {finding.notes && <AstraProse text={finding.notes} />}
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
          papers={papers}
          outputs={outputs}
          resolveArtifact={resolveArtifact}
          onOpenPaper={onOpenPaper}
        />
      )}
      {informedDecisions.length > 0 && (
        <DecisionPills
          decisionKeys={informedDecisions}
          decisionLabel={decisionLabel}
        />
      )}
    </li>
  );
}

/**
 * Per-evidence row, mirroring paper-viewer.js's `pv-paper-insight` rail item:
 *
 *   [id] · claim
 *      "quote"
 *      Evidence · page <n>      · cite: <paper title> <doi>
 *      [artifact link]
 *
 * `claim` is the insight's headline (one line, the most readable summary of
 * what was learned); `quote` is the supporting text-quote selector. Both are
 * surfaced when present — `quote` repeats some of `claim` only on rare
 * authoring shapes, and the duplication is informative when it does happen.
 *
 * Page hint and paper citation derive from `Insight.doi` + `Insight.page`
 * and `bundle.papers[doi]`. Today the citation links to `https://doi.org/...`
 * in a new tab; Stage 5 replaces that with an in-modal PDF preview using
 * vellum's PdfReader and an insights-from-this-paper rail.
 */
function Evidence({
  evidence,
  insights,
  papers,
  outputs,
  resolveArtifact,
  onOpenPaper,
}: {
  evidence: FindingEvidence[];
  insights: Bundle['insights'];
  papers: Bundle['papers'];
  outputs: Bundle['outputs'];
  resolveArtifact: (p: string) => string;
  onOpenPaper: OpenPaper;
}) {
  return (
    <ul className="astra-finding__evidence">
      {evidence.map((e) => {
        const insight = insights[e.id];
        return (
          <li key={e.id} className="astra-finding__evidence-item">
            <div className="astra-finding__evidence-head">
              <span className="astra-finding__evidence-id">{e.id}</span>
              {insight?.claim && (
                <span className="astra-finding__evidence-claim">{insight.claim}</span>
              )}
            </div>
            {insight?.quote && (
              <p className="astra-finding__evidence-quote">"{insight.quote}"</p>
            )}
            {(insight?.page != null || insight?.doi) && (
              <PaperCitation
                doi={insight?.doi}
                page={insight?.page}
                paper={insight?.doi ? papers[insight.doi] : undefined}
                insightId={e.id}
                onOpenPaper={onOpenPaper}
              />
            )}
            {e.artifact && (
              <ArtifactLink artifact={e.artifact} outputs={outputs} resolveArtifact={resolveArtifact} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Render `evidence.artifact` as the right kind of link.
 *
 * The field is overloaded in the spec dialect: most analyses use a bare key
 * naming an output (e.g. `bao_detection_significance`), the same way paper-
 * viewer.js's `pv-modal__artifact-link` does. A minority use a relative or
 * already-resolved file path. Discriminate by membership in the bundle's
 * outputs map — when the artifact key resolves, render a within-bundle
 * wiki-link to the output card; otherwise fall through to the prior
 * external-file behaviour. The fall-through still uses `resolveArtifact`
 * so static deploys + portolan's `/project-file/...` rewrites keep working.
 */
function ArtifactLink({
  artifact,
  outputs,
  resolveArtifact,
}: {
  artifact: string;
  outputs: Bundle['outputs'];
  resolveArtifact: (p: string) => string;
}) {
  if (artifact in outputs) {
    return <OutputAnchorLink outputKey={artifact} outputs={outputs} />;
  }
  const url = resolveArtifact(artifact);
  // Bare key would have resolved through the in-bundle wiki-link branch above;
  // here `artifact` is a path or URL fragment, so show the basename and stash
  // the full path in `title` (and the href). Avoids horizontal overflow when
  // long absolute paths land in evidence rows.
  const display = artifactBasename(artifact);
  return (
    <a
      className="astra-finding__evidence-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={artifact}
    >
      {display}
    </a>
  );
}

/**
 * Wiki-link to an output card living in this bundle. Mirrors paper-viewer.js's
 * `openOutputByArtifactKey`: anchor jump to `#astra-output-<key>`, smooth
 * scroll, gold flash. Surfaces the output's type as a small caption so the
 * reader knows whether they're being sent to a figure / table / data product
 * before they click.
 */
function OutputAnchorLink({
  outputKey,
  outputs,
}: {
  outputKey: string;
  outputs: Bundle['outputs'];
}) {
  const out = outputs[outputKey];
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    const ok = scrollToAstraAnchor(`astra-output-${outputKey}`);
    if (ok) event.preventDefault();
  };
  return (
    <a
      className="astra-finding__evidence-link astra-finding__evidence-link--anchor"
      href={`#astra-output-${outputKey}`}
      data-output={outputKey}
      title={
        out
          ? `Jump to output · ${outputKey} (${out.type})`
          : `Jump to output · ${outputKey}`
      }
      onClick={handleClick}
    >
      <span className="astra-finding__evidence-link-glyph" aria-hidden="true">
        →
      </span>
      {outputKey}
      {out && (
        <span className="astra-finding__evidence-link-type">{out.type}</span>
      )}
    </a>
  );
}

/**
 * Paper citation row under evidence. Surfaces the paper title (or DOI when
 * the cache hasn't resolved metadata yet) plus an explicit page hint.
 *
 * Click opens the in-modal evidence panel (PDF + insights rail) — see
 * `<PaperModal>`. The fallback `<a>` to `https://doi.org/<doi>` is kept
 * for `Cmd+click` / middle-click, where the user explicitly asks for the
 * publisher site instead of the modal. Renders nothing when neither doi
 * nor page is present.
 *
 * `insightId` lets the modal open scrolled to a specific insight in the
 * rail (mirrors paper-viewer.js's focusInsightId option). When omitted
 * the modal opens at the top of the rail.
 *
 * `paper.cached` toggles a faint "uncached" marker so the reader can see why
 * a citation lacks a title — `astra papers fetch <doi>` will fill it in.
 * Uncached citations still open the modal; the PDF pane shows a "not in
 * cache" notice and the insights rail still renders.
 */
function PaperCitation({
  doi,
  page,
  paper,
  insightId,
  onOpenPaper,
}: {
  doi?: string;
  page?: number;
  paper?: PaperMetadata;
  insightId?: string | null;
  onOpenPaper: OpenPaper;
}) {
  const title = paper?.title || doi;
  const href = doi ? `https://doi.org/${encodeURIComponent(doi)}` : undefined;
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!doi) return;
    // Cmd/Ctrl/middle-click → let the browser open doi.org in a new tab.
    // Plain click → open the in-modal evidence preview.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    event.preventDefault();
    onOpenPaper(doi, insightId ?? null);
  };
  return (
    <div className="astra-finding__cite">
      {page != null && (
        <span className="astra-finding__cite-page">page&nbsp;{page}</span>
      )}
      {doi && (
        <span className="astra-finding__cite-paper">
          <span className="astra-finding__cite-label">cite</span>
          {href ? (
            <a
              className="astra-finding__cite-link"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={
                paper?.cached
                  ? `Open paper preview · ${doi}`
                  : `Open paper preview · ${doi} (paper not cached locally)`
              }
              aria-label={`Open paper preview for ${title}`}
              onClick={handleClick}
            >
              {title}
            </a>
          ) : (
            <span>{title}</span>
          )}
          {paper && !paper.cached && (
            <span
              className="astra-finding__cite-uncached"
              title="Paper not cached — `astra papers fetch <doi>` to download"
            >
              uncached
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * Inline pills naming every decision this finding's evidence informs.
 * Clicking jumps to the decision card. Mirrors the `mountInsightsRail`
 * "Informs" row in paper-viewer.js, brought into the readable surface
 * rather than tucked behind a paper-modal.
 */
function DecisionPills({
  decisionKeys,
  decisionLabel,
}: {
  decisionKeys: string[];
  decisionLabel: (key: string) => string;
}) {
  return (
    <div className="astra-finding__informs">
      <span className="astra-finding__informs-label">Informs</span>
      <ul className="astra-finding__informs-pills">
        {decisionKeys.map((k) => (
          <li key={k}>
            <a
              className="astra-finding__informs-pill"
              href={`#astra-decision-${k}`}
              data-decision={k}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                if (event.button !== 0) return;
                const ok = scrollToAstraAnchor(`astra-decision-${k}`);
                if (ok) event.preventDefault();
              }}
            >
              {decisionLabel(k)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DecisionsList({
  decisions,
  universeSelections,
  hostSlug,
}: {
  decisions: Record<string, Decision>;
  universeSelections: Record<string, string>;
  hostSlug: string;
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
          hostSlug={hostSlug}
        />
      ))}
    </ul>
  );
}

/**
 * Decision card. Reads the effective option from `useDecisionFlip` so the
 * reader can click an alternative to flip the card into a hypothetical
 * universe where that option won (the same thought-experiment surface the
 * graph-card flow exposes via `<Card>`). The flip is visual only — no
 * write-back to felt — but persists across re-renders within the
 * `<DecisionFlipProvider>` tree the host wraps the surface in (vellum's
 * `WorkspaceMount` provides one for the modal; portolan's
 * `mountVellumFileSurface` provides one per card so flips don't bleed
 * across mounts of unrelated bundles).
 */
function DecisionItem({
  decisionKey,
  decision,
  universePinned,
  hostSlug,
}: {
  decisionKey: string;
  decision: Decision;
  universePinned?: string;
  hostSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const { effectiveKey, isFlipped, setEffective, reset } = useDecisionFlip(
    hostSlug,
    decisionKey,
    decision.selected ?? undefined,
  );
  const effectiveOption = effectiveKey != null
    ? decision.options.find((o) => o.id === effectiveKey)
    : undefined;

  const summaryClass = `astra-decision-card__summary${
    isFlipped ? ' astra-decision-card__summary--flipped' : ''
  }`;

  return (
    <li
      id={`astra-decision-${decisionKey}`}
      className={[
        'astra-decision-card',
        open ? 'astra-decision-card--open' : '',
        isFlipped ? 'astra-decision-card--flipped' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      tabIndex={-1}
    >
      <button
        type="button"
        className={summaryClass}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="astra-decision-card__glyph" aria-hidden="true">
          ◇
        </span>
        <span className="astra-decision-card__label">{decision.label}</span>
        {effectiveOption && (
          <span className="astra-decision-card__selected">
            → {effectiveOption.label}
          </span>
        )}
        {isFlipped && (
          <span
            className="astra-decision-card__flipped-badge"
            title="Showing a hypothetical: click an option to re-flip, or reset to authored."
          >
            flipped
          </span>
        )}
        {universePinned && !decision.selected && !isFlipped && (
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
          {decision.rationale && <AstraProse text={decision.rationale} />}
          <ul
            className="astra-decision-card__options"
            aria-label="Decision options — click to flip the selection"
          >
            {decision.options.map((opt) => (
              <DecisionOptionItem
                key={opt.id}
                option={opt}
                selected={opt.id === effectiveKey}
                authored={opt.id === decision.selected}
                onPick={() => setEffective(opt.id)}
              />
            ))}
          </ul>
          {isFlipped && (
            <button
              type="button"
              className="astra-decision-card__reset"
              onClick={(event) => {
                event.stopPropagation();
                reset();
              }}
              title="Revert to the bundle's authored selection"
            >
              ↺ reset to authored
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Option row inside a decision card. The whole row is a button: clicking
 * it asks the flip context to set this option as the effective selection.
 * The fiber's authored selection wears a tiny "authored" tag when it is
 * not the current effective option, so the reader can see at a glance
 * that they're looking at a hypothetical.
 *
 * The bundle's `DecisionOption` collapses both selected + excluded into
 * a flat shape (no separate `excluded_reason` here, unlike the graph-card
 * `GraphDecision`); rationale lives in `description` and the supporting
 * insight ids — both are surfaced under the option's label so the reader
 * can see why this alternative is or isn't a good pick before clicking.
 */
function DecisionOptionItem({
  option,
  selected,
  authored,
  onPick,
}: {
  option: DecisionOption;
  selected: boolean;
  authored: boolean;
  onPick: () => void;
}) {
  return (
    <li
      className={[
        'astra-decision-option',
        selected ? 'astra-decision-option--selected' : '',
        authored && !selected ? 'astra-decision-option--authored' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="astra-decision-option__btn"
        aria-pressed={selected}
        onClick={(event) => {
          event.stopPropagation();
          onPick();
        }}
      >
        <span className="astra-decision-option__glyph" aria-hidden="true">
          {selected ? '●' : '○'}
        </span>
        <span className="astra-decision-option__label">{option.label}</span>
        {authored && !selected && (
          <span
            className="astra-decision-option__authored-tag"
            title="Originally authored selection"
          >
            authored
          </span>
        )}
        {option.description && (
          <span className="astra-decision-option__description">
            {option.description}
          </span>
        )}
      </button>
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

/**
 * InsightsList — surfaces `bundle.insights` (prior insights cited from
 * external papers) as the readable equivalent of paper-viewer.js's
 * `mountInsightsRail`. Each insight carries a claim, an optional supporting
 * text-quote, a page hint into the source paper, a DOI-linked citation, and
 * the same "Informs <decision>" pill row that lives under findings — so the
 * reader can trace from "what was learned in the literature" back to the
 * decisions that learning justified in this analysis.
 *
 * Anchors `#astra-insight-<id>` are emitted so narrative refs of the form
 * `[label](#insights.<id>)` (resolved by AstraProse) scroll the right row
 * into view. Paper-view.html's renderer didn't ship inline insight refs in
 * its narrative dialect; vellum surfaces them as a forward-compatible
 * extension. PR upstream when the dialect grows.
 */
function InsightsList({
  insights,
  papers,
  decisionsByInsight,
  decisionLabel,
  onOpenPaper,
}: {
  insights: Bundle['insights'];
  papers: Bundle['papers'];
  decisionsByInsight: Record<string, string[]>;
  decisionLabel: (key: string) => string;
  onOpenPaper: OpenPaper;
}) {
  const ids = Object.keys(insights);
  return (
    <ul className="astra-paper-view__insights">
      {ids.map((id) => {
        const ins = insights[id];
        const informedDecisions = decisionsByInsight[id] ?? [];
        return (
          <li
            key={id}
            id={`astra-insight-${id}`}
            className="astra-insight"
            tabIndex={-1}
          >
            <div className="astra-insight__head">
              <span className="astra-insight__id">{id}</span>
              {ins.claim && <span className="astra-insight__claim">{ins.claim}</span>}
            </div>
            {ins.quote && <p className="astra-insight__quote">"{ins.quote}"</p>}
            {(ins.page != null || ins.doi) && (
              <PaperCitation
                doi={ins.doi}
                page={ins.page}
                paper={ins.doi ? papers[ins.doi] : undefined}
                insightId={id}
                onOpenPaper={onOpenPaper}
              />
            )}
            {informedDecisions.length > 0 && (
              <DecisionPills
                decisionKeys={informedDecisions}
                decisionLabel={decisionLabel}
              />
            )}
          </li>
        );
      })}
    </ul>
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
            tabIndex={-1}
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
  inputs,
  order,
  csvs,
  resolveArtifact,
}: {
  outputs: Record<string, Output>;
  inputs: Record<string, Input>;
  order: string[];
  csvs?: Record<string, string>;
  resolveArtifact: (p: string) => string;
}) {
  // Render in spec order for top-level outputs. Sub-analysis-keyed outputs
  // (`<subId>.<outId>`) live under the Sub-analyses section, so we no longer
  // append them at the end of the top-level list — they would have shown up
  // twice otherwise once Stage 2 lit up sub-analysis outputs inline.
  const topKeys = order.filter((id) => id in outputs);
  return (
    <ul className="astra-paper-view__outputs">
      {topKeys.map((key) => (
        <OutputItem
          key={key}
          outputKey={key}
          output={outputs[key]}
          outputs={outputs}
          inputs={inputs}
          csvs={csvs}
          resolveArtifact={resolveArtifact}
        />
      ))}
    </ul>
  );
}

function OutputItem({
  outputKey,
  output,
  outputs,
  inputs,
  csvs,
  resolveArtifact,
}: {
  outputKey: string;
  output: Output;
  outputs: Record<string, Output>;
  inputs: Record<string, Input>;
  csvs?: Record<string, string>;
  resolveArtifact: (p: string) => string;
}) {
  const url = output.resolved_path ? resolveArtifact(output.resolved_path) : null;
  const isFigure = output.type === 'figure';
  const isTable = output.type === 'table';
  const csvText =
    isTable && output.resolved_path && csvs ? csvs[output.resolved_path] : undefined;
  return (
    <li
      id={`astra-output-${outputKey}`}
      className="astra-output"
      data-output-type={output.type}
      tabIndex={-1}
    >
      <div className="astra-output__header">
        <span className="astra-output__id">{outputKey}</span>
        <span className="astra-output__type">{output.type}</span>
        {output.from && (
          <FromChainLink from={output.from} outputs={outputs} inputs={inputs} />
        )}
      </div>
      {output.description && (
        <p className="astra-output__description">{output.description}</p>
      )}
      {isFigure && url && (
        <a
          className="astra-output__figure-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open figure ${outputKey} in a new tab`}
        >
          <img
            className="astra-output__figure-thumb"
            src={url}
            alt={output.description ? `${outputKey}: ${output.description}` : outputKey}
            loading="lazy"
          />
        </a>
      )}
      {isTable && csvText && <CsvPreview csvText={csvText} />}
      {url && (
        <a
          className="astra-output__artifact"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={output.resolved_path ?? undefined}
        >
          {artifactBasename(output.resolved_path ?? url)}
        </a>
      )}
    </li>
  );
}

/**
 * `← producing-key` eyebrow under an output header. The from-chain references
 * either another output (the common case — sub-analyses promote a leaf output
 * up to the top-level surface as `bao_fitting.final_distances` → `final_
 * distances`) or an input (uncommon, but legal). When the dotted key resolves
 * inside this bundle, render a wiki-link to the matching anchor; otherwise
 * keep the prior plain-text behaviour so unmatched provenance still tells the
 * reader where the output came from. Mirrors how paper-view.html's gallery
 * cards drill into producing sub-analyses on click.
 */
function FromChainLink({
  from,
  outputs,
  inputs,
}: {
  from: string;
  outputs: Record<string, Output>;
  inputs: Record<string, Input>;
}) {
  let anchor: string | null = null;
  let kind: 'output' | 'input' | null = null;
  if (from in outputs) {
    anchor = `astra-output-${from}`;
    kind = 'output';
  } else if (from in inputs) {
    anchor = `astra-input-${from}`;
    kind = 'input';
  }
  if (!anchor) {
    return (
      <span className="astra-output__from" title="Derived from">
        ← {from}
      </span>
    );
  }
  const title =
    kind === 'output'
      ? `Jump to producing output · ${from}`
      : `Jump to source input · ${from}`;
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    const ok = scrollToAstraAnchor(anchor!);
    if (ok) event.preventDefault();
  };
  return (
    <a
      className="astra-output__from astra-output__from--link"
      href={`#${anchor}`}
      data-from-kind={kind}
      title={title}
      onClick={handleClick}
    >
      ← {from}
    </a>
  );
}

/**
 * Tiny CSV preview — header + first N rows. Naïve splitter (no quoted-comma
 * handling) is intentional: this is a glanceable preview, not a parser. If
 * the CSV has gnarly fields we want, the click-through artifact link is the
 * source of truth.
 */
function CsvPreview({ csvText, maxRows = 5 }: { csvText: string; maxRows?: number }) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const header = lines[0].split(',');
  const rows = lines.slice(1, 1 + maxRows).map((l) => l.split(','));
  const more = Math.max(0, lines.length - 1 - rows.length);
  return (
    <div className="astra-output__csv">
      <table className="astra-output__csv-table">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 && (
        <p className="astra-output__csv-more">
          +{more} more row{more === 1 ? '' : 's'}
        </p>
      )}
    </div>
  );
}

function SubAnalysesList({
  bundle,
  csvs,
  papers,
  decisionsByInsight,
  decisionLabel,
  resolveArtifact,
  onOpenPaper,
}: {
  bundle: Bundle;
  csvs?: Record<string, string>;
  papers: Bundle['papers'];
  decisionsByInsight: Record<string, string[]>;
  decisionLabel: (key: string) => string;
  resolveArtifact: (p: string) => string;
  onOpenPaper: OpenPaper;
}) {
  return (
    <ul className="astra-paper-view__sub-analyses">
      {bundle.sub_order.map((subId) => {
        const sub = bundle.sub_analyses[subId];
        const findings = bundle.sub_findings[subId] ?? [];
        const subNarrative = bundle.sub_narrative?.[subId] ?? {};
        const summary = narrativeText(subNarrative.summary);
        const findingsNarrative = narrativeText(subNarrative.findings);
        const inputsNarrative = narrativeText(subNarrative.inputs);
        const methodsNarrative = narrativeText(subNarrative.methods);
        const outputsNarrative = narrativeText(subNarrative.outputs);
        // Outputs whose dotted key starts with `<subId>.` belong to this sub.
        // These are the same entries the top-level list used to render twice
        // before Stage 2 — surface them here, where the wiki-format reading
        // surface lives.
        const subOutputKeys = Object.keys(bundle.outputs).filter((k) =>
          k.startsWith(`${subId}.`)
        );
        return (
          <li
            key={subId}
            id={`astra-sub-${subId}`}
            className="astra-sub-analysis"
            tabIndex={-1}
          >
            <header className="astra-sub-analysis__header">
              <span className="astra-sub-analysis__id">{subId}</span>
              {sub.name && <span className="astra-sub-analysis__name">{sub.name}</span>}
            </header>
            {sub.description && (
              <p className="astra-sub-analysis__description">{sub.description}</p>
            )}
            {summary && (
              <SubSection heading="Summary">
                <AstraProse text={summary} />
              </SubSection>
            )}
            {findings.length > 0 && (
              <SubSection
                heading="Findings"
                count={findings.length}
              >
                {findingsNarrative && <AstraProse text={findingsNarrative} />}
                <FindingsList
                  findings={findings}
                  insights={bundle.insights}
                  papers={papers}
                  outputs={bundle.outputs}
                  decisionsByInsight={decisionsByInsight}
                  decisionLabel={decisionLabel}
                  resolveArtifact={resolveArtifact}
                  onOpenPaper={onOpenPaper}
                />
              </SubSection>
            )}
            {inputsNarrative && (
              <SubSection heading="Inputs">
                <AstraProse text={inputsNarrative} />
              </SubSection>
            )}
            {methodsNarrative && (
              <SubSection heading="Methods">
                <AstraProse text={methodsNarrative} />
              </SubSection>
            )}
            {(outputsNarrative || subOutputKeys.length > 0) && (
              <SubSection
                heading="Outputs"
                count={subOutputKeys.length || undefined}
              >
                {outputsNarrative && <AstraProse text={outputsNarrative} />}
                {subOutputKeys.length > 0 && (
                  <ul className="astra-paper-view__outputs">
                    {subOutputKeys.map((key) => (
                      <OutputItem
                        key={key}
                        outputKey={key}
                        output={bundle.outputs[key]}
                        outputs={bundle.outputs}
                        inputs={bundle.inputs}
                        csvs={csvs}
                        resolveArtifact={resolveArtifact}
                      />
                    ))}
                  </ul>
                )}
              </SubSection>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Lightweight section inside a sub-analysis card. Mirrors the look of the
 * top-level Section heading but at one level deeper, so the reader's mental
 * model stays consistent across nesting.
 */
function SubSection({
  heading,
  count,
  children,
}: {
  heading: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="astra-sub-analysis__section">
      <h3 className="astra-sub-analysis__section-heading">
        <span>{heading}</span>
        {typeof count === 'number' && count > 0 && (
          <span className="astra-sub-analysis__section-count" aria-hidden="true">
            {count}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}
