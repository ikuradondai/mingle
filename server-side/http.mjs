import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ANALYTICS_NAMESPACE, hasRedis, MAX_BODY_BYTES, isProduction, LEGACY_SESSION_COOKIE, SESSION_COOKIE, SESSION_REVOCATION_PREFIX, SESSION_TTL_SECONDS } from './config.mjs';
import { redisCommand } from './redis.mjs';
const revokedLocal = new Map();
export function json(res, status, body, extra = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(body)); }
export function noStore(res) { res.setHeader?.('Cache-Control', 'no-store'); }
export async function body(req) { return bodyWithLimit(req, MAX_BODY_BYTES); }
export async function bodyWithLimit(req, maxBytes) { const contentType = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase(); if (contentType && contentType !== 'application/json') throw Object.assign(new Error('content type'), { status: 415 }); if (req.body && typeof req.body === 'object') { if (Buffer.byteLength(JSON.stringify(req.body)) > maxBytes) throw Object.assign(new Error('body too large'), { status: 413 }); return req.body; } let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw Object.assign(new Error('body too large'), { status: 413 }); chunks.push(chunk); } if (!size) return {}; try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); return parsed; } catch { throw Object.assign(new Error('invalid json'), { status: 400 }); } }
export async function rawBodyWithLimit(req, maxBytes) {
  const canReadStream = typeof req?.[Symbol.asyncIterator] === 'function' || typeof req?.on === 'function';
  if (canReadStream && !req.readableEnded) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw Object.assign(new Error('body too large'), { status: 413 }); chunks.push(Buffer.from(chunk)); }
    return Buffer.concat(chunks);
  }
  const descriptor = req ? Object.getOwnPropertyDescriptor(req, 'body') : null;
  if (descriptor && 'value' in descriptor && (Buffer.isBuffer(descriptor.value) || typeof descriptor.value === 'string')) {
    const raw = Buffer.from(descriptor.value); if (raw.length > maxBytes) throw Object.assign(new Error('body too large'), { status: 413 }); return raw;
  }
  throw Object.assign(new Error('raw body unavailable'), { status: 400, code: 'RAW_BODY_UNAVAILABLE' });
}
export function exactKeys(value, keys) { return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)); }
export function sameOrigin(req) { const origin = req.headers?.origin; if (!origin) return true; try { return new URL(origin).host === (req.headers.host || new URL(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost').host); } catch { return false; } }
export function cookie(req, name) { const raw = req.headers?.cookie || ''; const match = raw.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`)); if (!match) return ''; try { return decodeURIComponent(match.slice(name.length + 1)); } catch { return ''; } }
export function adminCookieName() { return isProduction() ? '__Host-mingle_admin' : SESSION_COOKIE; }
export function setCookie(res, value, maxAge) { const name = adminCookieName(); const attrs = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`]; if (isProduction()) attrs.push('Secure'); res.setHeader('Set-Cookie', attrs.join('; ')); }
export function clearCookie(res) { const values = [`${adminCookieName()}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`]; if (isProduction()) values[0] += '; Secure'; if (isProduction()) values.push(`${LEGACY_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`); res.setHeader('Set-Cookie', values); }
function sessionKey(token) { return `${SESSION_REVOCATION_PREFIX}${ANALYTICS_NAMESPACE}:${createHash('sha256').update(String(token || '')).digest('hex')}`; }
function sessionParts(token) { const secret = process.env.ADMIN_SESSION_SECRET; if (!secret || !token) return null; const parts = String(token).split('.'); if (parts.length !== 2) return null; const [payload, signature] = parts; if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature)) return null; let payloadBytes, actual; try { payloadBytes = Buffer.from(payload, 'base64url'); actual = Buffer.from(signature, 'base64url'); } catch { return null; } if (payloadBytes.toString('base64url') !== payload || actual.toString('base64url') !== signature) return null; const expected = createHmac('sha256', secret).update(payload).digest(); if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null; try { const data = JSON.parse(payloadBytes.toString()); return Number.isFinite(data.exp) && data.exp > Date.now() && data.exp <= Date.now() + SESSION_TTL_SECONDS * 1000 + 60000 ? data : null; } catch { return null; } }
export function signSession() { const secret = process.env.ADMIN_SESSION_SECRET; if (!secret) throw new Error('session secret unavailable'); const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_SECONDS * 1000, n: randomBytes(16).toString('base64url') })).toString('base64url'); return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`; }
export function verifySession(token) { if (hasRedis()) return Boolean(sessionParts(token)); const key = sessionKey(token); const now = Date.now(); for (const [revoked, expires] of revokedLocal) { if (expires <= now) revokedLocal.delete(revoked); } const expires = revokedLocal.get(key); if (expires && expires > now) return false; return Boolean(sessionParts(token)); }
export async function verifySessionAsync(token) { if (!verifySession(token)) return false; if (!hasRedis()) return !isProduction(); try { return !(await redisCommand(['EXISTS', sessionKey(token)])); } catch { return false; } }
export async function revokeSession(token) { const data = sessionParts(token); if (!data) return false; const key = sessionKey(token); const ttl = Math.max(1, Math.ceil((data.exp - Date.now()) / 1000)); if (hasRedis()) { await redisCommand(['SET', key, '1', 'EX', String(ttl)]); } else if (isProduction()) return false; else { const now = Date.now(); for (const [revoked, expires] of revokedLocal) { if (expires <= now) revokedLocal.delete(revoked); } revokedLocal.set(key, data.exp); while (revokedLocal.size > 10000) revokedLocal.delete(revokedLocal.keys().next().value); } return true; }
export function adminSession(req) { return cookie(req, adminCookieName()) || (!isProduction() ? cookie(req, LEGACY_SESSION_COOKIE) : ''); }
export function clientRateKey(req, scope) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',').map((value) => value.trim()).filter(Boolean);
  const address = process.env.VERCEL ? (forwarded.at(-1) || req.headers?.['x-real-ip'] || 'unknown') : (req.socket?.remoteAddress || 'unknown');
  return `${scope}:${createHmac('sha256', process.env.ADMIN_SESSION_SECRET || 'rate-key').update(String(address)).digest('hex')}`;
}
