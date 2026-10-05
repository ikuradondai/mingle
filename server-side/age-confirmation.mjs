// Server-side helpers for the R18 age-confirmation gate.
// config = { url, key }; authorization is the user's Bearer (read through RLS) or a service-key Bearer.
export const AGE_ERRORS = { required: 'AGE_CONFIRMATION_REQUIRED', attestation: 'ADULT_ATTESTATION_REQUIRED', participant: 'PARTICIPANT_AGE_REQUIRED' };

const SOURCES = ['login_screen', 'settings'];
const fail = (status, code) => Object.assign(new Error(code), { status, code });

async function call(config, path, options, fetchImpl) {
  const response = await fetchImpl(`${config.url}${path}`, {
    ...options,
    headers: { apikey: config.key, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  let data = null; try { data = await response.json(); } catch { /* empty body */ }
  return { response, data };
}

function missingTable(response, data) {
  if (response.status !== 404) return false;
  const code = data?.code;
  return (code === 'PGRST205' || code === '42P01') && /account_profiles/i.test(JSON.stringify(data));
}

// -> { available, confirmedAt }. A missing table is reported as "not available / not confirmed".
// Any other failure throws; callers must treat a throw as "not confirmed".
export async function readAdultConfirmation({ config, userId, authorization, fetchImpl = fetch }) {
  if (!config || typeof userId !== 'string' || !userId || !authorization) throw fail(401, 'UNAUTHENTICATED');
  const { response, data } = await call(config, `/rest/v1/account_profiles?user_id=eq.${encodeURIComponent(userId)}&select=adult_confirmed_at`, { headers: { Authorization: authorization } }, fetchImpl);
  if (!response.ok) {
    if (missingTable(response, data)) return { available: false, confirmedAt: null };
    throw fail(response.status === 401 ? 401 : 502, response.status === 401 ? 'UNAUTHENTICATED' : 'FEATURE_UNAVAILABLE');
  }
  const value = Array.isArray(data) ? data[0]?.adult_confirmed_at : null;
  const time = typeof value === 'string' && value ? new Date(value) : null;
  return { available: true, confirmedAt: time && !Number.isNaN(time.getTime()) ? time.toISOString() : null };
}

// -> confirmedAt (ISO). Throws 403 AGE_CONFIRMATION_REQUIRED when unconfirmed, unreadable or unavailable.
export async function requireAdultConfirmed(args) {
  let state;
  try { state = await readAdultConfirmation(args); } catch { throw fail(403, AGE_ERRORS.required); }
  if (!state.available || !state.confirmedAt) throw fail(403, AGE_ERRORS.required);
  return state.confirmedAt;
}

// -> confirmedAt (ISO) or null (revoked). Runs as the user, so auth.uid() inside the RPC is the caller.
export async function setAdultConfirmation({ config, authorization, confirmed, source = 'settings', fetchImpl = fetch }) {
  if (typeof confirmed !== 'boolean' || (confirmed && !SOURCES.includes(source))) throw fail(400, 'INVALID_REQUEST');
  if (!config || !authorization) throw fail(401, 'UNAUTHENTICATED');
  const { response, data } = await call(config, '/rest/v1/rpc/set_adult_confirmation', { method: 'POST', body: JSON.stringify({ p_confirmed: confirmed, p_source: confirmed ? source : 'settings' }), headers: { Authorization: authorization } }, fetchImpl);
  if (!response.ok) {
    if (response.status === 401) throw fail(401, 'UNAUTHENTICATED');
    if (response.status === 404) throw fail(503, 'FEATURE_UNAVAILABLE');
    throw fail(502, 'FEATURE_UNAVAILABLE');
  }
  if (!confirmed) return null;
  const value = Array.isArray(data) ? data[0] : data;
  const time = typeof value === 'string' && value ? new Date(value) : null;
  if (!time || Number.isNaN(time.getTime())) throw fail(502, 'FEATURE_UNAVAILABLE');
  return time.toISOString();
}

// Optional Bearer: returns the user ({ id, ... }) or null when absent/invalid/unreachable.
export async function userFromBearer({ config, authorization, fetchImpl = fetch }) {
  if (!config || !authorization) return null;
  try {
    const { response, data } = await call(config, '/auth/v1/user', { headers: { Authorization: authorization } }, fetchImpl);
    return response.ok && data && typeof data.id === 'string' && data.id ? data : null;
  } catch { return null; }
}
