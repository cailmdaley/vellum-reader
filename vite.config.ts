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
      '/doi-metadata': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
      '/socket': {
        target: 'ws://127.0.0.1:3100',
        ws: true,
      },
      // Twitter's video CDN returns 403 to browser requests (Sec-Fetch-Site
      // cross-site on non-twitter origins). A node-side proxy doesn't send
      // those headers, so the request passes. react-tweet's syndication
      // data carries video.twimg.com URLs; TweetEmbed rewrites them to
      // /twimg-video so the <video> element loads them same-origin.
      '/twimg-video': {
        target: 'https://video.twimg.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/twimg-video/, ''),
        configure: (proxy) => {
          // Twitter's CDN 403s when it sees a non-twitter Origin or
          // cross-site Sec-Fetch-Site. Strip them before forwarding.
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
            proxyReq.removeHeader('sec-fetch-site');
            proxyReq.removeHeader('sec-fetch-mode');
            proxyReq.removeHeader('sec-fetch-dest');
          });
        },
      },
    },
  },
});
