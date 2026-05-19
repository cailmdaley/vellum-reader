import type { DirectiveSpec } from 'myst-common';

/**
 * `:::{embed-html} <path>` — embed an HTML companion file from the
 * fiber's directory as an iframe in the rendered narrative. The bake
 * copies the referenced file into the publication bundle and rewrites
 * the path; the renderer mounts an iframe whose height the embedded
 * page communicates back via `postMessage({ type: 'vellum:height', value })`.
 *
 * The directive name is `embed-html` (not `embed`) to avoid colliding
 * with MyST's built-in `embed` directive, which is for cross-reference
 * embedding of other AST nodes.
 *
 * Example:
 *   :::{embed-html} vision.html
 *   :::
 *
 *   :::{embed-html} interactive.html
 *   :height: 600
 *   :title: Multiverse comparison
 *   :::
 *
 * The path is interpreted relative to the fiber's directory (the
 * directory containing the fiber's markdown file). At parse time the
 * emitted `htmlEmbed` node's `src` carries the authored path verbatim;
 * the bake's `rewriteEmbeds` pass rewrites it to the bundle-relative
 * URL it will have after publication.
 */
export const embedDirective: DirectiveSpec = {
  name: 'embed-html',
  alias: ['htmlembed', 'html-embed'],
  doc: 'Embed an HTML companion file from the fiber directory as an iframe.',
  arg: {
    type: String,
    required: true,
    doc: 'Relative path to the HTML file in the fiber directory.',
  },
  options: {
    height: {
      type: Number,
      doc: 'Initial iframe height in pixels before postMessage auto-resize.',
    },
    title: {
      type: String,
      doc: 'Accessibility label for the iframe.',
    },
  },
  run(data) {
    const src = typeof data.arg === 'string' ? data.arg.trim() : '';
    if (!src) return [];
    const options = (data.options ?? {}) as { height?: number; title?: string };
    const node: any = { type: 'htmlEmbed', src };
    if (typeof options.height === 'number') node.height = options.height;
    if (typeof options.title === 'string') node.title = options.title;
    return [node];
  },
};
