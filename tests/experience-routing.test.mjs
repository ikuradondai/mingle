import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../dist/about/experience-routing.js', import.meta.url), 'utf8');
const context = { URL, URLSearchParams, console };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'experience-routing.js' });
const routing = context.MingleExperienceRouting;
const equalResult = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

function storage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key), data };
}

test('resolve applies query, exact campaigns, saved choice, then default', () => {
  const saved = storage({ 'mingle.lp.experience.v1': JSON.stringify({ v: 1, experience: 'team', at: 1_000 }) });
  equalResult(routing.resolve({ search: '?experience=date&utm_content=mingle-team', storage: saved, now: 2_000 }), { experience: 'date', source: 'query' });
  equalResult(routing.resolve({ search: '?utm_content=mingle-date&utm_campaign=mingle-team', storage: saved, now: 2_000 }), { experience: 'date', source: 'utm_content' });
  equalResult(routing.resolve({ search: '?utm_content=unknown&utm_campaign=mingle-team', storage: saved, now: 2_000 }), { experience: 'team', source: 'utm_campaign' });
  equalResult(routing.resolve({ search: '', storage: saved, now: 2_000 }), { experience: 'team', source: 'saved' });
  equalResult(routing.resolve({ search: '?utm_campaign=product-update-team', storage: storage(), now: 2_000 }), { experience: 'everyday', source: 'default' });
  equalResult(routing.resolve({ search: '?utm_campaign=product-update', storage: storage(), now: 2_000 }), { experience: 'everyday', source: 'default' });
  equalResult(routing.resolve({ search: '?utm_campaign=network', storage: storage(), now: 2_000 }), { experience: 'everyday', source: 'default' });
  equalResult(routing.resolve({ search: '?experience=invalid&utm_campaign=MiNgLe-TeAm', storage: storage(), now: 2_000 }), { experience: 'team', source: 'utm_campaign' });
  equalResult(routing.resolve({ search: '?utm_content=MINGLE-DATE', storage: storage(), now: 2_000 }), { experience: 'date', source: 'utm_content' });
});

test('saved values require version, enum, finite non-future timestamp and less than 30 days', () => {
  const max = 30 * 24 * 60 * 60 * 1000;
  const s = storage({ 'mingle.lp.experience.v1': JSON.stringify({ v: 1, experience: 'date', at: 100 }) });
  equalResult(routing.resolve({ storage: s, now: 100 }), { experience: 'date', source: 'saved' });
  for (const value of [
    { v: 1, experience: 'unknown', at: 100 }, { v: 1, experience: 'date' }, { v: 1, experience: 'date', at: null },
    { v: 1, experience: 'date', at: '100' }, { v: 1, experience: 'date', at: 101 },
    { v: 1, experience: 'date', at: 100 - max }, { v: 1, experience: 'date', at: 100 - max + 1 },
    { v: 2, experience: 'date', at: 100 },
  ]) {
    const invalid = storage({ 'mingle.lp.experience.v1': JSON.stringify(value) });
    const expected = value.at === 100 - max + 1 ? { experience: 'date', source: 'saved' } : { experience: 'everyday', source: 'default' };
    equalResult(routing.resolve({ storage: invalid, now: 100 }), expected);
    assert.equal(invalid.data.has('mingle.lp.experience.v1'), expected.source === 'saved');
  }
  for (const raw of ['{broken', '{"v":1,"experience":"date","at":1e999}']) {
    const invalid = storage({ 'mingle.lp.experience.v1': raw });
    equalResult(routing.resolve({ storage: invalid, now: 100 }), { experience: 'everyday', source: 'default' });
    assert.equal(invalid.data.has('mingle.lp.experience.v1'), false);
  }
});

test('remember and forget tolerate storage exceptions and campaign values are not saved', () => {
  const s = storage();
  assert.equal(routing.remember(s, 'DATE', 500), true);
  assert.deepEqual(JSON.parse(s.data.get('mingle.lp.experience.v1')), { v: 1, experience: 'date', at: 500 });
  assert.equal(routing.forget(s), true);
  const campaignOnly = storage();
  equalResult(routing.resolve({ search: '?utm_campaign=mingle-date', storage: campaignOnly, now: 500 }), { experience: 'date', source: 'utm_campaign' });
  assert.equal(campaignOnly.data.size, 0);
  assert.equal(routing.remember(s, 'unknown', 500), false);
  assert.equal(routing.remember(s, 'team', Number.NaN), false);
  assert.equal(routing.remember(s, 'team', Number.POSITIVE_INFINITY), false);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  equalResult(routing.resolve({ storage: broken, now: 500 }), { experience: 'everyday', source: 'default' });
  assert.equal(routing.remember(broken, 'team', 500), false);
  assert.equal(routing.forget(broken), false);
});

test('selection preserves parameters and reset removes only experience and recognized campaign tags', () => {
  const selected = routing.selectionUrl('https://mingle.local/about/?utm_source=x&utm_campaign=mingle-team#top', 'date');
  assert.equal(selected, 'https://mingle.local/about/?utm_source=x&utm_campaign=mingle-team&experience=date#top');
  assert.equal(routing.resetUrl(selected), 'https://mingle.local/about/?utm_source=x#top');
  assert.equal(routing.resetUrl('/about/?experience=bad&utm_campaign=product-update&utm_content=mingle-date&x=1'), '/about/?utm_campaign=product-update&x=1');
  const manual = routing.selectionUrl('/about/?utm_source=x#top', 'team');
  equalResult(routing.resolve({ search: new URL(manual, 'https://mingle.local').search, storage: storage(), now: 1 }), { experience: 'team', source: 'query' });
  const reset = routing.resetUrl(manual);
  equalResult(routing.resolve({ search: new URL(reset, 'https://mingle.local').search, storage: storage(), now: 1 }), { experience: 'everyday', source: 'default' });
});
