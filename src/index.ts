// Package entry point for external consumers.
// Internal vellum code continues to use relative imports.
// Components and hooks are added here as the portolan integration requires them.

export * from './adapter';
export type {
  Annotation,
  AnnotationAction,
  AnnotationBulkAction,
  AstraGraph,
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
export { FileReader } from './components/FileReader';
export type { FileReaderProps } from './components/FileReader';
export { FileViewerPage } from './pages/FileViewerPage';
export type { FileViewerPageProps } from './pages/FileViewerPage';
export { FileViewerModal } from './components/FileViewerModal';
export type { FileViewerModalProps } from './components/FileViewerModal';
export { WorkspaceMount } from './WorkspaceMount';
export type { WorkspaceMountProps, WorkspaceMountApi } from './WorkspaceMount';
export { FiberCard } from './components/FiberCard';
export type { FiberCardProps } from './components/FiberCard';
export { Card } from './components/Card';
export type { CardContent, CardProps } from './components/Card';
export { AstraPaperView } from './components/astra/AstraPaperView';
export type { AstraPaperViewProps, AstraLayout } from './components/astra/AstraPaperView';
export { AstraPicker } from './components/astra/AstraPicker';
export type { AstraPickerProps, AstraLadderRung } from './components/astra/AstraPicker';
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
