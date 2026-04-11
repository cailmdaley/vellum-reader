/**
 * HotReloadListener — dev-only bridge to mystra's file watcher.
 *
 * Mystra already runs a chokidar watcher on `.felt/**\/*.md` and broadcasts
 * `{type: "RELOAD"}` over a WebSocket at `ws://<host>:3100/socket` when a
 * fiber changes. This component listens for those messages and revalidates
 * the current Remix route, so edits on disk appear in the viewer without
 * a manual page refresh.
 *
 * Revalidation (not window.location.reload) preserves scroll position,
 * the active mode tab, and any open tooltips or selection.
 *
 * Only mounts in development. In production there is no mystra to talk to.
 */

import { useEffect, useRef } from 'react';
import { useRevalidator } from '@remix-run/react';

export function HotReloadListener() {
  const revalidator = useRevalidator();
  // Stash the revalidator in a ref so the WS effect can call the latest
  // `revalidate()` without itself depending on the revalidator's (possibly
  // fresh-per-render) object identity. Empty dep array → connect once.
  const revalidatorRef = useRef(revalidator);
  revalidatorRef.current = revalidator;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Dev-only: the dev server runs on 3200 and mystra on 3100.
    // In production vellum serves static content and there is no watcher.
    if (window.location.port !== '3200') return;

    const host = window.location.hostname;
    const port = 3100;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    function connect() {
      if (closed) return;
      ws = new WebSocket(`ws://${host}:${port}/socket`);

      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.type === 'RELOAD') {
            revalidatorRef.current.revalidate();
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.addEventListener('close', () => {
        if (closed) return;
        // Reconnect on drop (mystra restart, network blip).
        reconnectTimer = setTimeout(connect, 1000);
      });

      ws.addEventListener('error', () => {
        ws?.close();
      });
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return null;
}
