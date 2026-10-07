import { body, clientRateKey, json, sameOrigin } from '../server-side/http.mjs';
import { createGroupRoomService } from '../server-side/group-rooms.mjs';
import { consumeRate, persistentStoreAvailable } from '../server-side/store.mjs';
const service = createGroupRoomService();
function fail(res, error) { return json(res, error.status || 502, { error: error.code || 'GROUP_ERROR' }); }
async function rate(req, scope, value, limit) { if (!persistentStoreAvailable()) { if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw Object.assign(new Error('rate store unavailable'), { status: 503, code: 'RATE_LIMIT_UNAVAILABLE' }); return false; } try { return await consumeRate(`${scope}:${value}:${clientRateKey(req, scope)}`) > limit; } catch { if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw Object.assign(new Error('rate store unavailable'), { status: 503, code: 'RATE_LIMIT_UNAVAILABLE' }); return false; } }
export default async function group(req, res) {
  if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  try {
    if (path === '/api/group/rooms' && req.method === 'POST') { req.body = await body(req); return json(res, 201, await service.create(req)); }
    const match = path.match(/^\/api\/group\/rooms\/([^/]+)$/);
    if (match && req.method === 'GET') { const memberToken = req.headers?.['x-group-member-token'] || req.headers?.['X-Group-Member-Token'] || ''; if (await rate(req, 'group-state-ip', 'all', 6000) || await rate(req, 'group-state-member', `${decodeURIComponent(match[1])}:${memberToken}`, 180)) return json(res, 429, { error: 'RATE_LIMITED' }); return json(res, 200, await service.state(req, decodeURIComponent(match[1]))); }
    const join = path.match(/^\/api\/group\/rooms\/([^/]+)\/join$/);
    if (join && req.method === 'POST') { if (await rate(req, 'group-join-ip', 'all', 600) || await rate(req, 'group-join-room', decodeURIComponent(join[1]), 120)) return json(res, 429, { error: 'RATE_LIMITED' }); req.body = await body(req); return json(res, 200, await service.join(req, decodeURIComponent(join[1]))); }
    const preview = path.match(/^\/api\/group\/rooms\/([^/]+)\/preview$/);
    if (preview && req.method === 'POST') { if (await rate(req, 'group-preview-ip', 'all', 600) || await rate(req, 'group-preview-room', decodeURIComponent(preview[1]), 120)) return json(res, 429, { error: 'RATE_LIMITED' }); req.body = await body(req); return json(res, 200, await service.preview(req, decodeURIComponent(preview[1]))); }
    const action = path.match(/^\/api\/group\/rooms\/([^/]+)\/action$/);
    if (action && req.method === 'POST') { if (await rate(req, 'group-action-ip', 'all', 600) || await rate(req, 'group-action-room', decodeURIComponent(action[1]), 300)) return json(res, 429, { error: 'RATE_LIMITED' }); req.body = await body(req); return json(res, 200, await service.action(req, decodeURIComponent(action[1]))); }
    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (error) { return fail(res, error); }
}
