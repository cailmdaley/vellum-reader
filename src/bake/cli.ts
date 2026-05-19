#!/usr/bin/env node

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { loadFeltDirectory, resolveFeltRoot, resolveFiberSelector } from './felt-loader.js';
import type { FeltFiber } from './types.js';
import { buildPublicationBundle } from './serialize.js';
import { loadAssetPaths, publicationHtml } from './html.js';
import { runPublish } from './publish.js';

interface BakeOptions {
  slug?: string;
  root?: string;
  depth: number;
  out?: string;
  help: boolean;
}

interface PublishCliOptions {
  slug?: string;
  root?: string;
  depth: number;
  target?: string;
  noPush: boolean;
  message?: string;
  help: boolean;
}

function usage(): string {
  return `Usage:
  vellum-reader bake    <slug> [--root <path>] [--depth N] [--out <dir>]
  vellum-reader publish <slug> [--root <path>] [--depth N] [--target <dir>] [--message <msg>] [--no-push]

Subcommands:
  bake     Bake a fiber and its descendants into a static publication directory.
  publish  Bake into a tapestries repo, refresh shared assets, commit, push, print URL.

Bake options:
  --slug <slug>      Fiber id or unique bare slug to publish.
  --root <path>      Project dir containing .felt/, or the .felt dir itself.
  --depth <n>        1 = root fiber only (default); 0 = all descendants.
  --out <dir>        Publication output directory.

Publish options (in addition to bake's --slug/--root/--depth):
  --target <dir>     Tapestries repo directory. Defaults to $VELLUM_TAPESTRIES_DIR
                     or ~/Documents/projects/tapestries.
  --message <msg>    Commit message. Defaults to "Publish <slug>".
  --no-push          Bake, commit, but do not push. Use to dry-run.

Common:
  -h, --help         Show this help.
`;
}

function parseBakeArgs(args: string[]): BakeOptions {
  const options: BakeOptions = { depth: 1, help: false };
  let positionalSlug: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') { options.help = true; continue; }
    if (arg === '--slug') { options.slug = args[++index]; continue; }
    if (arg === '--root') { options.root = args[++index]; continue; }
    if (arg === '--depth') { options.depth = Number.parseInt(args[++index] ?? '1', 10); continue; }
    if (arg === '--out') { options.out = args[++index]; continue; }
    if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}`);
    positionalSlug ??= arg;
  }

  options.slug ??= positionalSlug;
  return options;
}

function parsePublishArgs(args: string[]): PublishCliOptions {
  const options: PublishCliOptions = { depth: 0, noPush: false, help: false };
  let positionalSlug: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') { options.help = true; continue; }
    if (arg === '--slug') { options.slug = args[++index]; continue; }
    if (arg === '--root') { options.root = args[++index]; continue; }
    if (arg === '--depth') { options.depth = Number.parseInt(args[++index] ?? '0', 10); continue; }
    if (arg === '--target') { options.target = args[++index]; continue; }
    if (arg === '--message' || arg === '-m') { options.message = args[++index]; continue; }
    if (arg === '--no-push') { options.noPush = true; continue; }
    if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}`);
    positionalSlug ??= arg;
  }

  options.slug ??= positionalSlug;
  return options;
}

function defaultOutDir(slug: string): string {
  const cacheRoot = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(cacheRoot, 'vellum-reader', slug);
}

export interface BakeResult {
  rootFiber: FeltFiber;
  outDir: string;
  fiberCount: number;
  stubCount: number;
}

export async function runBake(options: { slug: string; root?: string; depth: number; out: string; includeVellumShell: boolean }): Promise<BakeResult> {
  if (!Number.isInteger(options.depth) || options.depth < 0) {
    throw new Error(`--depth must be a non-negative integer; got ${options.depth}`);
  }

  const feltRoot = resolveFeltRoot(options.root ?? process.cwd());
  const fibers = loadFeltDirectory(feltRoot);
  const rootFiber = resolveFiberSelector(fibers, options.slug);
  const outDir = resolve(options.out);

  const staticIndexPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../dist-static/static.html',
  );
  const assets = await loadAssetPaths(staticIndexPath);

  const bundle = buildPublicationBundle(fibers, rootFiber, { depth: options.depth });
  const html = publicationHtml(bundle.publicationSlug, assets);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  if (options.includeVellumShell) {
    await cp(dirname(staticIndexPath), join(outDir, '_vellum'), { recursive: true });
  }
  await writeFile(join(outDir, 'index.html'), html);
  await writeFile(join(outDir, 'fiber-graph.json'), JSON.stringify(bundle.graph, null, 2));
  await writeFile(join(outDir, 'search-index.json'), JSON.stringify(bundle.search, null, 2));

  for (const content of bundle.contents) {
    const path = join(outDir, 'content', `${content.slug}.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(content, null, 2));
  }

  // Copy HTML companion files referenced by `:::{embed}` directives.
  // Each embed lives under `<outDir>/embeds/<bundle-slug>/<authored-path>` —
  // mirroring the rewritten `src` the renderer reads from FiberContent.mdast.
  for (const embed of bundle.embeds) {
    const dest = join(outDir, embed.destRelative);
    await mkdir(dirname(dest), { recursive: true });
    await cp(embed.sourcePath, dest);
  }

  return {
    rootFiber,
    outDir,
    fiberCount: bundle.contents.length,
    stubCount: bundle.stubs.length,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const first = argv[0];
  const subcommand = first === 'publish' ? 'publish' : 'bake';
  const args = (first === 'bake' || first === 'publish') ? argv.slice(1) : argv;

  if (subcommand === 'publish') {
    const options = parsePublishArgs(args);
    if (options.help || !options.slug) {
      process.stdout.write(usage());
      process.exit(options.help ? 0 : 1);
    }
    await runPublish({
      slug: options.slug,
      root: options.root,
      depth: options.depth,
      target: options.target,
      message: options.message,
      noPush: options.noPush,
    });
    return;
  }

  const options = parseBakeArgs(args);
  if (options.help || !options.slug) {
    process.stdout.write(usage());
    process.exit(options.help ? 0 : 1);
  }
  const result = await runBake({
    slug: options.slug,
    root: options.root,
    depth: options.depth,
    out: options.out ?? defaultOutDir(options.slug),
    includeVellumShell: true,
  });
  console.log(`[vellum-reader bake] source: ${result.rootFiber.id}`);
  console.log(`[vellum-reader bake] output: ${result.outDir}`);
  console.log(`[vellum-reader bake] fibers: ${result.fiberCount}`);
  console.log(`[vellum-reader bake] stubs: ${result.stubCount}`);
}

main().catch((error) => {
  console.error(`[vellum-reader] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
