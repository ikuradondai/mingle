import { body, json, sameOrigin } from '../server-side/http.mjs';
import { createVenueService } from '../server-side/venues.mjs';
const service = createVenueService();
function fail(res, e) { return json(res, e.status || 502, { error: e.code || 'VENUE_ERROR' }); }
export default async function venue(req, res) {
  if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  try {
    if (path === '/api/venue' && req.method === 'GET') return json(res, 200, await service.list(req));
    if (path === '/api/venue' && req.method === 'POST') { req.body = await body(req); return json(res, 201, await service.create(req)); }
    const match = path.match(/^\/api\/venue\/([^/]+)$/); if (match && req.method === 'PATCH') { req.body = await body(req); return json(res, 200, await service.update(req, decodeURIComponent(match[1]))); }
    const setMatch = path.match(/^\/api\/venue\/([^/]+)\/sets$/); if (setMatch && req.method === 'POST') { req.body = await body(req); return json(res, 201, await service.addSet(req, decodeURIComponent(setMatch[1]))); }
    const setUpdate = path.match(/^\/api\/venue\/sets\/([^/]+)$/); if (setUpdate && req.method === 'PATCH') { req.body = await body(req); return json(res, 200, await service.updateSet(req, decodeURIComponent(setUpdate[1]))); }
    const tableMatch = path.match(/^\/api\/venue\/([^/]+)\/tables$/); if (tableMatch && req.method === 'POST') { req.body = await body(req); return json(res, 201, await service.issueTable(req, decodeURIComponent(tableMatch[1]))); }
    const revokeMatch = path.match(/^\/api\/venue\/tables\/([^/]+)\/revoke$/); if (revokeMatch && req.method === 'POST') return json(res, 200, await service.revokeTable(req, decodeURIComponent(revokeMatch[1])));
    const rotateMatch = path.match(/^\/api\/venue\/tables\/([^/]+)\/rotate$/); if (rotateMatch && req.method === 'POST') return json(res, 200, await service.rotateTable(req, decodeURIComponent(rotateMatch[1])));
    const statsMatch = path.match(/^\/api\/venue\/([^/]+)\/stats$/); if (statsMatch && req.method === 'GET') return json(res, 200, await service.stats(req, decodeURIComponent(statsMatch[1])));
    const publicMatch = path.match(/^\/api\/venue\/public\/([^/]+)$/); if (publicMatch && req.method === 'GET') return json(res, 200, await service.publicInfo(req, decodeURIComponent(publicMatch[1]), false));
    const publicStart = path.match(/^\/api\/venue\/public\/([^/]+)\/start$/); if (publicStart && req.method === 'POST') { req.body = await body(req); return json(res, 200, await service.publicInfo(req, decodeURIComponent(publicStart[1]), true)); }
    const eventMatch = path.match(/^\/api\/venue\/public\/([^/]+)\/events$/); if (eventMatch && req.method === 'POST') { req.body = await body(req); return json(res, 202, await service.analytics(req, decodeURIComponent(eventMatch[1]))); }
    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (e) { return fail(res, e); }
}
