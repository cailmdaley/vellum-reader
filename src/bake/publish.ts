import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runBake } from './cli.js';
import { fallbackHtml, loadAssetPaths, publicationHtml } from './html.js';

const exec = promisify(execFile);

export interface PublishOptions {
  slug: string;
  root?: string;
  depth: number;
  target?: string;
  message?: string;
  noPush: boolean;
}

interface PublicationMeta {
  slug: string;
  title: string;
  description?: string;
}

function defaultTargetDir(): string {
  if (process.env.VELLUM_TAPESTRIES_DIR) return process.env.VELLUM_TAPESTRIES_DIR;
  return join(homedir(), 'Documents/projects/tapestries');
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 1024 * 1024 * 64 });
  return stdout.trim();
}

async function gitChanged(cwd: string): Promise<boolean> {
  const status = await git(cwd, 'status', '--porcelain');
  return status.length > 0;
}

interface RemoteInfo {
  owner: string;
  repo: string;
  isUserSite: boolean; // <owner>.github.io repo
}

async function readRemote(cwd: string): Promise<RemoteInfo> {
  const url = await git(cwd, 'config', '--get', 'remote.origin.url').catch(() => '');
  if (!url) throw new Error(`No git remote configured in ${cwd}`);
  // Match git@github.com:owner/repo(.git)? or https://github.com/owner/repo(.git)?
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) throw new Error(`Could not parse GitHub remote: ${url}`);
  const [, owner, repo] = match;
  const isUserSite = repo.toLowerCase() === `${owner.toLowerCase()}.github.io`;
  return { owner, repo, isUserSite };
}

