import test from 'node:test';
import assert from 'node:assert/strict';
import { decks } from '../dist/data/decks.js';
import { groupLabels } from '../dist/data/theme-groups.js';
import { GUEST_THEME_IDS, canGuestUseTheme, canUseTheme, sessionNeedsThemeAccess, isAgeConfirmed, isAdultTheme, canSeeTheme, canOfferR18Option, visibleFilterIds, cardsHaveR18, sessionHasR18, canAccessSessionContent, isActiveVenueSession, nextAgeConfirmedAt, groupRoomHref, r18Visible, setR18Visible, clearR18Visible, readR18Visible, R18_DISPLAY_KEY } from '../dist/theme-access.js';

const pick = (id) => decks.find((deck) => deck.id === id);
const ADULT_ONLY_IDS = ['intimacy', 'first-intimacy', 'intimacy-refresh', 'intimacy-distance'];
const guest = { enabled: true, authReady: true, user: null };
const member = { enabled: true, authReady: true, user: { id: 'member-1' } };
const confirmed = { enabled: true, authReady: true, user: { id: 'member-1' }, ageConfirmedAt: '2026-10-05T09:12:00.000Z', r18DisplayEnabled: true };
const confirmedOff = { ...confirmed, r18DisplayEnabled: false };
const loading = { enabled: true, authReady: false, user: { id: 'member-1' }, ageConfirmedAt: '2026-10-05T09:12:00.000Z' };

test('guest access is limited to six non-adult themes', () => {
  assert.deepEqual([...GUEST_THEME_IDS], ['date', 'party-first-meeting', 'business-meetup', 'bar-first-meeting', 'friends', 'family-reunion']);
  for (const deck of decks) assert.equal(canUseTheme(deck, guest), GUEST_THEME_IDS.has(deck.id));
  assert.equal(canUseTheme(undefined, member), false);
  assert.equal(canUseTheme(undefined, confirmed), false);
});

test('adult-only themes need an age-confirmed account; unconfirmed members keep every regular theme', () => {
  assert.deepEqual(decks.filter((deck) => deck.adultOnly).map((deck) => deck.id), ADULT_ONLY_IDS);
  for (const id of ADULT_ONLY_IDS) {
    assert.equal(canUseTheme(pick(id), confirmed), true, id);
    assert.equal(canUseTheme(pick(id), member), false, id);
    assert.equal(canUseTheme(pick(id), guest), false, id);
  }
  for (const deck of decks.filter((item) => !item.adultOnly)) assert.equal(canUseTheme(deck, member), true, deck.id);
});

test('adult themes are not even visible to guests, unconfirmed members, or while auth is loading', () => {
  for (const id of ADULT_ONLY_IDS) {
    assert.equal(isAdultTheme(pick(id)), true);
    for (const account of [guest, member, loading, { enabled: false, authReady: true, user: null }, undefined, null]) assert.equal(canSeeTheme(pick(id), account), false, `${id} ${JSON.stringify(account)}`);
    assert.equal(canSeeTheme(pick(id), confirmed), true);
    assert.equal(canSeeTheme(pick(id), confirmedOff), false);
  }
});

test('age confirmation requires a registered account and a server timestamp string', () => {
  assert.equal(isAgeConfirmed(confirmed), true);
  assert.equal(isAgeConfirmed(member), false);
  assert.equal(isAgeConfirmed(loading), false);
  assert.equal(isAgeConfirmed({ ...guest, ageConfirmedAt: '2026-10-05T00:00:00Z' }), false);
  assert.equal(isAgeConfirmed({ ...confirmed, ageConfirmedAt: true }), false);
  assert.equal(isAgeConfirmed({ ...confirmed, ageConfirmedAt: '' }), false);
});

test('R18 display is explicit, account-scoped, and safe when storage is blocked', () => {
  const store = new Map(); const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const account = { ...confirmedOff };
  assert.equal(r18Visible(account), false);
  assert.equal(setR18Visible(account, true, storage), true);
  assert.equal(r18Visible(account), true);
  const other = { ...confirmedOff, user: { id: 'member-2' } };
  assert.equal(readR18Visible(other, storage), false);
  assert.equal(setR18Visible(account, false, storage), false);
  assert.equal(r18Visible(account), false);
  assert.equal(setR18Visible(member, true, storage), false);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(setR18Visible(account, true, blocked), true);
  assert.equal(r18Visible(account), true);
  clearR18Visible(account, blocked);
  assert.equal(r18Visible(account), false);
  assert.equal(store.has(R18_DISPLAY_KEY), false);
});

