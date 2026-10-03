import { body, json, sameOrigin } from '../server-side/http.mjs';
import { createAccountService } from '../server-side/accounts.mjs';

const service = createAccountService();

function respondError(res, error) {
  const status = error.status || 502;
  return json(res, status, { error: error.code || 'ACCOUNT_ERROR' });
}

export default async function account(req, res) {
  if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  try {
    if (pathname === '/api/account/config' && req.method === 'GET') {
      const config = service.config;
      return json(res, 200, config ? { enabled: true, url: config.url, publishableKey: config.key, googleEnabled: config.googleEnabled } : { enabled: false, url: null, publishableKey: null, googleEnabled: false });
    }
    if (pathname === '/api/account' || pathname === '/api/account/me') {
      if (req.method === 'GET') return json(res, 200, await service.account(req));
      if (req.method === 'DELETE') { req.body = await body(req); return json(res, 200, await service.removeAccount(req)); }
      return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    if (pathname === '/api/account/profile' && req.method === 'PATCH') { req.body = await body(req); return json(res, 200, await service.profile(req)); }
    const favoriteMatch = pathname.match(/^\/api\/account\/favorites\/([^/]+)$/);
    if (favoriteMatch) return json(res, 200, await service.favorite(req, decodeURIComponent(favoriteMatch[1])));
    if (pathname === '/api/account/favorites' && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) {
      req.body = await body(req); const cardId = req.body?.cardId;
      if (req.method === 'POST' && req.body?.favorite === false) req.method = 'DELETE';
      return json(res, 200, await service.favorite(req, cardId));
    }
    if (pathname === '/api/account/sets' && req.method === 'POST') { req.body = await body(req); return json(res, 201, await service.set(req)); }
    const setMatch = pathname.match(/^\/api\/account\/sets\/([^/]+)$/);
    if (setMatch) { if (req.method === 'PATCH' || req.method === 'POST') req.body = await body(req); return json(res, 200, await service.set(req, decodeURIComponent(setMatch[1]))); }
    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    if (error.status === 413 || error.status === 415 || error.status === 400) return respondError(res, error);
    return respondError(res, error);
  }
}
