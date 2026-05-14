import { readFile } from 'node:fs/promises';

export interface AssetPaths {
  scriptSrc: string;
  cssHref?: string;
}

export function extractAssetPaths(staticIndexHtml: string): AssetPaths {
  const scriptMatch = staticIndexHtml.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i);
  if (!scriptMatch) {
    throw new Error('Could not find module script in dist-static/static.html');
  }
  const cssMatch = staticIndexHtml.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/i);
  return {
    scriptSrc: scriptMatch[1],
    cssHref: cssMatch?.[1],
  };
}

export async function loadAssetPaths(staticIndexPath: string): Promise<AssetPaths> {
  const html = await readFile(staticIndexPath, 'utf-8').catch((error: NodeJS.ErrnoException) => {
    if (error?.code === 'ENOENT') {
      throw new Error(`${staticIndexPath} not found. Run "npm run build:static" first.`);
    }
    throw error;
  });
  return extractAssetPaths(html);
}

/**
 * Per-publication entrypoint. Sets `__VELLUM_STATIC__` so the reader knows
 * which publication it's serving without having to derive from URL. Falls
 * back to relative `./_vellum/...` paths for local file serving.
 */
export function publicationHtml(publicationSlug: string, assets: AssetPaths): string {
  const toLocal = (assetPath: string | undefined): string | undefined => {
    if (!assetPath) return undefined;
    return `.${assetPath.replace(/^\/tapestries/, '')}`;
  };

  const localCss = toLocal(assets.cssHref);
  const localScript = toLocal(assets.scriptSrc)!;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${publicationSlug} — Vellum</title>
    <meta name="description" content="Vellum publication: ${publicationSlug}" />
  </head>
  <body data-publication-root="${publicationSlug}">
    <div id="root"></div>
    <script>
      (() => {
        const deploy = window.location.pathname.startsWith('/tapestries/');
        window.__VELLUM_STATIC__ = {
          siteBase: deploy ? '/tapestries' : '/',
          publicationBase: deploy ? '/tapestries/${publicationSlug}/' : new URL('./', window.location.href).pathname,
        };
        const head = document.head;
        ${localCss ? `const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.crossOrigin = 'anonymous';
        css.href = deploy ? '${assets.cssHref}' : '${localCss}';
        head.appendChild(css);` : ''}
        const script = document.createElement('script');
        script.type = 'module';
        script.crossOrigin = 'anonymous';
        script.src = deploy ? '${assets.scriptSrc}' : '${localScript}';
        head.appendChild(script);
      })();
    </script>
  </body>
</html>
`;
}

/**
 * SPA fallback served by GitHub Pages on any unmatched path. Loads the
 * static reader bundle without specific publication config — the reader
 * derives the publication from URL via `publicationRootFromPath` in
 * `static-adapter.ts`.
 */
export function fallbackHtml(assets: AssetPaths): string {
  const css = assets.cssHref
    ? `\n    <link rel="stylesheet" crossorigin href="${assets.cssHref}">`
    : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vellum</title>
    <script type="module" crossorigin src="${assets.scriptSrc}"></script>${css}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
}
