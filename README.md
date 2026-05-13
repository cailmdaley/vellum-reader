# Vellum

> Vellum — a static reader for felt fibers, rendered MyST, adapter-driven.

<!-- TAPESTRIES_SCREENSHOT: vellum-on-vellum -->

## What it is

Vellum reads a knowledge base written as [felt][felt] fibers — directory-contained
markdown with YAML frontmatter, `[[wikilinks]]`, and project-owned conventions —
and renders it as a readable, navigable surface. Prose lands through [MyST][myst]
so directives, math, footnotes, citations, and embedded figures all work; the
graph of fibers becomes a backlinkable, searchable knowledge web.

Vellum is **adapter-driven**: it knows nothing about how a host stores or serves
its fibers. A host (a local content server, a portolan workspace, a static
tapestry build, a felt-on-Cloudflare deployment) implements the `Adapter`
interface, and Vellum consumes only the data shape. The same reader UI ships
inside an Electron desktop app, inside a development workspace, and as a static
site rendered from a snapshot — without forking the component tree.

[felt]: https://github.com/cailmdaley/felt
[myst]: https://mystmd.org/

## Install

```bash
git clone https://github.com/cailmdaley/vellum-reader.git
cd vellum-reader && npm install
```

To consume vellum-reader from another project, install it as a sibling
checkout and reference it from `package.json`:

```json
{
  "dependencies": {
    "vellum-reader": "file:../vellum-reader"
  }
}
```

`react` and `react-dom` are peer dependencies — install them in the host
app.

## Quick usage

```tsx
import { AdapterProvider, WorkspaceMount, type Adapter } from 'vellum-reader';
import 'vellum-reader/css';

const adapter: Adapter = {
  async getFiberContent(slug) { /* fetch and return a FiberContent */ },
  async getFiberGraph() { /* return { nodes: [...], links: [...] } */ },
  async searchFibers(q) { /* return SearchHit[] */ },
  // ...the rest of the Adapter interface
};

export default function App() {
  return (
    <AdapterProvider adapter={adapter}>
      <WorkspaceMount rootSlug="hello-world" />
    </AdapterProvider>
  );
}
```

The full `Adapter` interface lives in [`src/adapter.ts`](src/adapter.ts) —
return fibers, graphs, annotations, and search hits from whatever backend
you have, and the rest of the reader keeps working.

## Adapter architecture

Vellum draws a tight line between **shape** (what a fiber, a graph, an
annotation, a search hit look like) and **transport** (where the data lives
and how you fetch it). The shape types live in `src/utils/content-types.ts`;
the seam lives in `src/adapter.ts`. Hosts implement the `Adapter` (or the
narrower read-only subset) and inject it through `AdapterProvider`; every
Vellum component reads from `useAdapter()` so the same component tree
serves a live dev workspace, a portolan mount, and a baked static
snapshot. Writes (annotations, frontmatter edits, fiber creation) sit on the
same adapter — read-only hosts throw `ReadOnlyAdapterError` from those
methods and components gate on capability before calling.

## Live demo

A live, vellum-rendered tour of vellum itself will be hosted at
`cailmdaley.github.io/tapestries/vellum-on-vellum/` once the tapestries
publishing pipeline lands. See [`.felt/vellum-on-vellum/`](.felt/vellum-on-vellum/)
for the source fiber.

## License

[MIT](LICENSE)
