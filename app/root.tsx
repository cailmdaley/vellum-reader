import type { LinksFunction } from '@remix-run/node';
import {
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from '@remix-run/react';
import { ThemeProvider } from '@myst-theme/providers';
import { renderers as defaultRenderers } from '@myst-theme/site';
import vellumCss from '~/styles/vellum.css';
import { ModeProvider } from '~/contexts/ModeContext';
import { HotReloadListener } from '~/components/HotReloadListener';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: vellumCss },
];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {/*
          ThemeProvider installs the MyST renderer registry into React context
          so <MyST /> components downstream can find node renderers. Vellum
          doesn't offer a light/dark toggle, so theme is pinned to null and
          setTheme is a no-op — the required props are there to satisfy the
          provider contract, not to drive a real theme switcher.
        */}
        <ThemeProvider theme={null} setTheme={() => {}} renderers={defaultRenderers}>
          <ModeProvider>
            <Outlet />
            <HotReloadListener />
          </ModeProvider>
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
        <LiveReload />
      </body>
    </html>
  );
}
