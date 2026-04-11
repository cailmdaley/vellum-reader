/**
 * /pretext-gate — Workspace Gate 1a visual QA surface.
 *
 * Renders one fiber through PretextFiberCard at the six canonical widths
 * from the Workspace constitution (180, 280, 400, 560, 720, 900) so a human
 * can eyeball whether EB Garamond holds editorial quality under pretext's
 * arithmetic wrap at every width.
 *
 * Passes a fiber via `?slug=vellum-reader/workspace` (default). Also exposes
 * a dropdown of known fibers so you can page through candidates quickly.
 *
 * This route exists only for the Gate 1a experiment described in
 * [[vellum-reader/workspace]]. It is safe to delete once the gate passes
 * and the workspace renderer switches to PretextFiberCard for real.
 */

import { json } from '@remix-run/node';
import type { LoaderFunction, V2_MetaFunction } from '@remix-run/node';
import { Form, useLoaderData, useSearchParams } from '@remix-run/react';
import { getFiberContent, getAstraGraph } from '~/utils/content-server';
import type { FiberContent, AstraGraph, GraphNode } from '~/utils/content-types';
import { PretextFiberCard } from '~/components/PretextFiberCard';

interface LoaderData {
  slug: string;
  content: FiberContent | null;
  graph: AstraGraph;
}

// The six canonical widths from the constitution's Gate 1a check.
const GATE_WIDTHS: Array<{ px: number; label: string }> = [
  { px: 180, label: 'narrow · 180px' },
  { px: 280, label: 'compact · 280px' },
  { px: 400, label: 'medium · 400px' },
  { px: 560, label: 'comfortable · 560px' },
  { px: 720, label: 'wide · 720px' },
  { px: 900, label: 'spread · 900px' },
];

const DEFAULT_SLUG = 'vellum-reader/workspace';

export const meta: V2_MetaFunction = () => [{ title: 'Pretext Gate 1a — Vellum' }];

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') || DEFAULT_SLUG;
  const [content, graph] = await Promise.all([
    getFiberContent(slug),
    getAstraGraph(),
  ]);
  return json<LoaderData>({ slug, content, graph });
};

function nodeFromGraph(graph: AstraGraph, slug: string): GraphNode | null {
  return graph.nodes.find((n) => n.slug === slug) ?? null;
}

/**
 * Synthesize a GraphNode from raw FiberContent frontmatter. Used when the
 * requested slug isn't in the ASTRA graph (rare, but happens for orphans).
 */
function synthesizeNode(slug: string, content: FiberContent | null): GraphNode {
  const fm = content?.frontmatter ?? {};
  return {
    id: slug,
    slug,
    label: fm.title ?? slug.split('/').pop() ?? slug,
    status: fm.status ?? 'open',
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    verdict: fm.outcome ?? fm.verdict ?? undefined,
    decisions: [],
    findings: [],
    tempered: fm.tempered ?? false,
  };
}

export default function PretextGate() {
  const { slug, content, graph } = useLoaderData<LoaderData>();
  const [searchParams] = useSearchParams();

  const node = nodeFromGraph(graph, slug) ?? synthesizeNode(slug, content);

  // Offer the graph's fibers as a picker so it's trivial to QA several at once.
  const candidateNodes = [...graph.nodes]
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return (
    <div className="pretext-gate">
      <header className="pretext-gate__header">
        <h1>Pretext Gate 1a</h1>
        <p className="pretext-gate__lede">
          One fiber, six widths. Does EB Garamond hold editorial quality through
          pretext's arithmetic wrap from 180px to 900px?
        </p>
        <Form method="get" className="pretext-gate__picker">
          <label>
            fiber
            <select name="slug" defaultValue={searchParams.get('slug') ?? DEFAULT_SLUG}>
              {candidateNodes.map((n) => (
                <option key={n.slug} value={n.slug}>
                  {n.slug}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">load</button>
        </Form>
        <p className="pretext-gate__current">
          <code>{slug}</code> — {node.label}
        </p>
      </header>

      <section className="pretext-gate__grid">
        {GATE_WIDTHS.map(({ px, label }) => (
          <div key={px} className="pretext-gate__cell">
            <div className="pretext-gate__cell-label">{label}</div>
            <div
              className="pretext-gate__frame"
              style={{ width: `${px}px` }}
            >
              <PretextFiberCard node={node} width={px} widthLabel={label} />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
