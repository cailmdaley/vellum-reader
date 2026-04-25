// WorkspaceMount — embeddable FiberPage shell for external hosts.
//
// Mirrors App.tsx's provider stack but carries its own MemoryRouter + ModeProvider
// so the host doesn't need to know about routing. AdapterProvider stays outside:
// the host owns its adapter (e.g. portolan's PortolanAdapter).
//
// Host usage:
//   <AdapterProvider adapter={portolanAdapter}>
//     <WorkspaceMount initialSlug="portolan/portolan" />
//   </AdapterProvider>
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider, mergeRenderers } from '@myst-theme/providers';
import { DEFAULT_RENDERERS } from 'myst-to-react';
import 'react-tweet/theme.css';
import { FiberPage } from './pages/FiberPage';
import { TweetEmbedRenderer } from './components/TweetEmbed';
import { CollectionProvider } from './contexts/CollectionContext';
import { DecisionFlipProvider } from './contexts/DecisionFlipContext';
import { ModeProvider } from './contexts/ModeContext';

const vellumRenderers = mergeRenderers(
  [
    DEFAULT_RENDERERS,
    {
      tweetEmbed: TweetEmbedRenderer,
    },
  ],
  true,
);

export interface WorkspaceMountProps {
  initialSlug?: string;
  /** Optional eyebrow above the IndexView title — typically the host's
   *  collection or city name. Threaded through ModeProvider via context so
   *  FiberPage can hand it to IndexView without a prop chain through every
   *  view. Omit to leave the eyebrow blank. */
  eyebrow?: string;
}

export function WorkspaceMount({ initialSlug = '', eyebrow }: WorkspaceMountProps) {
  const initialPath = initialSlug ? `/${initialSlug.replace(/^\/+/, '')}` : '/';
  return (
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ThemeProvider theme={null} setTheme={() => {}} renderers={vellumRenderers}>
        <CollectionProvider eyebrow={eyebrow}>
          <DecisionFlipProvider>
            <ModeProvider>
              <Routes>
                <Route path="/" element={<FiberPage />} />
                <Route path="*" element={<FiberPage />} />
              </Routes>
            </ModeProvider>
          </DecisionFlipProvider>
        </CollectionProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}
