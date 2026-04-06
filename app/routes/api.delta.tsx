/**
 * Resource route: proxies log events to the MySTRA content server.
 * GET /api/delta?since=... → content server /api/log?since=...
 */

import type { LoaderFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { getLogEvents } from '~/utils/content-server';

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const since = url.searchParams.get('since') ?? undefined;
  const data = await getLogEvents(since);
  return json(data);
};
