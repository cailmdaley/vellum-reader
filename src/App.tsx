// The Vite migration drops @myst-theme/site (which pulled Remix peer deps into
// the browser bundle) and reaches straight through myst-to-react for its
// DEFAULT_RENDERERS. @myst-theme/providers stays as a documented straggler:
// myst-to-react itself imports ThemeProvider/ArticleProvider context hooks for
// references, link routing, and renderer lookup, so the package stays on disk
// even though vellum-next owns the shell. See
// .felt/vellum-vite-migration/myst-removal-boundary and myst-theme-remix-peer-deps.
import { ThemeProvider, mergeRenderers } from '@myst-theme/providers';
import { DEFAULT_RENDERERS, MyST } from 'myst-to-react';
import { createElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import 'react-tweet/theme.css';
import { FiberPage } from './pages/FiberPage';
import { PretextGate } from './pages/PretextGate';
import { TweetEmbedRenderer } from './components/TweetEmbed';
import { DecisionFlipProvider } from './contexts/DecisionFlipContext';
import { VellumThemeProvider } from './contexts/ThemeContext';

// Drop-in heading renderer without myst-to-react's default HashLink
// permalink — we don't need `¶` hash links after every section heading,
// and the default renderer has no prop to suppress it.
const HeadingWithoutHashLink = ({ node, className }: any) => {
  const { depth, key, identifier, html_id, enumerator } = node;
  const id = html_id || identifier || key;
  return createElement(
    `h${depth}`,
    { id, className },
    enumerator ? <span className="mr-3 select-none">{enumerator}</span> : null,
    <span className="heading-text"><MyST ast={node.children} /></span>,
  );
};

// Custom renderer for the `tweetEmbed` node type produced by tweet-transform.
// Standalone tweet-URL paragraphs are rewritten upstream so the embed is a
// first-class block node, sidestepping the `<div>` inside `<p>` problem.
const vellumRenderers = mergeRenderers(
  [
    DEFAULT_RENDERERS,
    {
      tweetEmbed: TweetEmbedRenderer,
      heading: HeadingWithoutHashLink,
    },
  ],
  true,
);

export default function App() {
  return (
    <ThemeProvider theme={null} setTheme={() => {}} renderers={vellumRenderers}>
      <VellumThemeProvider>
      <DecisionFlipProvider>
      <Routes>
        {/* `/` renders the auto-generated index of all top-level fibers */}
        <Route path="/" element={<FiberPage />} />
        {/* QA surface for the pretext renderer at canonical widths.
            Declared before the catch-all so the route wins over FiberPage. */}
        <Route path="/pretext-gate" element={<PretextGate />} />
        <Route path="*" element={<FiberPage />} />
      </Routes>
      </DecisionFlipProvider>
      </VellumThemeProvider>
    </ThemeProvider>
  );
}
