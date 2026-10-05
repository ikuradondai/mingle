import { body, bodyWithLimit, json, sameOrigin } from '../server-side/http.mjs';
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
    if (pathname === '/api/account/adult-confirmation') {
      if (req.method === 'PUT' || req.method === 'DELETE') { req.body = await body(req); return json(res, 200, await service.adultConfirmation(req)); }
      return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    if (pathname === '/api/account/ai/questions' && req.method === 'POST') { req.body = await body(req); return json(res, 200, await service.aiQuestions(req)); }
    if (pathname === '/api/account/avatar') {
      if (req.method === 'PUT') req.body = await bodyWithLimit(req, 400 * 1024);
      if (req.method === 'GET' || req.method === 'PUT' || req.method === 'DELETE') return json(res, 200, await service.avatar(req));
      return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    const favoriteMatch = pathname.match(/^\/api\/account\/favorites\/([^/]+)$/);
    if (favoriteMatch) return json(res, 200, await service.favorite(req, decodeURIComponent(favoriteMatch[1])));
    if (pathname === '/api/account/favorites' && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) {
      req.body = await body(req); const cardId = req.body?.cardId;
      if (req.method === 'POST' && req.body?.favorite === false) req.method = 'DELETE';
      return json(res, 200, await service.favorite(req, cardId));
    }
    if (pathname === '/api/account/sets' && req.method === 'POST') { req.body = await body(req); return json(res, 201, await service.set(req)); }
    if (pathname === '/api/account/set-drafts' && (req.method === 'GET' || req.method === 'POST')) {
      if (req.method === 'POST') req.body = await body(req);
      return json(res, req.method === 'POST' ? 201 : 200, await service.draft(req));
    }
    const draftCompleteMatch = pathname.match(/^\/api\/account\/set-drafts\/([^/]+)\/complete$/);
    if (draftCompleteMatch && req.method === 'POST') {
      req.body = await body(req);
      if (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) return json(res, 400, { error: 'INVALID_REQUEST' });
      return json(res, 200, await service.completeDraft(req, decodeURIComponent(draftCompleteMatch[1])));
    }
    const draftMatch = pathname.match(/^\/api\/account\/set-drafts\/([^/]+)$/);
    if (draftMatch) {
      if (req.method === 'PATCH') req.body = await body(req);
      return json(res, 200, await service.draft(req, decodeURIComponent(draftMatch[1])));
    }
    const setMatch = pathname.match(/^\/api\/account\/sets\/([^/]+)$/);
    if (setMatch) { if (req.method === 'PATCH' || req.method === 'POST') req.body = await body(req); return json(res, 200, await service.set(req, decodeURIComponent(setMatch[1]))); }
    const shareMatch = pathname.match(/^\/api\/account\/sets\/([^/]+)\/share$/);
    if (shareMatch) {
      const setId = decodeURIComponent(shareMatch[1]);
      if (req.method === 'POST' || req.method === 'PUT') {
        req.body = await body(req);
        if (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) return json(res, 400, { error: 'INVALID_REQUEST' });
      }
      if (req.method === 'GET' || req.method === 'POST' || req.method === 'PUT') return json(res, req.method === 'PUT' ? 201 : 200, await service.shareSet(req, setId));
      if (req.method === 'DELETE') return json(res, 200, await service.stopShare(req, setId));
      return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    if (pathname === '/api/account/cards' && req.method === 'POST') { req.body = await body(req); return json(res, 201, await service.customCard(req)); }
    const cardMatch = pathname.match(/^\/api\/account\/cards\/([^/]+)$/);
    if (cardMatch) { if (req.method === 'PATCH') req.body = await body(req); return json(res, 200, await service.customCard(req, decodeURIComponent(cardMatch[1]))); }
    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    if (error.status === 413 || error.status === 415 || error.status === 400) return respondError(res, error);
    return respondError(res, error);
  }
}