test('date themes are regular themes; their optional R18 switch needs confirmation', () => {
  for (const id of ['date', 'acquaintance-date']) {
    assert.equal(isAdultTheme(pick(id)), false);
    for (const account of [guest, member, confirmed]) assert.equal(canSeeTheme(pick(id), account), true);
    assert.equal(canOfferR18Option(pick(id), confirmed), true, id);
    assert.equal(canOfferR18Option(pick(id), confirmedOff), false, id);
    assert.equal(canOfferR18Option(pick(id), member), false, id);
    assert.equal(canOfferR18Option(pick(id), guest), false, id);
    assert.equal(canOfferR18Option(pick(id), loading), false, id);
  }
  assert.equal(canOfferR18Option(pick('intimacy'), confirmed), false);
  assert.equal(canOfferR18Option(pick('friends'), confirmed), false);
  assert.equal(canOfferR18Option(undefined, confirmed), false);
});

test('the R18 filter chip is offered only to confirmed accounts outside mix mode', () => {
  assert.ok(Object.hasOwn(groupLabels, 'adult'));
  assert.equal(visibleFilterIds(groupLabels, guest, false).includes('adult'), false);
  assert.equal(visibleFilterIds(groupLabels, member, false).includes('adult'), false);
  assert.equal(visibleFilterIds(groupLabels, confirmed, false).includes('adult'), true);
  assert.equal(visibleFilterIds(groupLabels, confirmedOff, false).includes('adult'), false);
  assert.equal(visibleFilterIds(groupLabels, confirmed, true).includes('adult'), false);
  assert.deepEqual(visibleFilterIds(groupLabels, guest, false), Object.keys(groupLabels).filter((id) => id !== 'adult'));
});

test('guest theme candidates contain no R18 cards', () => {
  for (const id of GUEST_THEME_IDS) assert.equal(canGuestUseTheme(pick(id)), true);
  assert.equal(canGuestUseTheme(pick('intimacy')), false);
});

test('locked sessions require registration while allowed guest sessions resume', () => {
  assert.equal(sessionNeedsThemeAccess({ deckId: 'omiai', mixed: false, includeR18: false }, guest), true);
  assert.equal(sessionNeedsThemeAccess({ deckId: 'intimacy', mixed: false, includeR18: false }, guest), true);
  assert.equal(sessionNeedsThemeAccess({ deckId: 'date', mixed: false, includeR18: false }, guest), false);
  assert.equal(sessionNeedsThemeAccess({ deckIds: ['date', 'party-first-meeting'], mixed: true, includeR18: false }, guest), false);
  assert.equal(sessionNeedsThemeAccess({ sharedGuest: true, includeR18: false }, guest), false);
  assert.equal(sessionNeedsThemeAccess({ sharedGuest: true, includeR18: true }, guest), true);
  assert.equal(sessionNeedsThemeAccess({ sharedGuest: true, includeR18: true }, member), false);
  assert.equal(sessionNeedsThemeAccess({ customSet: true, includeR18: false }, guest), true);
  assert.equal(sessionNeedsThemeAccess({ customSet: true, includeR18: false }, member), false);
  assert.equal(sessionNeedsThemeAccess({ deckId: 'omiai', mixed: false, includeR18: false }, member), false);
});

test('sessionHasR18 detects every way a session can carry R18 content', () => {
  assert.equal(cardsHaveR18([{ r18: false }, { r18: true }]), true);
  assert.equal(cardsHaveR18([{ r18: false }]), false);
  assert.equal(cardsHaveR18(undefined), false);
  assert.equal(sessionHasR18(null), false);
  assert.equal(sessionHasR18({ deckId: 'friends', deckIds: ['friends'], mixed: false, includeR18: false, adultConfirmed: false, questions: [{ id: 'a', r18: false }] }), false);
  assert.equal(sessionHasR18({ deckId: 'date', includeR18: true }), true);
  assert.equal(sessionHasR18({ deckId: 'date', adultConfirmed: true }), true);
  assert.equal(sessionHasR18({ deckId: 'intimacy', deckIds: ['intimacy'] }), true);
  assert.equal(sessionHasR18({ deckId: 'mix', mixed: true, deckIds: ['friends', 'first-intimacy'] }), true);
  assert.equal(sessionHasR18({ deckId: 'my-set', customSet: true, questions: [{ id: 'x', r18: true }] }), true);
  assert.equal(sessionHasR18({ deckId: 'my-set', customQuestions: [{ id: 'custom:1', r18: true }] }), true);
});

