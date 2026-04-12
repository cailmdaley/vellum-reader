// The Vite migration drops @myst-theme/site (which pulled Remix peer deps into
// the browser bundle) and reaches straight through myst-to-react for its
// DEFAULT_RENDERERS. @myst-theme/providers stays as a documented straggler:
// myst-to-react itself imports ThemeProvider/ArticleProvider context hooks for
// references, link routing, and renderer lookup, so the package stays on disk
// even though vellum-next owns the shell. See
// .felt/vellum-vite-migration/myst-removal-boundary and myst-theme-remix-peer-deps.
import { ThemeProvider, mergeRenderers } from '@myst-theme/providers';
import { DEFAULT_RENDERERS } from 'myst-to-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import 'react-tweet/theme.css';
import { CardQA } from './pages/CardQA';
import { FiberPage } from './pages/FiberPage';
import { PretextGate } from './pages/PretextGate';
import { TweetEmbedRenderer } from './components/TweetEmbed';
import { DecisionFlipProvider } from './contexts/DecisionFlipContext';

// Custom renderer for the `tweetEmbed` node type produced by tweet-transform.
// Standalone tweet-URL paragraphs are rewritten upstream so the embed is a
// first-class block node, sidestepping the `<div>` inside `<p>` problem.
const vellumRenderers = mergeRenderers(
  [
    DEFAULT_RENDERERS,
    {
      tweetEmbed: TweetEmbedRenderer,
    },
  ],
  true,
);

export default function App() {
  return (
    <ThemeProvider theme={null} setTheme={() => {}} renderers={vellumRenderers}>
      <DecisionFlipProvider>
      <Routes>
        {/* `/` renders the auto-generated index of all top-level fibers */}
        <Route path="/" element={<FiberPage />} />
        {/* Declared before the catch-all so the gate QA surface is reachable;
            see vellum-vite-migration/pretext-refoundation Gate 0. */}
        <Route path="/pretext-gate" element={<PretextGate />} />
        {/* Gate 2 QA surface for the unified Card primitive. Declared
            before the catch-all so the route wins over FiberPage. */}
        <Route path="/card-qa" element={<CardQA />} />
        {/* The `/pretext-narrative/*` alternate route from Gate 1 was deleted
            in step 1 of the pretext refoundation: NarrativeView now hosts
            pretext as the default renderer with a built-in toggle back to
            mystra, so the alt route was no longer carrying its weight. */}
        <Route path="*" element={<FiberPage />} />
      </Routes>
      </DecisionFlipProvider>
    </ThemeProvider>
  );
}
