// Optional account client. Configuration is always discovered from the server.
const API_ROOT = '/api/account';
let supabase = null;
let sdkLoader = () => import('./vendor/supabase.js');
let fetcher = fetch;
export const accountConfig = { enabled: false, google: false, emailOtp: false };
function authError(message = 'account_auth_required', status = 401) { const error = new Error(message); error.status = status; return error; }
async function initializeClient(url, key) { try { const sdk = await sdkLoader(); supabase = sdk.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } }); return true; } catch { supabase = null; accountConfig.enabled = false; accountConfig.google = false; accountConfig.emailOtp = false; return false; } }
export async function discoverAccountConfig({ fetchImpl = fetch } = {}) {
  accountConfig.enabled = false; accountConfig.google = false; accountConfig.emailOtp = false; supabase = null;
  try { const response = await fetchImpl('/api/account/config', { credentials: 'same-origin' }); if (!response.ok) return accountConfig; const remote = await response.json(); if (remote?.enabled !== true || typeof remote.url !== 'string' || typeof remote.publishableKey !== 'string') return accountConfig; if (!await initializeClient(remote.url, remote.publishableKey)) return accountConfig; accountConfig.enabled = true; accountConfig.google = remote.googleEnabled === true; accountConfig.emailOtp = remote.emailOtp !== false; } catch { supabase = null; }
  return accountConfig;
}
async function sessionToken() { if (!supabase) return null; try { const result = await supabase.auth.getSession(); if (result.error) throw result.error; return result.data?.session?.access_token || null; } catch { return null; } }
async function request(path, options = {}) {
  const token = await sessionToken(); if (!token) { if (path === '/me') return { user: null, favorites: [], sets: [] }; throw authError(); }
  const response = await fetcher(`${API_ROOT}${path}`, { ...options, credentials: 'same-origin', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(options.headers || {}) }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  let data = null; try { data = await response.json(); } catch {}
  if (!response.ok) { const error = new Error(data?.error || 'account_request_failed'); error.status = response.status; throw error; } return data || {};
}
function authClient() { if (!supabase) throw authError('account_unavailable', 503); return supabase.auth; }
export const accountApi = {
  me: () => request('/me'),
  sendOtp: async (email) => { const result = await authClient().signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}${location.pathname}` } }); if (result.error) throw result.error; return result; },
  verifyOtp: async (email, token) => { const result = await authClient().verifyOtp({ email, token, type: 'email' }); if (result.error) throw result.error; return result; },
  google: async () => { const result = await authClient().signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${location.pathname}` } }); if (result.error) throw result.error; return result; },
  logout: async () => { const result = await authClient().signOut(); if (result.error) throw result.error; return result; },
  onAuthStateChange: (callback) => supabase?.auth.onAuthStateChange(callback),
  favorite: (card, saved) => request(`/favorites/${encodeURIComponent(card.id)}`, { method: saved ? 'PUT' : 'DELETE', body: saved ? { cardId: card.id } : undefined }),
  createSet: (name, cardIds) => request('/sets', { method: 'POST', body: { name, cardIds } }),
  updateSet: (id, payload) => request(`/sets/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }),
  deleteSet: (id) => request(`/sets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
export function cardPayload(card, deckId) { return { id: card.id, deckId: deckId || card.sourceDeckId || null }; }
export function createAccountClientForTest({ fetchImpl, sdk, locationRef = { origin: 'http://localhost:5180', pathname: '/' } }) { sdkLoader = async () => sdk; fetcher = fetchImpl; globalThis.location ||= locationRef; return { config: accountConfig, discover: () => discoverAccountConfig({ fetchImpl }), api: accountApi }; }
