import { body, json, sameOrigin } from '../server-side/http.mjs';
import { createDailyApi, respondDailyError } from '../server-side/daily-api.mjs';

const service = createDailyApi();
export default async function daily(req, res) {
  if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  try {
    const path = new URL(req.url || '/', 'http://localhost').pathname.replace(/^\/api\/daily/, '') || '/';
    if (path === '/readiness' && req.method === 'GET') return json(res, 200, await service.readiness());
    if (path === '/eligible-decks' && req.method === 'GET') return json(res, 200, { decks: await service.eligibleDecks() });
    if (path === '/invite-preview' && req.method === 'POST') { req.body = await body(req); return json(res, 200, { group: await service.invitePreview(null, req.body?.token) }); }
    const current = await service.user(req);
    if (path === '/groups' && req.method === 'GET') return json(res, 200, { groups: await service.groups(current) });
    if (path === '/groups' && req.method === 'POST') { req.body = await body(req); return json(res, 201, { group: await service.create(current, req.body) }); }
    const join = path.match(/^\/groups\/([^/]+)\/invite$/);
    if (join && req.method === 'POST') return json(res, 201, await service.invite(current, decodeURIComponent(join[1])));
    const revoke = path.match(/^\/groups\/([^/]+)\/invites$/);
    if (revoke && req.method === 'DELETE') return json(res, 200, await service.revokeInvites(current, decodeURIComponent(revoke[1])));
    if (path === '/join' && req.method === 'POST') { req.body = await body(req); return json(res, 200, await service.join(current, req.body)); }
    const group = path.match(/^\/groups\/([^/]+)$/);
    if (group && req.method === 'GET') return json(res, 200, await service.group(current, decodeURIComponent(group[1])));
    if (group && req.method === 'PATCH') { req.body = await body(req); return json(res, 200, { group: await service.setStatus(current, decodeURIComponent(group[1]), req.body) }); }
    if (group && req.method === 'PUT') { req.body = await body(req); return json(res, 200, { group: await service.edit(current, decodeURIComponent(group[1]), req.body) }); }
    if (group && req.method === 'DELETE') { return json(res, 200, await service.deleteGroup(current, decodeURIComponent(group[1]))); }
    const today = path.match(/^\/groups\/([^/]+)\/today$/);
    if (today && req.method === 'GET') return json(res, 200, { question: await service.today(current, decodeURIComponent(today[1])) });
    const history = path.match(/^\/groups\/([^/]+)\/history$/);
    if (history && req.method === 'GET') return json(res, 200, await service.history(current, decodeURIComponent(history[1]), new URL(req.url || '/', 'http://localhost').searchParams.get('date')));
    const checkin = path.match(/^\/groups\/([^/]+)\/checkins$/);
    if (checkin && req.method === 'POST') { req.body = await body(req); return json(res, 200, await service.checkin(current, decodeURIComponent(checkin[1]), req.body)); }
    const member = path.match(/^\/groups\/([^/]+)\/members\/status$/);
    if (member && req.method === 'POST') { req.body = await body(req); return json(res, 200, await service.memberStatus(current, decodeURIComponent(member[1]), req.body)); }
    const opt = path.match(/^\/groups\/([^/]+)\/line-opt-in$/);
    if (opt && req.method === 'POST') { req.body = await body(req); return json(res, 200, await service.optIn(current, decodeURIComponent(opt[1]), req.body)); }
    if (path === '/line/status' && req.method === 'GET') return json(res, 200, await service.lineStatus(current));
    if (path === '/line/pause' && req.method === 'POST') { req.body = await body(req); if (typeof req.body?.paused !== 'boolean') return json(res, 400, { error: 'INVALID_REQUEST' }); return json(res, 200, await service.globalLinePause(current, req.body.paused)); }
    if (path === '/line/unlink' && req.method === 'POST') return json(res, 200, await service.unlink(current));
    if (path === '/line/link/bind' && req.method === 'POST') { req.body = await body(req); return json(res, 200, await service.bindLine(current, req.body)); }
    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (error) { const result = respondDailyError(res, error); return json(res, res.statusCode, result); }
}
