import { body, json, sameOrigin } from '../../server-side/http.mjs';
import { createSoloNoteService } from '../../server-side/solo-notes.mjs';

const service = createSoloNoteService();
function respondError(res, error) { return json(res, error.status || 502, { error: error.code || 'ACCOUNT_ERROR' }); }

export default async function soloNotes(req, res) {
  if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  try {
    if (pathname === '/api/account/solo-notes') {
      if (req.method === 'GET') return json(res, 200, await service.list(req));
      if (req.method === 'PUT') { req.body = await body(req); return json(res, 200, await service.upsert(req)); }
      return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    const match = pathname.match(/^\/api\/account\/solo-notes\/([^/]+)$/);
    if (!match) return json(res, 404, { error: 'NOT_FOUND' });
    const noteId = decodeURIComponent(match[1]);
    if (req.method === 'PATCH') { req.body = await body(req); return json(res, 200, await service.edit(req, noteId)); }
    if (req.method === 'DELETE') return json(res, 200, await service.remove(req, noteId));
    return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  } catch (error) { return respondError(res, error); }
}

