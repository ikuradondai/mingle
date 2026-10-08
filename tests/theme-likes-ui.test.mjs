import test from 'node:test';
import assert from 'node:assert/strict';

test('theme-like client contract sends only official theme metadata and treats accepted false as success', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };
  globalThis.fetch = async (_url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true, accepted: false }) }; };
  try {
    const analytics = await import(`../dist/analytics.js?theme-like-ui=${Date.now()}`);
    const result = await analytics.submitThemeLike('date');
    assert.equal(result.ok, true);
    assert.equal(analytics.hasThemeLike('date'), true);
    assert.deepEqual(Object.keys(calls[0]).sort(), ['eventId', 'themeId', 'type', 'voterToken']);
    assert.equal(calls[0].themeId, 'date');
    assert.match(calls[0].voterToken, /^[A-Za-z0-9_-]{32,128}$/);
    assert.equal((await analytics.submitThemeLike('date')).already, true);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = originalFetch; delete globalThis.localStorage; }
});

test('theme-like retries after failure and blocks duplicate pending requests', async () => {
  const originalFetch = globalThis.fetch;
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };
  let release; let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 503, json: async () => ({ error: 'analytics_unavailable' }) };
    await new Promise((resolve) => { release = resolve; });
    return { ok: true, json: async () => ({ ok: true, accepted: true }) };
  };
  try {
    const analytics = await import(`../dist/analytics.js?theme-like-retry=${Date.now()}`);
    assert.equal((await analytics.submitThemeLike('friends')).ok, false);
    const pending = analytics.submitThemeLike('friends');
    assert.deepEqual(await analytics.submitThemeLike('friends'), { ok: false, pending: true });
    release();
    assert.equal((await pending).ok, true);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; delete globalThis.localStorage; }
});

test('theme-like keeps in-memory token and liked state when localStorage fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const calls = [];
  globalThis.fetch = async (_url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true, accepted: true }) }; };
  try {
    const analytics = await import(`../dist/analytics.js?theme-like-memory=${Date.now()}`);
    assert.equal((await analytics.submitThemeLike('date')).ok, true);
    assert.equal(analytics.hasThemeLike('date'), true);
    assert.equal((await analytics.submitThemeLike('date')).already, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].voterToken, /^[A-Za-z0-9_-]{32,128}$/);
  } finally { globalThis.fetch = originalFetch; delete globalThis.localStorage; }
});

test('theme-like keeps successful vote when localStorage write fails after a readable state', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = { getItem: () => '[]', setItem() { throw new Error('quota'); } };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, accepted: true }) });
  try {
    const analytics = await import(`../dist/analytics.js?theme-like-write-failure=${Date.now()}`);
    assert.equal((await analytics.submitThemeLike('date')).ok, true);
    assert.equal(analytics.hasThemeLike('date'), true);
  } finally { globalThis.fetch = originalFetch; delete globalThis.localStorage; }
});
