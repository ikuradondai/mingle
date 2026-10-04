export const GUEST_THEME_IDS = new Set(['date', 'party-first-meeting', 'business-meetup', 'bar-first-meeting']);

export function isRegisteredAccount(account) {
  return Boolean(account?.enabled && account?.authReady && account?.user?.id);
}

export function canGuestUseTheme(deck) {
  return Boolean(deck && !deck.adultOnly && GUEST_THEME_IDS.has(deck.id) && !deck.questions?.some((card) => card.r18));
}

export function canUseTheme(deck, account) {
  return Boolean(deck) && (isRegisteredAccount(account) || canGuestUseTheme(deck));
}

export function sessionNeedsThemeAccess(session, account) {
  if (!session) return false;
  if (session.customSet) return !isRegisteredAccount(account);
  if (session.sharedGuest) return session.includeR18 === true && !isRegisteredAccount(account);
  const ids = session.mixed ? session.deckIds : [session.deckId];
  return !isRegisteredAccount(account) && (session.includeR18 === true || ids.some((id) => !GUEST_THEME_IDS.has(id)));
}
