import { json } from '../../server-side/http.mjs';
import { createDailyScheduler, cronSecretMatches } from '../../server-side/daily-line-scheduler.mjs';

export default async function cron(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (!cronSecretMatches(req.headers?.['x-mingle-cron-secret'] || '', process.env.MINGLE_DAILY_CRON_SECRET || '')) return json(res, 403, { error: 'FORBIDDEN' });
  try { return json(res, 200, await createDailyScheduler().run()); } catch (error) { return json(res, error.status || 502, { error: ['FEATURE_UNAVAILABLE', 'LINE_NOT_CONFIGURED'].includes(error.code) ? error.code : 'DAILY_LINE_UNAVAILABLE' }); }
}
