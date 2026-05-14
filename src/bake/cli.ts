#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { loadFeltDirectory, resolveFeltRoot, resolveFiberSelector } from './felt-loader.js';
import { buildPublicationBundle } from './serialize.js';

interface CliOptions {
  slug?: string;
  root?: string;
  depth: number;
  out?: string;
  help: boolean;
}

function usage(): string {
  return `Usage:
  vellum-reader bake <slug> [--root <path>] [--depth N] [--out <dir>]
  node dist/bake/cli.js --slug <slug> [--root <path>] [--depth N] [--out <dir>]

Options:
  --slug <slug>   Fiber id or unique bare slug to publish
  --root <path>   Project dir containing .felt/, or the .felt dir itself
  --depth <n>     1 = root fiber only (default); 0 = all descendants
  --out <dir>     Publication output directory
  -h, --help      Show this help
`;
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  if (args[0] === 'bake') args.shift();

  const options: CliOptions = { depth: 1, help: false };
  let positionalSlug: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }
    if (arg === '--slug') {
      options.slug = args[++index];
      continue;
    }
    if (arg === '--root') {
      options.root = args[++index];
      continue;
    }
    if (arg === '--depth') {
      options.depth = Number.parseInt(args[++index] ?? '1', 10);
      continue;
    }
    if (arg === '--out') {
      options.out = args[++index];
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option ${arg}`);
    }
    positionalSlug ??= arg;
  }

  options.slug ??= positionalSlug;
  return options;
}

function defaultOutDir(slug: string): string {
  const cacheRoot = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(cacheRoot, 'vellum-reader', slug);
}

function extractAssetPaths(staticIndexHtml: string): { scriptSrc: string; cssHref?: string } {
  const scriptMatch = staticIndexHtml.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i);
  if (!scriptMatch) {
    throw new Error('Could not find module script in dist-static/index.html');
  }
  const cssMatch = staticIndexHtml.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/i);
  return {
    scriptSrc: scriptMatch[1],
    cssHref: cssMatch?.[1],
  };
}

function publicationHtml(publicationSlug: string, assets: { scriptSrc: string; cssHref?: string }): string {
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.slug) {
    process.stdout.write(usage());
    process.exit(options.help ? 0 : 1);
  }
  if (!Number.isInteger(options.depth) || options.depth < 0) {
    throw new Error(`--depth must be a non-negative integer; got ${options.depth}`);
  }

  const feltRoot = resolveFeltRoot(options.root ?? process.cwd());
  const fibers = loadFeltDirectory(feltRoot);
  const rootFiber = resolveFiberSelector(fibers, options.slug);
  const outDir = resolve(options.out ?? defaultOutDir(rootFiber.slug));

  const staticIndexPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../dist-static/static.html',
  );
  const staticIndexHtml = await readFile(staticIndexPath, 'utf-8').catch((error: NodeJS.ErrnoException) => {
    if (error?.code === 'ENOENT') {
      throw new Error('dist-static/static.html not found. Run "npm run build:static" first.');
    }
    throw error;
  });
  const assets = extractAssetPaths(staticIndexHtml);

  const bundle = buildPublicationBundle(fibers, rootFiber, { depth: options.depth });
  const html = publicationHtml(bundle.publicationSlug, assets);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(dirname(staticIndexPath), join(outDir, '_vellum'), { recursive: true });
  await writeFile(join(outDir, 'index.html'), html);
  await writeFile(join(outDir, 'fiber-graph.json'), JSON.stringify(bundle.graph, null, 2));
  await writeFile(join(outDir, 'search-index.json'), JSON.stringify(bundle.search, null, 2));

  for (const content of bundle.contents) {
    const path = join(outDir, 'content', `${content.slug}.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(content, null, 2));
  }

  console.log(`[vellum-reader bake] source: ${rootFiber.id}`);
  console.log(`[vellum-reader bake] output: ${outDir}`);
  console.log(`[vellum-reader bake] fibers: ${bundle.contents.length}`);
  console.log(`[vellum-reader bake] stubs: ${bundle.stubs.length}`);
}

main().catch((error) => {
  console.error(`[vellum-reader bake] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
