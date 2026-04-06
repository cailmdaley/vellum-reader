/**
 * Static file proxy — serves project files from the content server.
 *
 * GET /static/path/to/file.png → content server /static/path/to/file.png
 *
 * This allows fiber markdown to reference images with ![alt](/static/path)
 * and have them served through the Vellum dev server.
 */

import type { LoaderFunction } from '@remix-run/node';
import fetch from 'node-fetch';

const CONTENT_CDN = process.env.CONTENT_CDN ?? `http://localhost:${process.env.CONTENT_CDN_PORT ?? 3100}`;

export const loader: LoaderFunction = async ({ params }) => {
  const path = params['*'] ?? '';
  const url = `${CONTENT_CDN}/static/${path}`;
  const res = await fetch(url);

  if (!res.ok) {
    return new Response('Not found', { status: 404 });
  }

  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const body = await res.buffer();

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