test('only an attested venue session may hold R18 content without age confirmation', () => {
  const venue = { deckId: 'shared-set', sharedGuest: true, includeR18: true, adultConfirmed: true, venueSession: 'token', questions: [{ id: 'v', r18: true }] };
  const plain = { deckId: 'friends', deckIds: ['friends'], questions: [{ id: 'a', r18: false }] };
  assert.equal(canAccessSessionContent(plain, guest), true);
  assert.equal(canAccessSessionContent(venue, guest), false);
  assert.equal(canAccessSessionContent(venue, guest, { activeVenue: true }), false);
  assert.equal(canAccessSessionContent(venue, guest, { activeVenue: true, venueDisplay: true }), true);
  assert.equal(canAccessSessionContent({ ...venue, venueSession: undefined }, guest, { activeVenue: true }), false);
  assert.equal(canAccessSessionContent({ deckId: 'intimacy', deckIds: ['intimacy'] }, member, { activeVenue: true }), false);
  assert.equal(canAccessSessionContent({ deckId: 'intimacy', deckIds: ['intimacy'] }, confirmed), true);
});

test('a venue R18 session stays valid only while the venue context is loaded (logout clears it)', () => {
  const session = { sharedGuest: true, venueSession: { id: 'v' }, venueSetId: 's1' };
  const venue = { token: 't', sets: [{ id: 's1' }] };
  assert.equal(isActiveVenueSession(session, venue), true);
  assert.equal(isActiveVenueSession(session, null), false);
  assert.equal(isActiveVenueSession(session, { token: 't', sets: [{ id: 'other' }] }), false);
  assert.equal(isActiveVenueSession({ ...session, venueSession: null }, venue), false);
});

test('app.js purges R18 sessions with the venue-context check, not the snapshot-only check', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.equal(source.includes('isVenueSessionSnapshot'), false);
  assert.match(source, /sessionHasR18\(state\.session\) && !isActiveVenueSession\(state\.session\)/);
  assert.match(source, /sessionHasR18\(state\.resume\) && !isActiveVenueSession\(state\.resume\)/);
});

test('availability:false keeps the previous confirmation only for the same account', () => {
  const at = '2026-10-05T09:12:00.000Z';
  assert.equal(nextAgeConfirmedAt({ previous: at, sameAccount: true, confirmedAt: null, available: false }), at);
  assert.equal(nextAgeConfirmedAt({ previous: at, sameAccount: false, confirmedAt: null, available: false }), null);
  assert.equal(nextAgeConfirmedAt({ previous: at, sameAccount: true, confirmedAt: null, available: true }), null);
  assert.equal(nextAgeConfirmedAt({ previous: null, sameAccount: true, confirmedAt: null, available: false }), null);
  assert.equal(nextAgeConfirmedAt({ previous: at, sameAccount: true, confirmedAt: '2026-10-06T00:00:00.000Z', available: false }), '2026-10-06T00:00:00.000Z');
  assert.equal(nextAgeConfirmedAt({ previous: at, sameAccount: true, confirmedAt: 123, available: true }), null);
});

test('group room link includeR18 follows the consent checkbox', () => {
  const base = { deckId: 'date', offerR18: true };
  assert.equal(groupRoomHref({ ...base, adultConfirmed: false }), '/group-room.html?create=date&includeR18=0');
  assert.equal(groupRoomHref({ ...base, adultConfirmed: true }), '/group-room.html?create=date&includeR18=1');
  assert.equal(groupRoomHref({ ...base, offerR18: false, adultConfirmed: true }), '/group-room.html?create=date&includeR18=0');
  assert.equal(groupRoomHref({ deckId: 'intimacy', adultOnly: true }), '/group-room.html?create=intimacy&includeR18=0&setAdult=1');
  assert.equal(groupRoomHref({ setId: 'a b', setHasR18: true }), '/group-room.html?set=a%20b&setAdult=1');
  assert.equal(groupRoomHref({ deckId: 'date', plannedParticipantCount: 3 }), '/group-room.html?create=date&includeR18=0&planned=3');
  assert.equal(groupRoomHref({ deckId: 'date', plannedParticipantCount: 9 }), '/group-room.html?create=date&includeR18=0');
});
