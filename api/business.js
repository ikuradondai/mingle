import { body, bodyWithLimit, clientRateKey, json, rawBodyWithLimit, sameOrigin } from '../server-side/http.mjs';
import { createBusinessService } from '../server-side/business.mjs';
import { parseBusinessCsv } from '../dist/business-csv.js';
import { consumeRate, persistentStoreAvailable } from '../server-side/store.mjs';

const production = () => process.env.NODE_ENV === 'production' || process.env.VERCEL;
const errorResponse = (res, error) => json(res, error.status || 502, { error: error.code || 'BUSINESS_UNAVAILABLE' });

async function defaultRate(req, scope, limit) {
  if (!persistentStoreAvailable()) { if (production()) throw Object.assign(new Error('RATE_LIMIT_UNAVAILABLE'), { status: 503, code: 'RATE_LIMIT_UNAVAILABLE' }); return; }
  try { if (await consumeRate(`business:${scope}:${clientRateKey(req, scope)}`) > limit) throw Object.assign(new Error('RATE_LIMITED'), { status: 429, code: 'RATE_LIMITED' }); } catch (error) { if (error.code === 'RATE_LIMITED') throw error; throw Object.assign(new Error('RATE_LIMIT_UNAVAILABLE'), { status: 503, code: 'RATE_LIMIT_UNAVAILABLE' }); }
}

export function createBusinessHandler({ service = createBusinessService(), rate = defaultRate } = {}) {
  return async function business(req, res) {
    if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    try {
      await rate(req, req.method === 'GET' ? 'read' : 'mutation', req.method === 'GET' ? 3000 : 120);
      if (path === '/api/business/organizations' && req.method === 'POST') { req.body = await body(req); return json(res, 201, await service.create(req)); }
      if (path === '/api/business/organizations' && req.method === 'GET') return json(res, 200, await service.list(req));
      const workspace = path.match(/^\/api\/business\/organizations\/([^/]+)\/workspace$/);
      if (workspace && req.method === 'GET') { req.params = { orgId: decodeURIComponent(workspace[1]) }; return json(res, 200, await service.metadata(req)); }
      const policy = path.match(/^\/api\/business\/organizations\/([^/]+)\/policy$/);
      if (policy && req.method === 'PUT') { req.params = { orgId: decodeURIComponent(policy[1]) }; req.body = await body(req); return json(res, 200, await service.policy(req)); }
      const start = path.match(/^\/api\/business\/organizations\/([^/]+)\/sessions$/);
      if (start && req.method === 'POST') { req.params = { orgId: decodeURIComponent(start[1]) }; req.body = await body(req); return json(res, 200, await service.start(req)); }
      const imp = path.match(/^\/api\/business\/organizations\/([^/]+)\/members\/import$/);
      if (imp && req.method === 'POST') {
        req.params = { orgId: decodeURIComponent(imp[1]) };
        const type = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (req.body === null) return json(res, 400, { error: 'INVALID_REQUEST' });
        const parsed = type === 'text/csv' ? parseBusinessCsv(await rawBodyWithLimit(req, 256 * 1024)) : await bodyWithLimit(req, 256 * 1024);
        if (type !== 'text/csv' && (!parsed || Array.isArray(parsed) || !Array.isArray(parsed.rows) || Object.keys(parsed).some((key) => key !== 'rows'))) return json(res, 400, { error: 'INVALID_REQUEST' });
        return json(res, 201, await service.importMembers(req, Array.isArray(parsed) ? parsed : parsed.rows));
      }
      const member = path.match(/^\/api\/business\/organizations\/([^/]+)\/members\/([^/]+)$/);
      if (member && req.method === 'PATCH') { req.params = { orgId: decodeURIComponent(member[1]), memberId: decodeURIComponent(member[2]) }; req.body = await body(req); return json(res, 200, await service.memberAction(req, req.params.memberId)); }
      if (member && req.method === 'DELETE') { req.params = { orgId: decodeURIComponent(member[1]), memberId: decodeURIComponent(member[2]) }; return json(res, 200, await service.removeMember(req, req.params.memberId)); }
      const orgDelete = path.match(/^\/api\/business\/organizations\/([^/]+)$/);
      if (orgDelete && req.method === 'DELETE') return json(res, 200, await service.removeOrganization(req, decodeURIComponent(orgDelete[1])));
      if (path === '/api/business/organizations' || /^\/api\/business\/organizations\/[^/]+(?:\/workspace|\/policy|\/sessions)?$/.test(path) || /^\/api\/business\/organizations\/[^/]+\/members(?:\/import|\/[^/]+)$/.test(path)) return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return json(res, 404, { error: 'NOT_FOUND' });
    } catch (error) { if (error instanceof URIError) return json(res, 400, { error: 'INVALID_REQUEST' }); return errorResponse(res, error); }
  };
}

export default createBusinessHandler();
