// Package entry point for external consumers.
// Internal vellum code continues to use relative imports.
// Components and hooks are added here as the portolan integration requires them.

export * from './adapter';
export type {
  Annotation,
  AnnotationAction,
  AnnotationBulkAction,
  FiberGraph,
  FiberContent,
  FileContent,
  GraphNode,
  GraphLink,
  HistoryEvent,
  HistoryResponse,
  LogEvent,
  LogResponse,
  RawFiber,
  SearchHit,
} from './utils/content-types';
export {
  AdapterProvider,
  useAdapter,
  useReadOnlyAdapter,
} from './contexts/AdapterContext';
export {
  AnnotationActionsProvider,
  useAnnotationActions,
} from './contexts/AnnotationActionsContext';
export { createLightconeAdapter } from './api';
export { createStaticAdapter, staticSiteBase } from './static-adapter';
export { FileReader } from './components/FileReader';
export type { FileReaderProps } from './components/FileReader';
export { FileViewerPage } from './pages/FileViewerPage';
export type { FileViewerPageProps } from './pages/FileViewerPage';
export { FileViewerModal } from './components/FileViewerModal';
export type { FileViewerModalProps } from './components/FileViewerModal';
export { WorkspaceMount } from './WorkspaceMount';
export type { WorkspaceMountProps, WorkspaceMountApi } from './WorkspaceMount';
// NarrativeView is the single-fiber prose rendering (masthead → outcome →
// report embed → body) without the workspace shell. Exported for hosts that
// mount one fiber as a standalone page — portolan's kanban card-detail
// panel is the canonical consumer (kanban-card-vellum-page constitution).
export { NarrativeView } from './components/NarrativeView';
// TweetEmbedRenderer pairs with NarrativeView for hosts that build their
// own renderer set (NarrativeView's transformTweetEmbeds emits `tweetEmbed`
// nodes that need this renderer registered to display).
export { TweetEmbedRenderer } from './components/TweetEmbed';
export { FiberCard } from './components/FiberCard';
export type { FiberCardProps } from './components/FiberCard';
export { Card } from './components/Card';
export type { CardContent, CardProps } from './components/Card';
export {
  DecisionFlipProvider,
  useDecisionFlip,
} from './contexts/DecisionFlipContext';
export { useMode, type Mode } from './contexts/ModeContext';
// react-router-dom isn't installed in every consumer's node_modules — vellum
// hoists it as a direct dependency. Re-exporting `useNavigate` lets the
// kanban host (rendered inside vellum's MemoryRouter) navigate without
// portolan needing its own react-router install.
export { useNavigate } from 'react-router-dom';
export type {
  GraphDecision,
  GraphFinding,
  GraphInput,
  GraphOutput,
} from './utils/content-types';
export { findElementForSourceLine } from './components/PretextProse';
