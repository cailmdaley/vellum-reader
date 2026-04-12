import { useEffect } from 'react';

export interface ReloadEvent {
  slug?: string;
}

interface HotReloadListenerProps {
  onReload: (event: ReloadEvent) => void;
}

export function HotReloadListener({ onReload }: HotReloadListenerProps) {
  useEffect(() => {
    if (typeof window === 'undefined' || !import.meta.env.DEV) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    function connect() {
      if (closed) return;
      ws = new WebSocket(`${protocol}://${host}/socket`);

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg?.type === 'RELOAD') {
            onReload({ slug: typeof msg.slug === 'string' ? msg.slug : undefined });
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.addEventListener('close', () => {
        if (closed) return;
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
  }, [onReload]);

  return null;
}
