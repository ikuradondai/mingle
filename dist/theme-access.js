import { decks } from "./data/decks.js";
export const GUEST_THEME_IDS = new Set(['date', 'party-first-meeting', 'business-meetup', 'bar-first-meeting']);

export function isRegisteredAccount(account) {
  return Boolean(account?.enabled && account?.authReady && account?.user?.id);
}

// Age confirmation is server-side account state mirrored into memory only; it is never persisted in the browser.
export function isAgeConfirmed(account) {
  return isRegisteredAccount(account) && typeof account?.ageConfirmedAt === 'string' && account.ageConfirmedAt !== '';
}

// A theme is "adult" when it is an adult-only theme or any of its regular cards is R18.
// Do not use theme-groups isAdultGroup(): it also treats the optional-R18 date themes as adult.
export function isAdultTheme(deck) {
  return Boolean(deck && (deck.adultOnly === true || deck.questions?.some((card) => card?.r18 === true)));
}

export function canGuestUseTheme(deck) {
  return Boolean(deck && !deck.adultOnly && GUEST_THEME_IDS.has(deck.id) && !deck.questions?.some((card) => card.r18));
}

export function canSeeTheme(deck, account) {
  return Boolean(deck) && (!isAdultTheme(deck) || isAgeConfirmed(account));
}

export function canUseTheme(deck, account) {
  return canSeeTheme(deck, account) && (isRegisteredAccount(account) || canGuestUseTheme(deck));
}

// date / acquaintance-date: the optional "include R18 questions" switch.
export function canOfferR18Option(deck, account) {
  return Boolean(deck?.r18Available === true && !deck.adultOnly && Array.isArray(deck.r18Questions) && isAgeConfirmed(account));
}

export function visibleFilterIds(labels, account, mixed) {
  return Object.keys(labels).filter((id) => id !== 'adult' || (!mixed && isAgeConfirmed(account)));
}

export function cardsHaveR18(cards) {
  return Array.isArray(cards) && cards.some((card) => card?.r18 === true);
}

export function sessionHasR18(session) {
  if (!session) return false;
  if (session.includeR18 === true || session.adultConfirmed === true) return true;
  const ids = [session.deckId, ...(Array.isArray(session.deckIds) ? session.deckIds : [])];
  if (ids.some((id) => decks.find((deck) => deck.id === id)?.adultOnly === true)) return true;
  return cardsHaveR18(session.questions) || cardsHaveR18(session.customQuestions);
}

// A venue session started inside a QR whose owner attested the audience is the one exception.
export function canAccessSessionContent(session, account, { activeVenue = false } = {}) {
  return !sessionHasR18(session) || isAgeConfirmed(account) || (activeVenue && session?.venueSession != null);
}

export function sessionNeedsThemeAccess(session, account) {
  if (!session) return false;
  if (session.customSet) return !isRegisteredAccount(account);
  if (session.sharedGuest) return session.includeR18 === true && !isRegisteredAccount(account);
  const ids = session.mixed ? session.deckIds : [session.deckId];
  return !isRegisteredAccount(account) && (session.includeR18 === true || ids.some((id) => !GUEST_THEME_IDS.has(id)));
}

// A venue-attested session is only legitimate while its venue context is still loaded.
export function isActiveVenueSession(session, venue) {
  return Boolean(venue?.token && session?.sharedGuest && session.venueSession && session.venueSetId && venue.sets?.some((set) => set.id === session.venueSetId));
}

// /api/account/me may answer adultConfirmationAvailable:false when the status could not be read.
// Keep the previous confirmation only for the same account; never invent one for a different account.
export function nextAgeConfirmedAt({ previous, sameAccount, confirmedAt, available }) {
  if (typeof confirmedAt === 'string' && confirmedAt !== '') return confirmedAt;
  if (available === false && sameAccount === true && typeof previous === 'string' && previous !== '') return previous;
  return null;
}

// Group-room entry link. includeR18 follows the current consent checkbox.
export function groupRoomHref({ deckId, adultOnly = false, setId = null, setHasR18 = false, offerR18 = false, adultConfirmed = false }) {
  if (setId) return `/group-room.html?set=${encodeURIComponent(setId)}&setAdult=${setHasR18 ? '1' : '0'}`;
  return `/group-room.html?create=${encodeURIComponent(deckId)}&includeR18=${offerR18 && adultConfirmed ? '1' : '0'}${adultOnly ? '&setAdult=1' : ''}`;
}
