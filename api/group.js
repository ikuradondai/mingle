import { body, json, sameOrigin } from '../server-side/http.mjs';
import { createGroupRoomService } from '../server-side/group-rooms.mjs';
const service = createGroupRoomService();
function fail(res, error) { return json(res, error.status || 502, { error: error.code || 'GROUP_ERROR' }); }
export default async function group(req, res) {
  if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  try {
    if (path === '/api/group/rooms' && req.method === 'POST') { req.body = await body(req); return json(res, 201, await service.create(req)); }
    const match = path.match(/^\/api\/group\/rooms\/([^/]+)$/);
    if (match && req.method === 'GET') return json(res, 200, await service.state(req, decodeURIComponent(match[1])));
    const join = path.match(/^\/api\/group\/rooms\/([^/]+)\/join$/);
    if (join && req.method === 'POST') { req.body = await body(req); return json(res, 200, await service.join(req, decodeURIComponent(join[1]))); }
    const preview = path.match(/^\/api\/group\/rooms\/([^/]+)\/preview$/);
    if (preview && req.method === 'POST') { req.body = await body(req); return json(res, 200, await service.preview(req, decodeURIComponent(preview[1]))); }
    const action = path.match(/^\/api\/group\/rooms\/([^/]+)\/action$/);
    if (action && req.method === 'POST') { req.body = await body(req); return json(res, 200, await service.action(req, decodeURIComponent(action[1]))); }
    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (error) { return fail(res, error); }
}
