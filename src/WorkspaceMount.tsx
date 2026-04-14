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
}

export function WorkspaceMount({ initialSlug = '' }: WorkspaceMountProps) {
  const initialPath = initialSlug ? `/${initialSlug.replace(/^\/+/, '')}` : '/';
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <ThemeProvider theme={null} setTheme={() => {}} renderers={vellumRenderers}>
        <DecisionFlipProvider>
          <ModeProvider>
            <Routes>
              <Route path="/" element={<FiberPage />} />
              <Route path="*" element={<FiberPage />} />
            </Routes>
          </ModeProvider>
        </DecisionFlipProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}
