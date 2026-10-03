import { body, json, sameOrigin } from '../server-side/http.mjs';
import { createAccountService } from '../server-side/accounts.mjs';

const service = createAccountService();

export default async function share(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const match = pathname.match(/^\/api\/share\/([^/]+)(?:\/start)?$/);
  if (!match) return json(res, 404, { error: 'NOT_FOUND' });
  try {
    const start = pathname.endsWith('/start');
    if (start && req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    if (!start && req.method !== 'GET') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    if (start) req.body = await body(req);
    return json(res, 200, await service.publicShare(req, decodeURIComponent(match[1]), start));
  } catch (error) {
    return json(res, error.status || 502, { error: error.code || 'SHARE_ERROR' });
  }
}
