import { body, clientRateKey, json, sameOrigin } from '../server-side/http.mjs';
import { createVenueService } from '../server-side/venues.mjs';
import { consumeRate, persistentStoreAvailable } from '../server-side/store.mjs';
const service = createVenueService();
function fail(res, e) { return json(res, e.status || 502, { error: e.code || 'VENUE_ERROR' }); }
async function rate(req, scope, value, limit) { if (!persistentStoreAvailable()) { if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw Object.assign(new Error('rate store unavailable'), { status: 503, code: 'RATE_LIMIT_UNAVAILABLE' }); return false; } try { return await consumeRate(`${scope}:${value}:${clientRateKey(req, scope)}`) > limit; } catch { if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw Object.assign(new Error('rate store unavailable'), { status: 503, code: 'RATE_LIMIT_UNAVAILABLE' }); return false; } }
export default async function venue(req, res) {
  if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  try {
    if (path === '/api/venue' && req.method === 'GET') return json(res, 200, await service.list(req));
    if (path === '/api/venue' && req.method === 'POST') { await service.rateOwner(req); req.body = await body(req); return json(res, 201, await service.create(req)); }
    const match = path.match(/^\/api\/venue\/([^/]+)$/); if (match && req.method === 'PATCH') { req.body = await body(req); return json(res, 200, await service.update(req, decodeURIComponent(match[1]))); }
    const setMatch = path.match(/^\/api\/venue\/([^/]+)\/sets$/); if (setMatch && req.method === 'POST') { await service.rateOwner(req); req.body = await body(req); return json(res, 201, await service.addSet(req, decodeURIComponent(setMatch[1]))); }
    const setUpdate = path.match(/^\/api\/venue\/sets\/([^/]+)$/); if (setUpdate && req.method === 'PATCH') { req.body = await body(req); return json(res, 200, await service.updateSet(req, decodeURIComponent(setUpdate[1]))); }
    const tableMatch = path.match(/^\/api\/venue\/([^/]+)\/tables$/); if (tableMatch && req.method === 'POST') { await service.rateOwner(req); req.body = await body(req); return json(res, 201, await service.issueTable(req, decodeURIComponent(tableMatch[1]))); }
    const revokeMatch = path.match(/^\/api\/venue\/tables\/([^/]+)\/revoke$/); if (revokeMatch && req.method === 'POST') return json(res, 200, await service.revokeTable(req, decodeURIComponent(revokeMatch[1])));
    const rotateMatch = path.match(/^\/api\/venue\/tables\/([^/]+)\/rotate$/); if (rotateMatch && req.method === 'POST') { await service.rateOwner(req); return json(res, 200, await service.rotateTable(req, decodeURIComponent(rotateMatch[1]))); }
    const statsMatch = path.match(/^\/api\/venue\/([^/]+)\/stats$/); if (statsMatch && req.method === 'GET') return json(res, 200, await service.stats(req, decodeURIComponent(statsMatch[1])));
    const publicMatch = path.match(/^\/api\/venue\/public\/([^/]+)$/); if (publicMatch && req.method === 'GET') { const token = decodeURIComponent(publicMatch[1]); if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return json(res, 404, { error: 'NOT_FOUND' }); if (await rate(req, 'venue-public-ip', 'all', 6000) || await rate(req, 'venue-public-get', token, 60)) return json(res, 429, { error: 'RATE_LIMITED' }); return json(res, 200, await service.publicInfo(req, token, false)); }
    const publicStart = path.match(/^\/api\/venue\/public\/([^/]+)\/start$/); if (publicStart && req.method === 'POST') { const token = decodeURIComponent(publicStart[1]); if (await rate(req, 'venue-public-ip', 'all', 300) || await rate(req, 'venue-start', token, 20)) return json(res, 429, { error: 'RATE_LIMITED' }); req.body = await body(req); return json(res, 200, await service.publicInfo(req, token, true)); }
    const eventMatch = path.match(/^\/api\/venue\/public\/([^/]+)\/events$/); if (eventMatch && req.method === 'POST') { const token = decodeURIComponent(eventMatch[1]); if (await rate(req, 'venue-public-ip', 'all', 300) || await rate(req, 'venue-event', token, 120)) return json(res, 429, { error: 'RATE_LIMITED' }); req.body = await body(req); return json(res, 202, await service.analytics(req, token)); }
    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (e) { return fail(res, e); }
}
