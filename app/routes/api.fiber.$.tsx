/**
 * Resource route: proxies raw fiber read/write to the MySTRA content server.
 *
 * GET  /api/fiber/<slug>   → { slug, body, sha256 }  (raw markdown)
 * PUT  /api/fiber/<slug>   → { ok, slug, sha256 }    (writes to disk)
 *
 * Splat route ($) so nested slugs like "vellum-reader/aesthetic" survive
 * the url path intact. Vellum never touches .felt/ directly; mystra owns
 * the filesystem and also re-broadcasts the resulting RELOAD over WS so
 * the prose auto-refreshes after save.
 */

import type { LoaderFunction, ActionFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { getRawFiber, putRawFiber } from '~/utils/content-server';

export const loader: LoaderFunction = async ({ params }) => {
  const slug = params['*'] ?? '';
  if (!slug) return json({ error: 'slug is required' }, 400);
  const fiber = await getRawFiber(slug);
  if (!fiber) return json({ error: 'fiber not found' }, 404);
  return json(fiber);
};

export const action: ActionFunction = async ({ request, params }) => {
  if (request.method !== 'PUT') {
    return json({ error: 'method not allowed' }, 405);
  }
  const slug = params['*'] ?? '';
  if (!slug) return json({ error: 'slug is required' }, 400);
  const body = (await request.json()) as { body?: unknown };
  if (typeof body?.body !== 'string') {
    return json({ error: 'body.body (string) is required' }, 400);
  }
  const result = await putRawFiber(slug, body.body);
  if (!result) return json({ error: 'failed to save fiber' }, 500);
  return json(result);
};
