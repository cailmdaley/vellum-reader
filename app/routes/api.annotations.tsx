/**
 * Resource route: proxies annotation CRUD to the MySTRA content server.
 * GET  /api/annotations?slug=...  → list
 * POST /api/annotations           → create
 */

import type { LoaderFunction, ActionFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { getAnnotations, createAnnotation } from '~/utils/content-server';

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!slug) return json({ annotations: [] });
  // Forward optional filters through to mystra (kind + per-image scoping).
  const kindParam = url.searchParams.get('kind');
  const kind: 'text' | 'image' | undefined =
    kindParam === 'text' || kindParam === 'image' ? kindParam : undefined;
  const imageSrc = url.searchParams.get('imageSrc') ?? undefined;
  const annotations = await getAnnotations(slug, { kind, imageSrc });
  return json({ annotations });
};

export const action: ActionFunction = async ({ request }) => {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const body = await request.json();
  const annotation = await createAnnotation(body);
  if (!annotation) return json({ error: 'failed to create annotation' }, 500);
  return json({ annotation }, 201);
};
