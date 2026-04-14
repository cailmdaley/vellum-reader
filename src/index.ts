// Package entry point for external consumers.
// Internal vellum code continues to use relative imports.
// Components and hooks are added here as the portolan integration requires them.

export * from './adapter';
export type {
  Annotation,
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
export { createLightconeAdapter } from './api';
export { FileReader } from './components/FileReader';
export type { FileReaderProps } from './components/FileReader';
export { FileViewerPage } from './pages/FileViewerPage';
export type { FileViewerPageProps } from './pages/FileViewerPage';
