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
export type { WorkspaceMountProps } from './WorkspaceMount';
export { FiberCard } from './components/FiberCard';
export type { FiberCardProps } from './components/FiberCard';
export { Card } from './components/Card';
export type { CardContent, CardProps } from './components/Card';
export { AstraPaperView } from './components/astra/AstraPaperView';
export type { AstraPaperViewProps, AstraLayout } from './components/astra/AstraPaperView';
export { AstraPicker } from './components/astra/AstraPicker';
export type { AstraPickerProps, AstraLadderRung } from './components/astra/AstraPicker';
export type {
  GraphDecision,
  GraphFinding,
  GraphInput,
  GraphOutput,
} from './utils/content-types';
export { findElementForSourceLine } from './components/PretextProse';
