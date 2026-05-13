---
name: Vellum on Vellum
status: open
tags:
  - vellum
  - reader
  - introduction
outcome: |-
  A self-referential introduction to Vellum, rendered by Vellum. The fiber
  this README's screenshot is captured against; the first thing the
  tapestries pipeline ever publishes.
---

# Vellum on Vellum

This is a fiber.

It lives at `.felt/vellum-on-vellum/vellum-on-vellum.md` inside the
[`vellum-reader`][repo] repo, as a markdown file with YAML frontmatter, a
short body, and a [`[[wikilink]]`][felt] or two. A content server reads it
from disk; an adapter passes it to Vellum; Vellum renders it through
[MyST][myst], so directives and math and footnotes [^1] all just work.

You are reading the rendered version of this very file. That is the joke,
and also the test: anything the reader is capable of showing, this fiber
should exercise.

## What Vellum is

A static reader for **felt** fibers.

- **felt** is the substrate: directory-contained markdown, `[[wikilinks]]`,
  proactive filing, retroactive extraction.
- **Vellum** is the surface: an adapter-driven React reader that consumes
  whatever data shape a host provides and renders fibers as a navigable,
  backlink-aware, MyST-rendered web.

The line between them is deliberate. Felt doesn't care how its fibers are
shown; Vellum doesn't care where the fibers come from. The seam is the
adapter.

## The adapter idea

Vellum's reader components never `fetch` directly. They call methods on an
`Adapter` injected through React context:

```ts
interface Adapter {
  getFiberContent(slug: string): Promise<FiberContent | null>;
  getFiberGraph(): Promise<FiberGraph>;
  searchFibers(query: string): Promise<SearchHit[]>;
  // ...annotations, history, raw fiber edits, etc.
}
```

A local dev server implements one Adapter. A portolan workspace implements
another. A static tapestry — a snapshot of fibers baked into HTML+JSON for
GitHub Pages — implements a read-only Adapter that throws on writes. The
same component tree powers all three.

That symmetry is what makes Vellum cheap to embed and cheap to deploy.

## MyST as the rendering substrate

A fiber's body is MyST-flavored markdown. Vellum runs it through
[`myst-to-react`][myst-to-react] so:

```myst
:::{note}
Directives compose. Math like $E = mc^2$ and footnote refs [^1] render
through the same pipeline. Figures and tables are first-class.
:::
```

…actually renders. The reader's prose surface inherits the entire MyST
ecosystem rather than reimplementing a subset.

## The tapestries story

A **tapestry** is a frozen, public, addressable rendering of one fiber (or
a small allowlist) — baked to static HTML and JSON, served from GitHub
Pages, viewable without the development stack running. The
[`constitution-tapestries-publish`][tapestries] sibling defines how
tapestries get built and shipped; once it lands, this fiber becomes the
first one published, at `cailmdaley.github.io/tapestries/vellum-on-vellum/`,
and its screenshot replaces the placeholder at the top of the [README].

[repo]: https://github.com/cailmdaley/vellum-reader
[felt]: https://github.com/cailmdaley/felt
[myst]: https://mystmd.org
[myst-to-react]: https://github.com/jupyter-book/myst-theme
[tapestries]: https://github.com/cailmdaley/vellum-reader
[README]: ../../README.md

[^1]: This is a footnote. It should render at the bottom of the rendered
      page, with a return link.
