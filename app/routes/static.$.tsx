/**
 * Static file proxy — serves project files from the content server.
 *
 * GET /static/path/to/file.png → content server /static/path/to/file.png
 *
 * This allows fiber markdown to reference images with ![alt](/static/path)
 * and have them served through the Vellum dev server.
 */

import type { LoaderFunction } from '@remix-run/node';

const CONTENT_CDN =
  process.env['CONTENT_CDN'] ??
  `http://localhost:${process.env['CONTENT_CDN_PORT'] ?? 3100}`;

export const loader: LoaderFunction = async ({ params }) => {
  const path = params['*'] ?? '';
  const res = await fetch(`${CONTENT_CDN}/static/${path}`);

  if (!res.ok) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(await res.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
