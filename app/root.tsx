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
        <ThemeProvider renderers={defaultRenderers}>
          <ModeProvider>
            <Outlet />
          </ModeProvider>
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
        <LiveReload />
      </body>
    </html>
  );
}
