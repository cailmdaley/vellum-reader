/**
 * WorkspaceAnatomy — the right-side content for the Workspace tab.
 *
 * Decomposes a fiber into its ASTRA parts and renders each as a Card.
 * Layout is a simple vertical flow: the fiber's own card at the top,
 * then its decisions, then its findings. Width tracks the canvas pane
 * so each card restages via pretext as the user drags the divider.
 *
 * This is the first surface to exercise the unified Card primitive
 * (`Card.tsx`). When input, output, and myst variants land, they slot
 * into the same flow.
 */

import { useEffect, useState } from 'react';
import type { GraphNode } from '~/utils/content-types';
import { Card } from './Card';

interface WorkspaceAnatomyProps {
  node: GraphNode;
  onNavigate?: (slug: string) => void;
}

/**
 * Read the live `--canvas-width` off :root so cards restage when the
 * divider moves. Subtract the inner padding once so cards don't have
 * to know about it.
 */
function useCanvasInnerWidth(): number {
  const [width, setWidth] = useState<number>(() => readWidth());

  useEffect(() => {
    function onResize() {
      setWidth(readWidth());
    }
    window.addEventListener('resize', onResize);
    // The divider mutates :root's inline style, which doesn't fire any
    // event. Observe style changes directly instead of polling.
    const observer = new MutationObserver(() => setWidth(readWidth()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    return () => {
      window.removeEventListener('resize', onResize);
      observer.disconnect();
    };
  }, []);

  return width;
}

function readWidth(): number {
  if (typeof document === 'undefined') return 400;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--canvas-width');
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 400;
  // 16px padding on each side of .vellum-canvas__inner — keep a few
  // pixels of slack so we don't ride the edge.
  return Math.max(180, n - 36);
}

export function WorkspaceAnatomy({ node, onNavigate }: WorkspaceAnatomyProps) {
  const innerWidth = useCanvasInnerWidth();
  const decisions = node.decisions ?? [];
  const findings = node.findings ?? [];
  const inputs = node.inputs ?? [];
  const outputs = node.outputs ?? [];

  const nothing =
    decisions.length === 0 &&
    findings.length === 0 &&
    inputs.length === 0 &&
    outputs.length === 0;

  return (
    <div className="workspace-anatomy">
      <Card
        width={innerWidth}
        content={{ type: 'fiber', node }}
        onNavigate={onNavigate}
      />

      {decisions.length > 0 && (
        <section className="workspace-anatomy__section">
          {/*
            CSS `text-transform: uppercase` on `.workspace-anatomy__heading`
            propagates into Chrome's accessible-name calc — without an
            explicit override, AT users hear "DECISIONS 1" instead of
            "Decisions, 1". The aria-label uses source case + a comma
            separator before the count so screen-reader pacing matches
            the visual hierarchy. Pattern matches AstraAppendix headings
            (iter29 c2006c0).
          */}
          <h3
            className="workspace-anatomy__heading"
            aria-label={`Decisions, ${decisions.length}`}
          >
            Decisions <span className="workspace-anatomy__count">{decisions.length}</span>
          </h3>
          <div className="workspace-anatomy__stack">
            {decisions.map((decision) => (
              <Card
                key={decision.key}
                width={innerWidth}
                content={{ type: 'decision', decision, hostSlug: node.slug }}
              />
            ))}
          </div>
        </section>
      )}

      {findings.length > 0 && (
        <section className="workspace-anatomy__section">
          <h3
            className="workspace-anatomy__heading"
            aria-label={`Findings, ${findings.length}`}
          >
            Findings <span className="workspace-anatomy__count">{findings.length}</span>
          </h3>
          <div className="workspace-anatomy__stack">
            {findings.map((finding) => (
              <Card
                key={finding.key}
                width={innerWidth}
                content={{ type: 'finding', finding, hostSlug: node.slug, hostNode: node }}
              />
            ))}
          </div>
        </section>
      )}

      {inputs.length > 0 && (
        <section className="workspace-anatomy__section">
          <h3
            className="workspace-anatomy__heading"
            aria-label={`Inputs, ${inputs.length}`}
          >
            Inputs <span className="workspace-anatomy__count">{inputs.length}</span>
          </h3>
          <div className="workspace-anatomy__stack">
            {inputs.map((input) => (
              <Card
                key={input.id}
                width={innerWidth}
                content={{ type: 'input', input, hostNode: node }}
              />
            ))}
          </div>
        </section>
      )}

      {outputs.length > 0 && (
        <section className="workspace-anatomy__section">
          <h3
            className="workspace-anatomy__heading"
            aria-label={`Outputs, ${outputs.length}`}
          >
            Outputs <span className="workspace-anatomy__count">{outputs.length}</span>
          </h3>
          <div className="workspace-anatomy__stack">
            {outputs.map((output) => (
              <Card
                key={output.id}
                width={innerWidth}
                content={{ type: 'output', output, hostNode: node }}
              />
            ))}
          </div>
        </section>
      )}

      {nothing && (
        <p className="workspace-anatomy__empty">
          No ASTRA structure on <em>{node.label}</em> yet.
        </p>
      )}
    </div>
  );
}