function publicationUrl(remote: RemoteInfo, slug: string): string {
  if (remote.isUserSite) {
    return `https://${remote.repo}/${slug}/`;
  }
  return `https://${remote.owner}.github.io/${remote.repo}/${slug}/`;
}

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => (word[0] ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function displayTitle(rawTitle: string | undefined, slug: string): string {
  if (rawTitle && rawTitle !== slug) return rawTitle;
  return humanizeSlug(slug);
}

function firstSentence(text: string, maxChars = 180): string {
  const cleaned = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  // Prefer to end at a sentence boundary; fall back to a hard cut on a word boundary.
  const sentence = cleaned.match(/^.{20,}?[.!?](?=\s|$)/);
  const candidate = sentence ? sentence[0] : cleaned;
  if (candidate.length <= maxChars) return candidate;
  const trimmed = candidate.slice(0, maxChars);
  const lastSpace = trimmed.lastIndexOf(' ');
  return (lastSpace > 60 ? trimmed.slice(0, lastSpace) : trimmed).replace(/[,;:\s]+$/, '') + '…';
}

async function readPublicationMeta(publicationDir: string, slug: string): Promise<PublicationMeta | null> {
  const graphPath = join(publicationDir, 'fiber-graph.json');
  if (!existsSync(graphPath)) return null;
  try {
    const graph = JSON.parse(await readFile(graphPath, 'utf-8'));
    const rootNode = graph.nodes?.find((n: { slug?: string }) => n.slug === slug) ?? graph.nodes?.[0];
    if (!rootNode) return null;
    return {
      slug,
      title: displayTitle(rootNode.label, slug),
      description: rootNode.verdict ? firstSentence(rootNode.verdict) : undefined,
    };
  } catch {
    return null;
  }
}

async function collectPublications(targetDir: string): Promise<PublicationMeta[]> {
  const entries = await readdir(targetDir, { withFileTypes: true });
  const out: PublicationMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === '_vellum' || entry.name === 'node_modules') continue;
    const indexPath = join(targetDir, entry.name, 'index.html');
    if (!existsSync(indexPath)) continue;
    const meta = await readPublicationMeta(join(targetDir, entry.name), entry.name);
    if (meta) out.push(meta);
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderIndexHtml(publications: PublicationMeta[]): string {
  const items = publications
    .map((pub) => {
      const desc = pub.description ? `\n            <span class="desc">${escapeHtml(pub.description)}</span>` : '';
      return `        <li>
          <a class="card" href="./${pub.slug}/">
            <span class="title">${escapeHtml(pub.title)}</span>${desc}
          </a>
        </li>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tapestries</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f1e7;
        --ink: #2a2218;
        --muted: #6a5d4e;
        --rule: #d8ccb8;
        --accent: #7a3b1f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--ink);
        font-family: "EB Garamond", Georgia, serif;
      }
      main {
        max-width: 860px;
        margin: 0 auto;
        padding: 4rem 1.5rem 5rem;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: clamp(2.4rem, 5vw, 4rem);
        font-weight: 600;
      }
      p.lede {
        margin: 0 0 2rem;
        max-width: 48rem;
        font-size: 1.25rem;
        line-height: 1.45;
        color: var(--muted);
      }
      .rule {
        border-top: 1px solid var(--rule);
        margin-bottom: 2rem;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 1rem;
      }
      a.card {
        display: block;
        padding: 1.25rem 1.5rem;
        background: rgba(255, 255, 255, 0.5);
        border: 1px solid var(--rule);
        border-radius: 6px;
        color: inherit;
        text-decoration: none;
        transition: background 120ms ease, border-color 120ms ease;
      }
      a.card:hover {
        background: rgba(255, 255, 255, 0.72);
        border-color: var(--accent);
      }
      a.card .title {
        display: block;
        font-size: 1.25rem;
        font-weight: 600;
      }
      a.card .desc {
        display: block;
        margin-top: 0.35rem;
        color: var(--muted);
        line-height: 1.45;
      }
      footer {
        margin-top: 3rem;
        font-size: 0.95rem;
        color: var(--muted);
      }
      code {
        font-family: "JetBrains Mono", SFMono-Regular, Menlo, monospace;
        font-size: 0.9em;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Tapestries</h1>
      <p class="lede">
        Public, static Vellum publications for felt fibers. Each publication is a
        baked snapshot: MyST-rendered prose, local search, backlinks, and the
        usual Vellum reading surface, served from GitHub Pages.
      </p>
      <div class="rule"></div>
      <ul>
${items}
      </ul>
      <footer>
        Shared reader assets live under <code>/_vellum/</code>; deep publication URLs
        fall back through <code>404.html</code> into the static reader shell.
      </footer>
    </main>
  </body>
</html>
`;
}

async function syncReaderShell(targetDir: string): Promise<void> {
  const distStatic = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist-static');
  if (!existsSync(distStatic)) {
    throw new Error(`dist-static/ not found at ${distStatic}. Run "npm run build:static" first.`);
  }
  const vellumDir = join(targetDir, '_vellum');
  await rm(vellumDir, { recursive: true, force: true });
  await mkdir(vellumDir, { recursive: true });
  // Copy contents (not the directory itself) so layout matches what bake's local
  // shell produces: _vellum/{assets,fonts,static.html,...}.
  const entries = await readdir(distStatic, { withFileTypes: true });
  for (const entry of entries) {
    await cp(join(distStatic, entry.name), join(vellumDir, entry.name), { recursive: true });
  }
}

/**
 * Every publication's index.html embeds the current reader bundle's asset
 * hashes. When the bundle rebuilds, the asset filenames change and every
 * publication breaks unless its index.html is regenerated. We do that for
 * every sibling publication on each publish so the whole site stays consistent.
 */
async function refreshPublicationShells(targetDir: string, skipSlug: string): Promise<void> {
  const distStatic = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist-static');
  const assets = await loadAssetPaths(join(distStatic, 'static.html'));
  const entries = await readdir(targetDir, { withFileTypes: true });
  let refreshed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === skipSlug) continue;
    if (entry.name.startsWith('.') || entry.name === '_vellum' || entry.name === 'node_modules') continue;
    const indexPath = join(targetDir, entry.name, 'index.html');
    if (!existsSync(indexPath)) continue;
    await writeFile(indexPath, publicationHtml(entry.name, assets));
    refreshed++;
  }
  if (refreshed > 0) {
    console.log(`[vellum-reader publish] refreshed shells for ${refreshed} sibling publication(s)`);
  }

  // SPA fallback for GitHub Pages: any unmatched URL serves 404.html, which
  // boots the reader and derives publication+slug from window.location.
  await writeFile(join(targetDir, '404.html'), fallbackHtml(assets));
}

export async function runPublish(options: PublishOptions): Promise<void> {
  const targetDir = resolve(options.target ?? defaultTargetDir());
  if (!existsSync(targetDir)) {
    throw new Error(`Tapestries dir not found: ${targetDir}. Clone the repo or set --target / $VELLUM_TAPESTRIES_DIR.`);
  }
  if (!existsSync(join(targetDir, '.git'))) {
    throw new Error(`Not a git repo: ${targetDir}`);
  }
  const targetStat = await stat(targetDir);
  if (!targetStat.isDirectory()) throw new Error(`Target is not a directory: ${targetDir}`);

  const remote = await readRemote(targetDir);

  // Bake straight into the target directory; we use the site-shared _vellum/
  // at the repo root, so the per-publication shell isn't needed for deployed copies.
  console.log(`[vellum-reader publish] target: ${targetDir}`);
  const result = await runBake({
    slug: options.slug,
    root: options.root,
    depth: options.depth,
    out: join(targetDir, options.slug),
    includeVellumShell: false,
  });
  // Resolve to the canonical slug from the loaded root fiber, in case --slug
  // was a full id or a partial that resolved to something different.
  const publicationSlug = result.rootFiber.slug;
  const publicationDir = join(targetDir, publicationSlug);

  if (publicationSlug !== options.slug) {
    // Rename the bake output dir to match canonical slug.
    await rm(publicationDir, { recursive: true, force: true });
    await cp(join(targetDir, options.slug), publicationDir, { recursive: true });
    await rm(join(targetDir, options.slug), { recursive: true, force: true });
  }

  await syncReaderShell(targetDir);
  await refreshPublicationShells(targetDir, publicationSlug);

  // Ensure .nojekyll exists so /_vellum/ ships verbatim.
  const nojekyll = join(targetDir, '.nojekyll');
  if (!existsSync(nojekyll)) await writeFile(nojekyll, '');

  // Regenerate the root listing.
  const publications = await collectPublications(targetDir);
  await writeFile(join(targetDir, 'index.html'), renderIndexHtml(publications));

  console.log(`[vellum-reader publish] source: ${result.rootFiber.id}`);
  console.log(`[vellum-reader publish] fibers: ${result.fiberCount}`);
  console.log(`[vellum-reader publish] publications listed: ${publications.length}`);

  if (!(await gitChanged(targetDir))) {
    console.log(`[vellum-reader publish] no changes to commit`);
    const url = publicationUrl(remote, publicationSlug);
    console.log(`[vellum-reader publish] ${url}`);
    return;
  }

  const message = options.message ?? `Publish ${publicationSlug}`;
  await git(targetDir, 'add', '-A');
  await git(targetDir, 'commit', '-m', message);
  console.log(`[vellum-reader publish] committed: ${message}`);

  if (options.noPush) {
    console.log(`[vellum-reader publish] --no-push set; not pushing.`);
  } else {
    await git(targetDir, 'push');
    console.log(`[vellum-reader publish] pushed`);
  }

  const url = publicationUrl(remote, publicationSlug);
  console.log(`[vellum-reader publish] ${url}`);
}
