/**
 * FindingsStepper — single-at-a-time navigator for this fiber's findings.
 *
 * Ported from the DESI BAO paper-view.html prototype (`/Users/cd280747/
 * projects/desi-bao-ui-iteration/paper-view.html` — search `.pv-stepper`
 * and `showFinding`).  Replaces a stack of collapsed finding cards with
 * one slide plus a thin progress rail so the reader sees one claim at a
 * time while keeping the Detection → Precision → Tension position signal.
 *
 * Controls at the top: ◂  [tag marquee] · N / M  ▸
 * Below: a horizontal rail, one dot per finding, a gold fill segment
 * that grows with position, the current dot ringed in gold.
 * Below that: the active finding's full claim + rationale + evidence
 * (including figure-artifact thumbnails, matching Card.tsx's pattern).
 *
 * Click a dot to jump; ArrowLeft / ArrowRight when the stepper has focus.
 * Findings + hostNode are pulled from FindingsContext (provided by
 * NarrativeView); prior_insights are filtered out — the stepper is about
 * first-class findings, not demoted decision-level evidence. See
 * [[vellum-reader/themes-constitution/insights-vs-findings-separation]].
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFindingsContext } from '~/contexts/FindingsContext';
import type { GraphEvidence, GraphFinding, GraphNode } from '~/utils/content-types';

function compactDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Fire the same lightbox event Card.tsx uses so figure clicks feel
 *  consistent across surfaces. */
function openFigureLightbox(
  hostNode: GraphNode,
  evidence: GraphEvidence,
  altText: string,
) {
  const src = `/static/${hostNode.slug}/${evidence.artifact}`;
  const output = hostNode.outputs?.find((o) => o.id === evidence.artifact);
  document.dispatchEvent(
    new CustomEvent('vellum:open-lightbox', {
      detail: {
        images: [{ src, alt: altText, fiberSlug: hostNode.slug, output, hostNode }],
        index: 0,
      },
    }),
  );
}

