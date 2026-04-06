/**
 * Resource route: proxies search queries to the MySTRA content server.
 * GET /api/search?q=... → content server /api/search?q=...
 */

import type { LoaderFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { searchFibers } from '~/utils/content-server';

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? '';
  if (!q.trim()) return json({ hits: [] });
  const hits = await searchFibers(q);
  return json({ hits });
};
