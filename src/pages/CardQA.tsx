/**
 * /card-qa — visual QA surface for the unified Card primitive.
 *
 * One page that renders every Card content type (fiber, decision,
 * insight, plot, input, output, myst) at three widths (compact,
 * summary, full). The point is a side-by-side legibility check: if a
 * type feels tacked-on at one width but fine at another, the primitive
 * needs work. Widths are the canonical tier thresholds from Card.tsx —
 * one just below COMPACT_MAX, one mid-summary, one beyond SUMMARY_MAX —
 * so every tier path gets exercised.
 *
 * Data is synthetic. A fiber example is pulled from the graph so the
 * FiberCard path exercises real GraphNode shape; the rest use hand-
 * built objects. No API dependency beyond the graph fetch.
 */

import { useEffect, useState } from 'react';
import { getAstraGraph } from '~/api';
import { Card, type CardContent } from '~/components/Card';
import type { AstraGraph, GraphNode } from '~/utils/content-types';

const WIDTHS: Array<{ px: number; tier: string }> = [
  { px: 240, tier: 'compact' },
  { px: 420, tier: 'summary' },
  { px: 680, tier: 'full' },
];

function buildSamples(fiberNode: GraphNode | null): Array<{ type: string; content: CardContent }> {
  const samples: Array<{ type: string; content: CardContent }> = [];

  if (fiberNode) {
    samples.push({ type: 'fiber', content: { type: 'fiber', node: fiberNode } });
  }

  samples.push({
    type: 'decision',
    content: {
      type: 'decision',
      decision: {
        key: 'qa-decision',
        label: 'Covariance estimator',
        rationale: 'GLASS mocks give us the most realistic non-Gaussian covariance at the multipoles that drive the analysis.',
        selectedKey: 'glass',
        selectedLabel: 'GLASS mocks',
        excluded: [
          { key: 'analytic', label: 'Analytic Gaussian', reason: 'Misses mode coupling from the mask.' },
          { key: 'jackknife', label: 'Jackknife', reason: 'Too noisy at high multipole.' },
        ],
      },
    },
  });

  samples.push({
    type: 'decision-open',
    content: {
      type: 'decision',
      decision: {
        key: 'qa-decision-open',
        label: 'Photo-z binning',
        excluded: [
          { key: 'tomo4', label: '4 tomographic bins' },
          { key: 'tomo6', label: '6 tomographic bins' },
        ],
      },
    },
  });

  samples.push({
    type: 'insight',
    content: {
      type: 'insight',
      finding: {
        key: 'qa-insight',
        claim: 'Posterior is stable under jackknife resampling at all multipoles above ℓ = 50.',
        hasEvidence: true,
      },
    },
  });

  samples.push({
    type: 'plot',
    content: {
      type: 'plot',
      // Placeholder SVG so the QA surface is standalone. Any URL works.
      src: 'data:image/svg+xml;utf8,' + encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 200'>
           <rect width='400' height='200' fill='%23f5f1e8'/>
           <path d='M 20 180 Q 100 40 200 120 T 380 60' stroke='%23b8860b' stroke-width='2' fill='none'/>
           <rect x='0.5' y='0.5' width='399' height='199' fill='none' stroke='%23b8860b' stroke-opacity='0.3'/>
         </svg>`,
      ),
      caption: 'Posterior contours for Ωm and σ8 (DES Y3 × Planck)',
    },
  });

  samples.push({
    type: 'input',
    content: {
      type: 'input',
      label: 'galaxy catalog',
      from: 'catalog:data:build-mocks.galaxy-catalog',
    },
  });

  samples.push({
    type: 'output',
    content: {
      type: 'output',
      label: 'stacked shear profile',
      recipe: 'shear-stacking/run.smk',
    },
  });

  samples.push({
    type: 'myst',
    content: {
      type: 'myst',
      label: 'Note on sign convention',
      body: 'Throughout this section, positive shear corresponds to tangential alignment with the lens centre. DES tables invert this — see Appendix B before cross-comparing.',
    },
  });

  return samples;
}

export function CardQA() {
  const [graph, setGraph] = useState<AstraGraph | null>(null);

  useEffect(() => {
    getAstraGraph()
      .then((g) => setGraph(g))
      .catch(() => setGraph({ nodes: [], links: [] }));
  }, []);

  const fiberNode =
    graph?.nodes.find((n) => n.slug === 'vellum-reader/workspace') ??
    graph?.nodes[0] ??
    null;

  const samples = buildSamples(fiberNode);

  return (
    <div className="card-qa">
      <header className="card-qa__header">
        <h1>Card primitive — gate 2 QA</h1>
        <p>
          Every content type at three widths. Look across rows: the lockup,
          palette, and disclosure rhythm should feel like the same kind of
          object, regardless of content. Look down columns: tier transitions
          (compact → summary → full) should be monotonic — more width adds
          disclosure, never removes it.
        </p>
      </header>

      <table className="card-qa__grid">
        <thead>
          <tr>
            <th scope="col">type</th>
            {WIDTHS.map((w) => (
              <th key={w.px} scope="col">
                {w.tier} · {w.px}px
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {samples.map((sample) => (
            <tr key={sample.type}>
              <th scope="row" className="card-qa__type">{sample.type}</th>
              {WIDTHS.map((w) => (
                <td key={w.px} className="card-qa__cell">
                  <Card content={sample.content} width={w.px} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
