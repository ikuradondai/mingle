import { body, json, sameOrigin } from '../server-side/http.mjs';
import { createMarketplaceService } from '../server-side/marketplace.mjs';
const service = createMarketplaceService();
function error(res, e) { return json(res, e.status || 502, { error: e.code || 'MARKETPLACE_ERROR' }); }
export default async function marketplace(req, res) {
  if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  try {
    if (path === '/api/marketplace' && req.method === 'GET') return json(res, 200, await service.list(req));
    if (path === '/api/marketplace/owner' && req.method === 'GET') return json(res, 200, await service.ownerList(req));
    const detail = path.match(/^\/api\/marketplace\/([^/]+)$/);
    if (detail && req.method === 'GET') return json(res, 200, await service.detail(req, decodeURIComponent(detail[1])));
    if (path === '/api/marketplace/publish' && req.method === 'POST') { req.body = await body(req); return json(res, 201, await service.publish(req)); }
    if (path === '/api/marketplace/import' && req.method === 'POST') { req.body = await body(req); return json(res, 200, await service.importSet(req)); }
    if (path === '/api/marketplace/like' && (req.method === 'PUT' || req.method === 'POST')) { req.body = await body(req); return json(res, 200, await service.like(req)); }
    if (path === '/api/marketplace/withdraw' && req.method === 'POST') { req.body = await body(req); return json(res, 200, await service.withdraw(req)); }
    return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  } catch (e) { return error(res, e); }
}
