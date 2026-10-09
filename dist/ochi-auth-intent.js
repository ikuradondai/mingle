import { clearOtherGameAuthIntents } from "./game-auth-intent-keys.js";
const KEY = "mingle.cards.ochi-auth-return.v1";
const TTL = 30 * 60 * 1000;
function safeStorage() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}
const tokenOk = (value) =>
  value === undefined ||
  value === "" ||
  (typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value));
export function saveOchiAuthIntent(
  { venueToken = "", name = "" } = {},
  storage = safeStorage(),
  now = Date.now,
) {
  if (
    !storage ||
    !tokenOk(venueToken) ||
    typeof name !== "string" ||
    !name.trim() ||
    Array.from(name.trim()).length > 40
  )
    return false;
  const createdAt = now();
  if (!Number.isFinite(createdAt)) return false;
  clearOtherGameAuthIntents("ochi", storage);
  try {
    storage.setItem(
      KEY,
      JSON.stringify({
        schema: 1,
        createdAt,
        expiresAt: createdAt + TTL,
        venueToken,
        name: name.trim(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}
export function consumeOchiAuthIntent(
  storage = safeStorage(),
  now = Date.now,
) {
  try {
    const value = JSON.parse(storage?.getItem(KEY) || "null");
    storage?.removeItem(KEY);
    if (
      !value ||
      value.schema !== 1 ||
      !Number.isFinite(value.createdAt) ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt < now() ||
      value.createdAt > now() ||
      value.expiresAt - value.createdAt > TTL ||
      !tokenOk(value.venueToken) ||
      typeof value.name !== "string" ||
      !value.name.trim() ||
      Array.from(value.name).length > 40
    )
      return null;
    return { venueToken: value.venueToken || "", name: value.name };
  } catch {
    return null;
  }
}
export function clearOchiAuthIntent(storage = safeStorage()) {
  try {
    storage?.removeItem(KEY);
  } catch {}
}
export const ochiAuthIntentKey = KEY;
