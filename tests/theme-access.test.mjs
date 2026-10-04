import test from 'node:test';
import assert from 'node:assert/strict';
import { decks } from '../dist/data/decks.js';
import { GUEST_THEME_IDS, canGuestUseTheme, canUseTheme, sessionNeedsThemeAccess } from '../dist/theme-access.js';

const pick = (id) => decks.find((deck) => deck.id === id);
const guest = { enabled: true, authReady: true, user: null };
const member = { enabled: true, authReady: true, user: { id: 'member-1' } };

test('guest access is limited to four non-adult themes', () => {
  assert.deepEqual([...GUEST_THEME_IDS], ['date', 'party-first-meeting', 'business-meetup', 'bar-first-meeting']);
  for (const deck of decks) assert.equal(canUseTheme(deck, guest), GUEST_THEME_IDS.has(deck.id));
  assert.equal(canUseTheme(pick('intimacy'), member), true);
  assert.equal(canUseTheme(undefined, member), false);
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
