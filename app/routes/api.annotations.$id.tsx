/**
 * Resource route: PATCH/DELETE individual annotations via content server.
 * PATCH  /api/annotations/:id  → update comment
 * DELETE /api/annotations/:id  → delete
 */

import type { ActionFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { updateAnnotation, deleteAnnotation } from '~/utils/content-server';

export const action: ActionFunction = async ({ request, params }) => {
  const id = params.id;
  if (!id) return json({ error: 'id is required' }, 400);

  if (request.method === 'PATCH') {
    const body = await request.json();
    const annotation = await updateAnnotation(id, body.comment);
    if (!annotation) return json({ error: 'annotation not found' }, 404);
    return json({ annotation });
  }

  if (request.method === 'DELETE') {
    const deleted = await deleteAnnotation(id);
    if (!deleted) return json({ error: 'annotation not found' }, 404);
    return json({ deleted: true });
  }

  return json({ error: 'method not allowed' }, 405);
};