function EvidenceItem({
  evidence,
  hostNode,
}: {
  evidence: GraphEvidence;
  hostNode?: GraphNode;
}) {
  const doiUrl = evidence.doi ? `https://doi.org/${evidence.doi}` : undefined;

  // Figure-artifact evidence gets a real thumbnail (same recipe as Card.tsx:
  // /static/<hostSlug>/<artifact>), clickable to open the lightbox.
  if (evidence.kind === 'figure' && evidence.artifact && hostNode) {
    const src = `/static/${hostNode.slug}/${evidence.artifact}`;
    const altText =
      evidence.figure?.caption ?? evidence.figure?.label ?? evidence.artifact;
    return (
      <div className="astra-findings-stepper__evidence astra-findings-stepper__evidence--figure">
        <span className="astra-findings-stepper__evidence-kind">figure</span>
        <div className="astra-findings-stepper__evidence-body">
          <button
            type="button"
            className="astra-findings-stepper__thumbnail"
            onClick={(e) => {
              e.stopPropagation();
              openFigureLightbox(hostNode, evidence, altText);
            }}
            title={`Open ${evidence.artifact}`}
          >
            <img
              className="astra-findings-stepper__thumbnail-img"
              src={src}
              alt={altText}
              loading="lazy"
            />
          </button>
          {evidence.figure?.label && (
            <div className="astra-findings-stepper__evidence-caption">
              {evidence.figure.label}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Quote evidence: render the exact passage as pull-quote.
  if (evidence.kind === 'quote' && evidence.quote) {
    return (
      <div className="astra-findings-stepper__evidence">
        <span className="astra-findings-stepper__evidence-kind">quote</span>
        <div className="astra-findings-stepper__evidence-body">
          <blockquote className="astra-findings-stepper__quote">
            “{evidence.quote.exact}”
          </blockquote>
          {doiUrl && (
            <div className="astra-findings-stepper__evidence-meta">
              {evidence.location?.page !== undefined && (
                <>p. {evidence.location.page} · </>
              )}
              <a href={doiUrl} target="_blank" rel="noopener noreferrer">
                {compactDomain(doiUrl)}
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Default: kind + label-ish body line.
  const label =
    evidence.kind === 'figure' && evidence.figure
      ? evidence.figure.label
      : evidence.kind === 'insight'
        ? 'Prior finding'
        : (evidence.artifact ?? evidence.kind);
  return (
    <div className="astra-findings-stepper__evidence">
      <span className="astra-findings-stepper__evidence-kind">{evidence.kind}</span>
      <span className="astra-findings-stepper__evidence-body">
        {label}
        {evidence.location?.page !== undefined && (
          <span className="astra-findings-stepper__evidence-loc">
            {' '}· p. {evidence.location.page}
          </span>
        )}
        {doiUrl && (
          <>
            {' '}·{' '}
            <a href={doiUrl} target="_blank" rel="noopener noreferrer">
              {compactDomain(doiUrl)}
            </a>
          </>
        )}
      </span>
    </div>
  );
}

function EvidenceBlock({
  finding,
  hostNode,
}: {
  finding: GraphFinding;
  hostNode?: GraphNode;
}) {
  const items = finding.evidence ?? [];
  if (items.length === 0) return null;
  return (
    <div className="astra-findings-stepper__evidence-list">
      {items.map((ev) => (
        <EvidenceItem key={ev.id} evidence={ev} hostNode={hostNode} />
      ))}
    </div>
  );
}

export interface FindingsStepperProps {
  /** 'inline' (default) renders in prose flow; 'margin' is a narrower
   *  card-style render suited to the margin column. CSS hook only. */
  variant?: 'inline' | 'margin';
}

export function FindingsStepper({ variant = 'inline' }: FindingsStepperProps) {
  // Stepper only shows first-class findings; prior_insights are demoted
  // to decision-card evidence elsewhere and must not appear here. See
  // the insights-vs-findings fiber for the rationale.
  const { findings: all, hostNode } = useFindingsContext();
  const findings = useMemo(
    () => all.filter((f) => f.kind !== 'prior_insight'),
    [all],
  );

  const [idx, setIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reset to 0 whenever the findings array identity changes
    // (navigating to a different fiber).
    setIdx(0);
  }, [findings]);

  const go = useCallback(
    (next: number) => {
      if (!findings.length) return;
      const clamped = Math.max(0, Math.min(findings.length - 1, next));
      setIdx(clamped);
    },
    [findings.length],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!findings.length) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(idx - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(idx + 1);
      }
    },
    [idx, findings.length, go],
  );

  if (findings.length === 0) return null;

  const f = findings[idx];
  const tag = f.label ?? f.key;
  // Midpoint of active tick: ticks are flex:1, so center of tick i sits
  // at (i + 0.5) / N across the inner track width.
  const fillFrac = findings.length === 1 ? 1 : (idx + 0.5) / findings.length;

  return (
    <div
      className={`astra-findings-stepper astra-findings-stepper--${variant}`}
      // role="group" lifts this from a generic focusable div to a labelled
      // ARIA group. Without a role the stepper announces as just "Findings
      // navigator" with no surrounding context — screen readers don't know
      // it's a coherent widget. group is the right fit: a custom widget
      // bundling prev/next buttons and a finding-index nav, focusable as a
      // unit so onKeyDown can drive ←/→ across the whole stepper.
      role="group"
      tabIndex={0}
      ref={rootRef}
      aria-label="Findings navigator"
      onKeyDown={onKeyDown}
    >
      <div className="astra-findings-stepper__controls">
        <button
          type="button"
          className="astra-findings-stepper__btn astra-findings-stepper__btn--prev"
          aria-label="Previous finding"
          disabled={idx === 0}
          onClick={() => go(idx - 1)}
        >
          ◂
        </button>
        <div className="astra-findings-stepper__marquee">
          <span className="astra-findings-stepper__tag">{tag}</span>
          <span className="astra-findings-stepper__counter">
            {idx + 1} / {findings.length}
          </span>
        </div>
        <button
          type="button"
          className="astra-findings-stepper__btn astra-findings-stepper__btn--next"
          aria-label="Next finding"
          disabled={idx === findings.length - 1}
          onClick={() => go(idx + 1)}
        >
          ▸
        </button>
      </div>
      <nav
        className="astra-findings-stepper__progress"
        aria-label="Finding index"
        style={{ ['--stepper-fill' as any]: String(fillFrac) }}
      >
        {findings.map((item, i) => {
          const dotTag = item.label ?? item.key;
          const cls =
            'astra-findings-stepper__dot' +
            (i === idx ? ' astra-findings-stepper__dot--active' : '') +
            (i < idx ? ' astra-findings-stepper__dot--seen' : '');
          return (
            <button
              key={item.key}
              type="button"
              className={cls}
              aria-label={`Finding ${i + 1}: ${dotTag}`}
              title={dotTag}
              onClick={() => go(i)}
            />
          );
        })}
      </nav>
      <div
        className="astra-findings-stepper__slide"
        role="region"
        aria-live="polite"
      >
        <h3 className="astra-findings-stepper__claim">{f.claim}</h3>
        {f.notes && (
          <p className="astra-findings-stepper__notes">{f.notes}</p>
        )}
        <EvidenceBlock finding={f} hostNode={hostNode} />
      </div>
    </div>
  );
}
