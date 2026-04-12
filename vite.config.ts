import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // CodeMirror + Vim keymap. Only used by FiberEditor, which is
          // imported statically from NarrativeView — so the chunk ships
          // with the reader bundle either way, but keeping it separate
          // lets us reason about the size cleanly and sets up a future
          // dynamic-import split if we ever want it.
          codemirror: [
            '@codemirror/commands',
            '@codemirror/lang-markdown',
            '@codemirror/language',
            '@codemirror/state',
            '@codemirror/view',
            '@replit/codemirror-vim',
          ],
          // d3-* are only used by MapView; separate so the reader-only path
          // doesn't pay for the graph visualization.
          d3: ['d3-force', 'd3-selection', 'd3-zoom'],
          // MyST prose renderer is large enough to warrant its own vendor chunk.
          myst: ['myst-to-react', '@myst-theme/providers'],
        },
      },
    },
  },
  server: {
    port: 3200,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
      '/content': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
      '/astra-graph.json': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
      '/socket': {
        target: 'ws://127.0.0.1:3100',
        ws: true,
      },
    },
  },
});
