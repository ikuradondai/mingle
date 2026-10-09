import { decks } from "./data/decks.js";
import { soloDecks, soloCategories } from "./data/solo-decks.js";
import { trackPage, trackThemeStart, trackSessionProgress, hasThemeLike, submitThemeLike } from "./analytics.js";
import { loadSession, saveSession, clearSession } from "./session-storage.js";
import { canContinue } from "./access-policy.js";
import { ROUND_SIZE, isTogetherCard, createSession, createMixedSession, createSavedSession, createSharedSession, createSoloSession, currentAnswerLikes, currentCard, currentParticipantIndex, currentSpeaker, isFinished, isRoundComplete, likeCurrentAnswer, nextAnswer, passAnswer, previousAnswer, remaining, revealCard, continueRound, normalizeParticipants, MAX_NAME_LENGTH, MAX_PARTICIPANTS, summarizeLikes, completedRoundFavoriteCards } from "./engine.js";
import { themeGroups, groupLabels } from "./data/theme-groups.js";
import { buildFeedbackPayload, feedbackKey, submitFeedback } from "./feedback.js";
import { accountConfig, accountApi, cardPayload, discoverAccountConfig } from "./account.js";
import { renderLibrary, canonicalCard } from "./account-library.js";
import { renderAd } from "./ad-config.js";
import { playableSavedSets } from "./my-set.js";
import { resetStudioEntryState } from "./studio-state.js";
import { buildFacebookShareUrl, buildShareText, buildXShareUrl } from "./share-text.js";
import { isCardAudioEnabled, toggleCardAudio, playFlipSound } from "./card-audio.js";
import { cardDesignForSession, soloMotifForDeck } from "./card-design.js";
import { CREATOR_PRESET_IDS, normalizeCreatorDesign, effectiveCreatorAdult } from "./creator-metadata.js";
import { themeExplorerImage, themeExplorerHistory, recordThemeExplorerStart, rankThemeRecommendations, themeExplorerBookmarks, toggleThemeExplorerBookmark, themeExplorerExperienced, toggleThemeExplorerExperienced } from "./theme-explorer.js";
import { loadRecommendationLabels, recommendationLabel } from "./recommendation-labels.js";
import { themeExampleForDeck } from "./theme-examples.js";
import { GUEST_THEME_IDS, canUseTheme as canUseThemeForAccount, sessionNeedsThemeAccess, isAgeConfirmed, canSeeTheme, canOfferR18Option, visibleFilterIds, sessionHasR18, canAccessSessionContent, isActiveVenueSession as isActiveVenueSessionFor, nextAgeConfirmedAt, groupRoomHref, r18Visible, setR18Visible, clearR18Visible, readR18Visible } from "./theme-access.js";
import { participantRuleForDeck, participantRuleForSavedSet, participantRuleForSession, displayQuestionText } from "./participant-rule.js";
import { consumeMinorityAuthIntent, clearMinorityAuthIntent } from "./minority-auth-intent.js";
import { consumeQuestionWolfAuthIntent, saveQuestionWolfAuthIntent } from "./question-wolf-auth-intent.js";
import { consumeOchiAuthIntent, saveOchiAuthIntent } from "./ochi-auth-intent.js";
import { consumeOneCutAuthIntent, saveOneCutAuthIntent } from "./one-cut-auth-intent.js";
import { consumeMissionAuthIntent, saveMissionAuthIntent } from "./mission-mingle-auth-intent.js";
import { gameCardImage } from "./game-card-images.js";
import { groupGames } from "./data/game-registry.js";
import { gameParticipantGate } from "./game-participant-gate.js";
import { consumeSocialGameIntent, saveSocialGameIntent } from "./social-game-intent.js";
const root = document.querySelector("#app");
const state = {
  shared: null,
  venue: null,
  selectedVenueSetId: null,
  sharedLoading: false,
  sharedRequestId: 0,
  shareStatus: "",
  shareMenuOpen: false,
  shareFallbackText: "",
  participantNameOrigin: null,
  participantNameAutoValue: "",
  participantNameUserEdited: false,
  groupParticipants: ["", ""],
  screen: "participants",
  participants: ["", ""],
  session: null,
  continuePending: null,
  pendingCustomResume: null,
  error: "", busy: false, feedbackBusy: false, feedbackRequestToken: 0, feedback: null, roundFeedbackExpanded: false, roundFavorite: null, roundLikeExpanded: false, roundLikeKey: null, themeLikePending: new Set(), themeLikeStatus: Object.create(null), lastAdvanceAt: 0, focusAction: null, focusSelector: null, shareDialogOpen: false, selectedDeckId: "friends", selectedMySetId: null, soloNoteDraft: "", soloNoteStatus: "", soloNoteError: "", soloSummaryDraft: "", soloSummaryStatus: "", soloDraftOwner: null, soloDraftRevision: 0, soloMemoOpen: false, soloMemoKey: "", soloHistoryOpen: false, soloHistory: [], soloHistoryCursor: null, soloHistoryHasMore: false, soloHistoryLoading: false, soloHistoryError: "", soloHistoryEditing: null, soloNoteDrafts: Object.create(null), soloNoteStatuses: Object.create(null), soloNoteErrors: Object.create(null), soloSummaryDrafts: Object.create(null), soloSummaryStatuses: Object.create(null), soloSummaryErrors: Object.create(null),
  selectedDeckIds: ["friends"],
  themeMode: "single", participantTab: "group",
  filter: "all", adultConfirmed: false, includeChallenges: false, resume: null, themeExplorerView: "cards", themeExplorerQuery: "", themeExplorerShelf: "all", themeExplorerTagFilter: "all", themeOptionsOpen: false, account: { enabled: accountConfig.enabled, authReady: false, google: accountConfig.google, user: null, favorites: new Set(), customCards: [], customCardsAvailable: false, sets: [], open: false, libraryOpen: false, settingsOpen: false, deleteOpen: false, deleteConfirmed: false,
    shareOpen: false,
    shareBusy: false,
    shareRequestId: 0,
    qrBusy: false,
    qrError: "",
    share: null,
    profileDraft: "",
    avatarUrl: "",
    avatarDraft: "",
    avatarRevision: 0,
    avatarBusy: false,
    avatarError: "",
    deletionAvailable: false,
    email: "",
    otp: "", otpSent: false, pendingSet: null, selectedCards: new Set(), editingSetId: null, setName: undefined, customEditorOpen: false, editingCardId: null, customDraft: "",
    customDraftR18: false,
    drafts: [], draftsAvailable: false, completionAvailable: false, aiGenerationAvailable: false, studioMode: "list", studioAiReturnMode: "list", studioAudience: "group", studioQuestionOrder: "shuffle", studioR18: false, studioDesign: null, editingDraftId: null, studioItems: [], studioRequestId: 0, studioReplaceIndex: null, aiQuestions: [], aiName: "", aiTheme: "", aiTone: "", aiCount: 6, aiR18: false,
    revealAdult: false, r18DisplayEnabled: false, r18DisplayHydrated: false,
    ageConfirmedAt: null, adultConfirmationAvailable: false, adultIntent: false, ageConfirmChecked: false, ageRevokeOpen: false, ageBusy: false,
    status: "", returnAfterAuth: false, venueOnboarding: false, hasVenue: false,
    error: "",
    busy: false,
    generation: 0,
    profileRevision: 0,
    guestNormalizedGeneration: -1,
  },
};
try { const savedExplorerView = localStorage.getItem("mingle.theme-explorer.view.v1"); if (savedExplorerView === "list" || savedExplorerView === "cards") state.themeExplorerView = savedExplorerView; } catch {}
const AUTH_RETURN_KEY = "mingle.cards.auth-return.v1";
const LIBRARY_RETURN_KEY = "mingle.cards.library-return.v1";
const VENUE_ONBOARDING_KEY = "mingle.cards.venue-onboarding.v1";
function loadVenueOnboardingIntent() { try { const value = JSON.parse(sessionStorage.getItem(VENUE_ONBOARDING_KEY) || "null"); if (value?.expiresAt >= Date.now()) return true; sessionStorage.removeItem(VENUE_ONBOARDING_KEY); } catch {} return false; }
function saveVenueOnboardingIntent() { try { sessionStorage.setItem(VENUE_ONBOARDING_KEY, JSON.stringify({ createdAt: Date.now(), expiresAt: Date.now() + 30 * 60 * 1000 })); } catch {} }
function clearVenueOnboardingIntent() { try { sessionStorage.removeItem(VENUE_ONBOARDING_KEY); } catch {} state.account.venueOnboarding = false; }
function saveLibraryReturnIntent() { try { const createdAt = Date.now(); sessionStorage.setItem(LIBRARY_RETURN_KEY, JSON.stringify({ createdAt, expiresAt: createdAt + 30 * 60 * 1000, kind: "library" })); } catch {} }
function loadLibraryReturnIntent() { try { const value = JSON.parse(sessionStorage.getItem(LIBRARY_RETURN_KEY) || "null"); if (value?.kind === "library" && value.expiresAt >= Date.now() && value.createdAt <= Date.now() && value.expiresAt - value.createdAt <= 30 * 60 * 1000) return true; sessionStorage.removeItem(LIBRARY_RETURN_KEY); } catch {} return false; }
function clearLibraryReturnIntent() { try { sessionStorage.removeItem(LIBRARY_RETURN_KEY); } catch {} state.account.libraryReturn = false; }
const venueOnboardingQuery = new URLSearchParams(location.search).get('venueOnboarding') === '1';
const libraryQuery = new URLSearchParams(location.search).get('library') === '1';
const minorityAuthQuery = new URLSearchParams(location.search).get('minorityAuth') === '1';
const questionWolfAuthQuery = new URLSearchParams(location.search).get('questionWolfAuth') === '1';
const ochiAuthQuery = new URLSearchParams(location.search).get('ochiAuth') === '1';
const oneCutAuthQuery = new URLSearchParams(location.search).get('oneCutAuth') === '1';
const missionAuthQuery = new URLSearchParams(location.search).get('missionAuth') === '1';
const socialGameReturnQuery = new URLSearchParams(location.search).get('socialGameReturn') === '1';
if (libraryQuery) { saveLibraryReturnIntent(); state.account.libraryReturn = true; history.replaceState({}, '', `${location.pathname}${location.hash}`); }
if (venueOnboardingQuery) { clearLibraryReturnIntent(); saveVenueOnboardingIntent(); state.account.venueOnboarding = true; history.replaceState({}, '', `${location.pathname}${location.hash}`); }
else { state.account.venueOnboarding = loadVenueOnboardingIntent(); if (!state.account.venueOnboarding && loadLibraryReturnIntent()) state.account.libraryReturn = true; }
if (minorityAuthQuery) { state.account.open = true; state.account.status = 'ログイン後にルーム作成へ戻ります。'; state.focusSelector = '[data-account-email]'; history.replaceState({}, '', `${location.pathname}${location.hash}`); }
if (ochiAuthQuery) { state.account.open = true; state.account.status = 'ログイン後にオチから話してのルーム作成へ戻ります。'; state.focusSelector = '[data-account-email]'; history.replaceState({}, '', `${location.pathname}${location.hash}`); }
if (oneCutAuthQuery) { state.account.open = true; state.account.status = 'ログイン後にワンカットのルーム作成へ戻ります。'; state.focusSelector = '[data-account-email]'; history.replaceState({}, '', `${location.pathname}${location.hash}`); }
if (missionAuthQuery) { state.account.open = true; state.account.status = 'ログイン後にミッション・ミングルのルーム作成へ戻ります。'; state.focusSelector = '[data-account-email]'; history.replaceState({}, '', `${location.pathname}${location.hash}`); }
if (questionWolfAuthQuery) { state.account.open = true; state.account.status = 'ログイン後に質問ウルフのルーム作成へ戻ります。'; state.focusSelector = '[data-account-email]'; history.replaceState({}, '', `${location.pathname}${location.hash}`); }
if (socialGameReturnQuery) {
  const returned = consumeSocialGameIntent();
  if (returned) {
    state.participants = [...returned.names];
    state.groupParticipants = [...returned.names];
    state.participantNameOrigin = null;
    state.participantNameAutoValue = '';
    state.participantNameUserEdited = true;
    state.themeMode = 'single';
    state.participantTab = 'group';
    state.screen = 'decks';
    state.themeExplorerShelf = 'game';
    state.selectedDeckId = 'friends';
    state.selectedDeckIds = ['friends'];
    state.selectedMySetId = null;
  }
  const returnUrl = new URL(location.href);
  returnUrl.searchParams.delete('socialGameReturn');
  history.replaceState({}, '', `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
}
function saveAuthReturnIntent() {
  if (state.screen === "play" && state.session?.mode === "solo") {
    const sessionId = state.session.sessionId;
    const card = currentCard(state.session);
    const noteKey = card ? `${sessionId}:${card.id}` : "";
    const summaryDrafts = Object.fromEntries(Object.entries(state.soloSummaryDrafts).filter(([key]) => key.startsWith(`${sessionId}:`)));
    const noteDrafts = Object.fromEntries(Object.entries(state.soloNoteDrafts).filter(([key]) => key.startsWith(`${sessionId}:`)));
    const createdAt = Date.now();
    try { sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify({ createdAt, expiresAt: createdAt + 30 * 60 * 1000, screen: "play", session: state.session, draftOwnerUserId: state.account.user?.id || null, soloMemoOpen: state.soloMemoOpen, noteDrafts, summaryDrafts, noteKey })); } catch {}
    return;
  }
  if (state.screen === "decks" && state.themeMode === "solo") {
    const createdAt = Date.now();
    try { sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify({ createdAt, expiresAt: createdAt + 30 * 60 * 1000, screen: "decks", themeMode: "solo", selectedDeckId: state.selectedDeckId, selectedMySetId: state.selectedMySetId, soloHistoryOpen: state.soloHistoryOpen === true })); } catch {}
    return;
  }
  if (state.screen !== "decks" && state.screen !== "participants") return;
  const createdAt = Date.now();
  try { sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify({ createdAt, expiresAt: createdAt + 30 * 60 * 1000, screen: state.screen, participants: state.participants.slice(0, 8), selectedDeckId: state.selectedDeckId, selectedDeckIds: state.selectedDeckIds.slice(0, 3), themeMode: state.themeMode, filter: state.filter })); } catch {}
}
function restoreAuthReturnIntent() {
  let intent = null;
  try { intent = JSON.parse(sessionStorage.getItem(AUTH_RETURN_KEY) || "null"); sessionStorage.removeItem(AUTH_RETURN_KEY); } catch { return; }
  if (!intent || !["decks", "participants", "play"].includes(intent.screen)) return;
  const now = Date.now();
  if (!Number.isFinite(intent.createdAt) || !Number.isFinite(intent.expiresAt) || intent.expiresAt < now || intent.createdAt > now || intent.expiresAt - intent.createdAt > 30 * 60 * 1000) return;
  if (intent.screen === "play") {
    if (!intent.session || intent.session.mode !== "solo" || !intent.session.sessionId || !Array.isArray(intent.session.questions)) return;
    if (intent.draftOwnerUserId && intent.draftOwnerUserId !== state.account.user?.id) return;
    const memory = { value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; }, removeItem() { this.value = null; } };
    try { saveSession(intent.session, { storage: memory, now, allowCompleted: true }); } catch { return; }
    const validated = loadSession({ storage: memory, now, allowCompleted: true }); if (!validated || validated.mode !== "solo") return;
    const ids = new Set(validated.questions.map((card) => card.id)); const prefix = `${validated.sessionId}:`; const validDraft = (value) => typeof value === "string" && Array.from(value).length <= 2000; const noteDrafts = Object.fromEntries(Object.entries(intent.noteDrafts || {}).filter(([key, value]) => { const cardId = key.startsWith(prefix) ? key.slice(prefix.length) : ""; return ids.has(cardId) && validDraft(value); })); const summaryDrafts = Object.fromEntries(Object.entries(intent.summaryDrafts || {}).filter(([key, value]) => { const suffix = key.startsWith(prefix) ? key.slice(prefix.length) : ""; return /^\d+$/.test(suffix) && Number(suffix) >= 1 && Number(suffix) <= Math.ceil(validated.questions.length / ROUND_SIZE) && validDraft(value); }));
    state.session = validated; state.resume = null; state.screen = "play"; state.themeMode = "solo"; state.participants = [...state.session.participants]; state.selectedDeckId = state.session.deckId; state.selectedDeckIds = [...(state.session.deckIds || [state.session.deckId])]; state.soloMemoOpen = intent.soloMemoOpen === true; state.soloMemoKey = state.soloMemoOpen && currentCard(validated) ? `${validated.sessionId}:${currentCard(validated).id}` : ""; state.soloNoteDrafts = Object.assign(Object.create(null), noteDrafts); state.soloSummaryDrafts = Object.assign(Object.create(null), summaryDrafts); state.soloNoteStatuses = Object.create(null); state.soloNoteErrors = Object.create(null); state.soloSummaryStatuses = Object.create(null); state.soloSummaryErrors = Object.create(null); return;
  }
  if (intent.screen === "decks" && intent.themeMode === "solo") {
    state.screen = "decks"; state.themeMode = "solo"; state.selectedDeckId = typeof intent.selectedDeckId === "string" ? intent.selectedDeckId : state.selectedDeckId; state.selectedDeckIds = [state.selectedDeckId]; state.selectedMySetId = typeof intent.selectedMySetId === "string" ? intent.selectedMySetId : null; state.soloHistoryOpen = intent.soloHistoryOpen === true; if (state.soloHistoryOpen && state.account.user) loadSoloHistory(false); return;
  }
  if (!Array.isArray(intent.participants) || intent.participants.length < 2 || intent.participants.length > 8 || !intent.participants.every((name) => typeof name === "string" && name.length <= MAX_NAME_LENGTH && !/[\u0000-\u001f\u007f]/u.test(name))) return;
  state.participants = intent.participants;
  if (intent.screen === "participants") { state.screen = "participants"; return; }
  const validIds = new Set(decks.filter((deck) => canSeeTheme(deck, state.account)).map((deck) => deck.id));
  const ids = Array.isArray(intent.selectedDeckIds) ? intent.selectedDeckIds.filter((id) => validIds.has(id)).slice(0, 3) : [];
  state.selectedDeckIds = ids.length ? ids : ["date"];
  state.selectedDeckId = validIds.has(intent.selectedDeckId) ? intent.selectedDeckId : state.selectedDeckIds[0];
  state.themeMode = intent.themeMode === "mixed" ? "mixed" : "single";
  state.participantTab = state.themeMode === "mixed" ? (state.selectedDeckIds.some((id) => participantRuleForDeck(id) === "pair") ? "pair" : "group") : participantRuleForDeck(state.selectedDeckId);
  state.filter = typeof intent.filter === "string" && Object.hasOwn(groupLabels, intent.filter) && visibleFilterIds(groupLabels, state.account, state.themeMode === "mixed").includes(intent.filter) ? intent.filter : "all";
  state.adultConfirmed = false;
  state.screen = "decks";
}
// Guests can start a small set of non-adult themes.  Keep the full deck list
// visible so registration can be discovered without making locked themes
// selectable.
function accountAccessReady() { return state.account.enabled && state.account.authReady; }
function isRegisteredUser() { return Boolean(accountAccessReady() && state.account.user?.id); }
function canUseDeck(deck) { return canUseThemeForAccount(deck, state.account); }
function ageConfirmed() { return isAgeConfirmed(state.account); }
function r18DisplayVisible() { return state.account.r18DisplayEnabled === true && ageConfirmed(); }
function r18Storage() { try { return globalThis.sessionStorage; } catch { return null; } }
function setR18DisplayVisible(visible) {
  state.account.r18DisplayEnabled = setR18Visible(state.account, visible === true, r18Storage());
  if (!state.account.r18DisplayEnabled) {
    if (state.venue) state.venue.displayR18 = false;
    if (state.filter === "adult") state.filter = "all";
    const hadAdultAi = state.account.aiR18 === true || (Array.isArray(state.account.aiQuestions) && state.account.aiQuestions.some((question) => question?.r18 === true));
    state.account.aiR18 = false;
    if (hadAdultAi) { state.account.aiTheme = ""; state.account.aiTone = ""; }
    if (state.account.customDraftR18 === true) { state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = ""; }
    state.account.aiQuestions = Array.isArray(state.account.aiQuestions) ? state.account.aiQuestions.filter((question) => question.r18 !== true) : [];
    const hasAdultStudioItem = Array.isArray(state.account.studioItems) && state.account.studioItems.some((item) => item?.r18 === true || (item?.kind === "saved" && canonicalCard(item.cardId, state.account.customCards)?.r18 === true));
    if (hasAdultStudioItem || state.account.editingSetId && playableSavedSets(state.account.sets, state.account.customCards).some((set) => set.id === state.account.editingSetId && set.hasR18)) {
      state.account.studioMode = "list"; state.account.editingSetId = null; state.account.editingDraftId = null; state.account.studioItems = []; state.account.selectedCards = new Set(); state.account.setName = undefined;
    }
    if (state.selectedMySetId) {
      const selected = playableSavedSets(state.account.sets, state.account.customCards).find((set) => set.id === state.selectedMySetId);
      if (selected?.hasR18) state.selectedMySetId = null;
    }
  }
  render();
  if (state.account.r18DisplayEnabled && state.soloHistoryOpen && state.account.user) loadSoloHistory(false);
}
function r18DisplayToggle() { return ageConfirmed() ? `<label class="r18-display-toggle"><input type="checkbox" data-r18-display ${r18DisplayVisible() ? "checked" : ""}/> <span>R18を表示する</span></label>` : ""; }
function venueR18Hidden(session = state.session) { return Boolean(state.venue && session?.venueSession && sessionHasR18(session) && !(state.venue.ageTapped === true && state.venue.displayR18 === true)); }
function venueR18Gate(session) { return `<div class="venue-r18-display-gate"><p>R18を表示するまで、店舗テーマの名前と質問を非表示にしています。</p><label class="adult-consent"><input type="checkbox" data-venue-play-r18 ${state.venue?.displayR18 ? "checked" : ""}/> <span>R18を表示する</span></label></div>${state.account.open ? accountView({ overlayOnly: true }) : ""}`; }
function canSeeDeck(deck) { return canSeeTheme(deck, state.account); }
function canOfferR18(deck) { return canOfferR18Option(deck, state.account); }
const AGE_REQUIRED_MESSAGE = "R18は、アカウント設定で18歳以上の確認をすると利用できます。";
const ADULT_INTENT_KEY = "mingle.cards.adult-intent.v1";
function formatConfirmedDate(iso) { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`; }
function adultErrorMessage(error, fallback) {
  const code = String(error?.message || "");
  if (code === "AGE_CONFIRMATION_REQUIRED") return AGE_REQUIRED_MESSAGE;
  if (code === "ADULT_ATTESTATION_REQUIRED") return "参加者全員が18歳以上であることの確認が必要です。";
  if (code === "PARTICIPANT_AGE_REQUIRED") return "18歳以上であることの確認が必要です。";
  if (code === "FEATURE_UNAVAILABLE") return "現在利用できません。";
  return fallback;
}
// Venue sessions started inside an attested QR are the only R18 sessions a non-confirmed account may hold,
// and only while the venue context (state.venue) is still loaded: logout / account switch clears state.venue first.
// Clears R18 play state (memory and the stored resume) on logout, identity change and revocation.
function purgeAdultSessions() {
  try { if (!state.account.user || state.account.authReady === false) sessionStorage.removeItem(AUTH_RETURN_KEY); } catch {}
  let touched = false;
  if (sessionHasR18(state.session) && !isActiveVenueSession(state.session)) { state.session = null; touched = true; if (state.screen === "play") state.screen = "participants"; }
  if (sessionHasR18(state.resume) && !isActiveVenueSession(state.resume)) { state.resume = null; touched = true; }
  if (sessionHasR18(state.pendingCustomResume)) { state.pendingCustomResume = null; touched = true; }
  let stored = null; try { stored = loadSession(); } catch { stored = null; }
  if (touched || sessionHasR18(stored)) clearSession();
  state.feedback = null; state.roundFavorite = null; state.shareDialogOpen = false; state.adultConfirmed = false;
  if (!state.account.user) { state.soloHistory = []; state.soloHistoryCursor = null; state.soloHistoryHasMore = false; state.soloHistoryLoading = false; state.soloHistoryError = ""; state.soloHistoryEditing = null; state.soloHistoryOpen = false; state.soloMemoOpen = false; }
}
// Runs at the top of every render: while the account is not age-confirmed, nothing R18 may stay selected or visible.
function enforceAgeGate() {
  if (state.venue) return;
  if (ageConfirmed()) {
    if (!state.account.r18DisplayEnabled && state.filter === "adult") state.filter = "all";
    if (!state.account.r18DisplayEnabled && state.themeExplorerShelf === "adult") state.themeExplorerShelf = "all";
    if (!state.account.r18DisplayEnabled && !state.venue) {
      const catalog = state.themeMode === "solo" || state.session?.mode === "solo" ? soloDecks : decks;
      state.selectedDeckIds = state.selectedDeckIds.filter((id) => { const deck = catalog.find((item) => item.id === id); return deck && canSeeDeck(deck); });
      if (!state.selectedDeckIds.length && state.themeMode !== "mixed") state.selectedDeckIds = [catalog.find((deck) => canSeeDeck(deck))?.id || catalog[0]?.id];
      if (!catalog.some((deck) => deck.id === state.selectedDeckId && canSeeDeck(deck))) state.selectedDeckId = state.selectedDeckIds[0];
      if (state.account.customDraftR18 === true) { state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = ""; }
      state.account.aiQuestions = Array.isArray(state.account.aiQuestions) ? state.account.aiQuestions.filter((question) => question.r18 !== true) : [];
      if (sessionHasR18(state.session) && !isActiveVenueSession(state.session)) { if (!state.session.sharedGuest) state.resume = state.session; state.session = null; if (state.screen === "play") state.screen = "participants"; }
      const pendingAdult = state.account.pendingSet?.set?.hasR18 === true || state.account.pendingSet?.set?.r18 === true || state.account.pendingSet?.set?.theme_r18 === true || state.account.pendingSet?.set?.effectiveR18 === true || (Array.isArray(state.account.pendingSet?.set?.card_ids) && state.account.pendingSet.set.card_ids.some((id) => canonicalCard(id, state.account.customCards)?.r18 === true));
      if (pendingAdult && !r18DisplayVisible()) state.account.pendingSet = null;
    }
    return;
  }
  if (state.filter === "adult") state.filter = "all";
  if (state.themeExplorerShelf === "adult") state.themeExplorerShelf = "all";
  const catalog = state.themeMode === "solo" || state.session?.mode === "solo" ? soloDecks : decks;
  const fallback = catalog.find((deck) => canUseDeck(deck) && canSeeDeck(deck)) ?? catalog.find((deck) => canSeeDeck(deck)) ?? catalog[0];
  const visibleIds = state.selectedDeckIds.filter((id) => { const deck = catalog.find((item) => item.id === id); return deck && canSeeDeck(deck); });
  state.selectedDeckIds = visibleIds.length || state.themeMode === "mixed" ? visibleIds : [fallback.id];
  if (!catalog.some((deck) => deck.id === state.selectedDeckId && canSeeDeck(deck))) state.selectedDeckId = state.selectedDeckIds[0];
  if (state.selectedMySetId) { const set = playableSavedSets(state.account.sets, state.account.customCards).find((item) => item.id === state.selectedMySetId); if (!set || set.hasR18) state.selectedMySetId = null; }
  state.adultConfirmed = false;
  state.account.revealAdult = false; state.account.r18DisplayEnabled = false; state.account.aiR18 = false; state.account.customDraftR18 = false;
  if (state.account.pendingSet) state.account.pendingSet = null;
  if (state.account.authReady && state.session && sessionHasR18(state.session) && !isActiveVenueSession(state.session)) {
    state.session = null; state.feedback = null; state.roundFavorite = null; state.shareDialogOpen = false;
    if (state.screen === "play") state.screen = "participants";
  }
}
function saveAdultIntent() {
  try {
    if (!state.account.adultIntent) { sessionStorage.removeItem(ADULT_INTENT_KEY); return; }
    const createdAt = Date.now();
    sessionStorage.setItem(ADULT_INTENT_KEY, JSON.stringify({ createdAt, expiresAt: createdAt + 30 * 60 * 1000 }));
  } catch {}
}
// The login checkbox is only a bridge across the OTP/OAuth round trip; the server stays the source of truth.
// Resolves to true when saving the confirmation failed.
async function applyAdultIntent() {
  let intent = null;
  try { intent = JSON.parse(sessionStorage.getItem(ADULT_INTENT_KEY) || "null"); } catch { intent = null; }
  if (!intent) return false;
  const now = Date.now();
  const valid = Number.isFinite(intent.createdAt) && Number.isFinite(intent.expiresAt) && intent.expiresAt >= now && intent.createdAt <= now && intent.expiresAt - intent.createdAt <= 30 * 60 * 1000;
  if (!state.account.user && valid) return false;
  try { sessionStorage.removeItem(ADULT_INTENT_KEY); } catch {}
  state.account.adultIntent = false;
  if (!valid || !state.account.user || state.account.ageConfirmedAt) return false;
  const generation = state.account.generation;
  try {
    const result = await accountApi.confirmAdult("login_screen");
    if (generation !== state.account.generation) return false;
    if (typeof result?.adultConfirmedAt !== "string" || !result.adultConfirmedAt) throw new Error("age_confirmation_failed");
    state.account.ageConfirmedAt = result.adultConfirmedAt; state.account.adultConfirmationAvailable = true;
    return false;
  } catch { return generation === state.account.generation; }
}
async function refreshSharedAfterAccountChange() {
  if (state.venue || !state.shared?.token) return;
  const token = state.shared.token;
  try {
    const result = await accountApi.sharedSet(token);
    if (state.venue || state.shared?.token !== token) return;
    state.shared = { token, ...(result.share || result) };
    render();
  } catch { /* keep the current (blocked) view */ }
}
// Non-venue shared sets: R18 content is shown only to age-confirmed accounts.
function sharedBlocked() {
  if (state.venue || !state.shared) return false;
  return state.shared.ageConfirmationRequired === true || (state.shared.adultOnly === true && !ageConfirmed());
}
function sharedSubmitDisabled() {
  if (state.sharedLoading || state.busy) return true;
  if (state.venue) { const set = selectedVenueSet(); return set?.adultOnly === true && !(state.venue.ageTapped === true && state.venue.displayR18 === true && state.adultConfirmed === true); }
  if (sharedBlocked()) return true;
  return state.shared?.adultOnly === true && (!state.adultConfirmed || !r18DisplayVisible());
}
function sessionNeedsRegistration(session) {
  if (isActiveVenueSession(session)) return false;
  return sessionNeedsThemeAccess(session, state.account);
}
function isActiveVenueSession(session = state.session) {
  return isActiveVenueSessionFor(session, state.venue);
}
function selectedVenueSet() {
  return state.venue?.sets?.find((set) => set.id === state.selectedVenueSetId) || state.venue?.sets?.[0] || null;
}
function syncSelectedVenueSet() {
  const set = selectedVenueSet();
  if (!set || !state.shared) return set;
  state.selectedVenueSetId = set.id;
  state.shared.cardCount = set.cardCount;
  state.shared.adultOnly = set.adultOnly === true;
  state.adultConfirmed = state.shared.adultOnly ? state.adultConfirmed : false;
  return set;
}
function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
}
function accountParticipantName(value) {
  if (typeof value !== "string") return "";
  const name = value.trim();
  return name && !/[\u0000-\u001f\u007f]/u.test(name) && Array.from(name).length <= MAX_NAME_LENGTH ? name : "";
}
function syncAccountParticipantName() {
  if (state.screen !== "participants") return;
  const next = accountParticipantName(state.account.user?.displayName);
  if (state.participantNameOrigin === "account") {
    if (state.participants[0] === state.participantNameAutoValue || !state.participants[0]) state.participants[0] = next;
    if (next) state.participantNameAutoValue = next; else state.participantNameOrigin = null;
    return;
  }
  if (!state.participantNameUserEdited && !state.participants[0] && next) { state.participants[0] = next; state.participantNameOrigin = "account";
    state.participantNameAutoValue = next;
  }
}
function clearAccountParticipantName() {
  if (state.participantNameOrigin === "account" && state.participants[0] === state.participantNameAutoValue) state.participants[0] = "";
  state.participantNameOrigin = null;
  state.participantNameAutoValue = "";
}
function participantAvatar(name) { const first = Array.from(name.trim())[0]; if (first) return esc(first); return `<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="21" fill="var(--participant-bg)"/><circle cx="16" cy="19" r="2" fill="var(--participant-fg)"/><circle cx="28" cy="19" r="2" fill="var(--participant-fg)"/><path d="M15 27c2.2 3.4 11.8 3.4 14 0" fill="none" stroke="var(--participant-fg)" stroke-width="2" stroke-linecap="round"/></svg>`; }
function isPrivateCustomSession(session) { return Boolean(session?.customSet === true && session?.ownerUserId); }
function loadResumeForCurrentUser() {
  const candidate = loadSession();
  if (!isPrivateCustomSession(candidate)) return candidate;
  const needsCustomCards = Array.isArray(candidate.customQuestions) && candidate.customQuestions.length > 0;
  if (state.account.user?.id && (!needsCustomCards || state.account.customCardsAvailable) && candidate.ownerUserId === state.account.user.id) return candidate;
  clearSession(); return null;
}

function accountSurface(rootNode) {
  const overlay = rootNode?.querySelector?.("[data-account-overlay]");
  if (!overlay) return null;
  const dialog = overlay.querySelector(".account-dialog");
  const libraryMain = overlay.querySelector(".creator-library-main");
  const kind = dialog?.classList.contains("account-dialog-library") ? "library" : dialog?.classList.contains("account-dialog-settings") ? "settings" : dialog?.classList.contains("account-dialog-delete") ? "delete" : dialog?.classList.contains("account-dialog-menu") ? "menu" : "login";
  return `${kind}:${Boolean(dialog?.querySelector(".library-editor"))}`;
}
function accountScrollSnapshot() {
  const overlay = root.querySelector("[data-account-overlay]");
  if (!overlay) return null;
  const dialog = overlay.querySelector(".account-dialog");
  const libraryMain = overlay.querySelector(".creator-library-main");
  const grid = overlay.querySelector(".library-card-grid");
  const favorites = overlay.querySelector(".library-favorites");
  return { surface: accountSurface(root), dialogTop: dialog?.scrollTop || 0, dialogLeft: dialog?.scrollLeft || 0, libraryMainTop: libraryMain?.scrollTop || 0, libraryMainLeft: libraryMain?.scrollLeft || 0, gridTop: grid?.scrollTop || 0, gridLeft: grid?.scrollLeft || 0, favoritesTop: favorites?.scrollTop || 0, favoritesLeft: favorites?.scrollLeft || 0,
  };
}
function restoreAccountScroll(snapshot) {
  if (!snapshot || snapshot.surface !== accountSurface(root)) return;
  const overlay = root.querySelector("[data-account-overlay]");
  const dialog = overlay?.querySelector(".account-dialog");
  const libraryMain = overlay?.querySelector(".creator-library-main");
  const grid = overlay?.querySelector(".library-card-grid");
  const favorites = overlay?.querySelector(".library-favorites");
  if (dialog) { dialog.scrollTop = snapshot.dialogTop; dialog.scrollLeft = snapshot.dialogLeft; }
  if (libraryMain) { libraryMain.scrollTop = snapshot.libraryMainTop || 0; libraryMain.scrollLeft = snapshot.libraryMainLeft || 0; }
  if (grid) { grid.scrollTop = snapshot.gridTop; grid.scrollLeft = snapshot.gridLeft; }
  if (favorites) { favorites.scrollTop = snapshot.favoritesTop; favorites.scrollLeft = snapshot.favoritesLeft; }
}
function render() {
  if (state.screen === "decks") loadRecommendationLabels(() => {
    if (state.screen !== "decks") return;
    root.querySelectorAll('[data-theme-recommendation-label]').forEach((node) => {
      const kind = recommendationLabel(node.dataset.themeRecommendationLabel);
      node.textContent = kind === 'yesterday_top' ? '昨日の人気No.1' : kind === 'rising' ? '人気上昇中！' : '';
      node.title = kind === 'yesterday_top' ? '昨日のテーマ開始数で1位' : kind === 'rising' ? '昨日のテーマ開始数が一昨日より増加' : '';
    });
  });
  const explorerScrollSnapshot = state.screen === "decks" ? [...root.querySelectorAll('[data-theme-rail]')].map((rail) => [rail.id, rail.scrollLeft]) : [];
  const explorerWindowScroll = state.screen === "decks" ? { x: window.scrollX, y: window.scrollY } : null;
  const explorerFocus = document.activeElement?.closest?.('[data-theme-card]')?.dataset.themeKey || null;
  enforceAgeGate();
  if (state.session?.mode === "solo") state.themeMode = "solo";
  if (state.screen === "play" && state.session?.customSet && state.session.setId) state.selectedMySetId = state.session.setId;
  if (state.account.authReady && !state.account.user && state.themeMode !== "solo" && state.account.guestNormalizedGeneration !== state.account.generation) {
    const preserveMixed = state.themeMode === "mixed";
    const guestDecks = state.selectedDeckIds.filter((id) => GUEST_THEME_IDS.has(id));
    state.selectedDeckIds = guestDecks.length ? guestDecks : ["date"];
    state.selectedDeckId = GUEST_THEME_IDS.has(state.selectedDeckId) ? state.selectedDeckId : state.selectedDeckIds[0];
    state.themeMode = preserveMixed ? "mixed" : "single";
    state.adultConfirmed = false;
    state.account.guestNormalizedGeneration = state.account.generation;
  }
  if (state.session && state.account.authReady && sessionNeedsRegistration(state.session)) {
    state.resume = state.session.sharedGuest ? null : state.session;
    state.session = null;
    state.screen = "participants";
    const guestDecks = (state.resume?.deckIds || []).filter((id) => GUEST_THEME_IDS.has(id));
    state.selectedDeckIds = guestDecks.length ? guestDecks : ["date"];
    state.selectedDeckId = state.selectedDeckIds[0];
    state.themeMode = state.selectedDeckIds.length > 1 ? "mixed" : "single";
    state.adultConfirmed = false;
    state.error = "このテーマは無料登録後に続けられます。ログイン / 新規登録してください。";
    state.account.open = state.account.enabled;
    state.account.status = state.error;
  }
  const accountScroll = accountScrollSnapshot();
  root.innerHTML = state.shared ? sharedView() : state.screen === "participants" ? participantsView() : state.screen === "decks" ? decksView() : playView();
  const restoreExplorerRails = () => { for (const [id, left] of explorerScrollSnapshot) { const rail = root.querySelector(`[data-theme-rail]#${CSS.escape(id)}`); if (rail) rail.scrollLeft = left; } };
  restoreExplorerRails();
  restoreAccountScroll(accountScroll);
  root.dataset.screen = state.screen;
  document.body.classList.toggle("account-open", state.account.open);
  document.body.classList.toggle("share-open", state.shareDialogOpen);
  document.body.classList.toggle("solo-play", state.session?.mode === "solo" && state.screen === "play");
  trackPage(state.screen);
  root.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", handleAction));
  root.querySelectorAll('[data-action="studio-edit-set"]').forEach((button) => button.addEventListener("click", () => {
    const row = state.account.sets.find((item) => item.id === button.dataset.setId); if (row) setStudioMetadata(row);
  }, { capture: true }));
  root.querySelectorAll('[data-action="studio-edit-draft"]').forEach((button) => button.addEventListener("click", () => {
    const row = state.account.drafts.find((item) => item.id === button.dataset.draftId); if (row) setStudioMetadata(row);
  }, { capture: true }));
  root.querySelectorAll('form[data-form="participants"],form[data-form="shared-participants"]').forEach((form) =>
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      form.dataset.form === "shared-participants" ? startSharedSet() : submitParticipants();
    }),
  );
  root.querySelectorAll("[data-shared-adult]").forEach((input) =>
    input.addEventListener("change", (event) => {
      state.adultConfirmed = event.currentTarget.checked;
      const submit = event.currentTarget.form?.querySelector("button[type=submit]");
      if (submit) submit.disabled = sharedSubmitDisabled();
    }),
  );
  root.querySelector("[data-venue-set]")?.addEventListener("change", (event) => { state.selectedVenueSetId = event.currentTarget.value; state.adultConfirmed = false; state.error = ""; syncSelectedVenueSet(); render(); });
  root.querySelector("[data-venue-count]")?.addEventListener("change", (event) => { const count = Math.max(2, Math.min(MAX_PARTICIPANTS, Number(event.currentTarget.value) || 2)); while (state.participants.length < count) state.participants.push(""); state.participants.length = count; state.error = ""; render(); });
  root.querySelectorAll('input[name="participant"]').forEach((input) => {
    input.addEventListener("input", (event) => { const index = Number(event.target.dataset.index); if (index === 0) { state.participantNameUserEdited = true; if (state.participantNameOrigin === "account" && event.target.value !== state.participantNameAutoValue) {
          state.participantNameOrigin = null;
          state.participantNameAutoValue = "";
        }
      }
      state.participants[index] = event.target.value;
      if (event.currentTarget.form?.dataset.form === "participants") {
        const submit = event.currentTarget.form.querySelector("button[type=submit]");
        const validationError = homeParticipantValidationError(state.participants);
        if (submit) submit.disabled = Boolean(validationError);
        const hadNameError = state.error === "呼び名を入力してください。" || state.error === "呼び名に使用できない文字が含まれています。" || state.error.startsWith("呼び名は");
        if (!validationError && hadNameError) state.error = "";
        const error = event.currentTarget.form.querySelector(".form-error");
        if (error && !validationError && !state.error) error.textContent = "";
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || event.nativeEvent?.isComposing) return;
      event.preventDefault();
      const fields = [...root.querySelectorAll('input[name="participant"]')];
      const index = fields.indexOf(event.currentTarget);
      if (fields[index + 1]) { fields[index + 1].focus({ preventScroll: false }); fields[index + 1].scrollIntoView({ block: "nearest" }); }
      else event.currentTarget.form?.requestSubmit();
    });
  });
  root.querySelector("[data-feedback-text]")?.addEventListener("input", (event) => { const current = feedbackState(state.session); if (current) { current.text = event.target.value; const button = root.querySelector('[data-action="feedback-submit"]'); if (button) button.disabled = state.feedbackBusy || (!current.rating && !current.text.trim()); } });
  root.querySelector(".solo-memo")?.addEventListener("toggle", (event) => { if (!event.currentTarget.isConnected) return; state.soloMemoOpen = event.currentTarget.open; const card = state.session && currentCard(state.session); state.soloMemoKey = card ? `${state.session.sessionId}:${card.id}` : ""; });
  root.querySelector("[data-solo-note]")?.addEventListener("input", (event) => { const card = currentCard(state.session); if (card) { const key = `${state.session.sessionId}:${card.id}`; state.soloDraftRevision += 1; state.soloNoteDrafts[key] = event.target.value; state.soloNoteStatuses[key] = ""; state.soloNoteErrors[key] = ""; event.currentTarget.closest('.solo-memo')?.querySelectorAll('.account-status,.form-error').forEach((node) => node.remove()); } });
  root.querySelector("[data-solo-summary]")?.addEventListener("input", (event) => { if (state.session) { state.soloDraftRevision += 1; const key = `${state.session.sessionId}:${Math.floor((state.session.roundStart ?? state.session.cursor) / ROUND_SIZE) + 1}`; state.soloSummaryDrafts[key] = event.target.value; state.soloSummaryStatuses[key] = ""; state.soloSummaryErrors[key] = ""; event.currentTarget.closest('.solo-memo')?.querySelectorAll('.account-status,.form-error').forEach((node) => node.remove()); } });
  root.querySelector("[data-history-edit]")?.addEventListener("input", (event) => { if (state.soloHistoryEditing) state.soloHistoryEditing.note = event.target.value; });
  root.querySelector("[data-round-feedback]")?.addEventListener("toggle", (event) => { state.roundFeedbackExpanded = event.currentTarget.open; });
  root.querySelectorAll("[data-adult]").forEach((input) =>
    input.addEventListener("change", (event) => {
      state.adultConfirmed = event.target.checked;
      updateAdultButton();
    }),
  );
  root.querySelector("[data-challenges]")?.addEventListener("change", (event) => {
    state.includeChallenges = event.target.checked;
  });
  root.querySelectorAll("[data-deck-select]").forEach((input) =>
    input.addEventListener("change", (event) => {
      const id = event.target.value;
      if (state.themeMode === "mixed") {
      if (event.target.checked && !state.selectedDeckIds.includes(id)) {
        if (state.selectedDeckIds.length >= 3) { state.error = "ミックスは3テーマまでです"; render(); return; }
        state.selectedDeckIds = [...state.selectedDeckIds, id];
      } else if (!event.target.checked) state.selectedDeckIds = state.selectedDeckIds.filter((item) => item !== id);
      state.selectedDeckId = state.selectedDeckIds[0] || id;
    } else { state.selectedDeckId = id; state.selectedDeckIds = [id]; state.selectedMySetId = null; }
    state.adultConfirmed = false; state.error = "";
      state.focusSelector = `[data-deck-select][value="${id}"]`;
      render();
    }),
  );
  root.querySelectorAll("[data-solo-deck]").forEach((input) => input.addEventListener("change", (event) => { state.selectedDeckId = event.currentTarget.value; state.selectedMySetId = null; state.error = ""; render(); }));
  root.querySelectorAll("[data-solo-set]").forEach((input) => input.addEventListener("change", (event) => { state.selectedMySetId = event.currentTarget.value.replace(/^set:/, ""); state.selectedDeckId = ""; state.error = ""; render(); }));
  const applyThemeQuery = (event) => { if (event.type === "input" && event.isComposing) return; state.themeExplorerQuery = event.currentTarget.value; const end = event.currentTarget.selectionStart ?? state.themeExplorerQuery.length; render(); const next = root.querySelector("[data-theme-explorer-search]"); next?.focus({ preventScroll: true }); next?.setSelectionRange(end, end); };
  root.querySelector("[data-theme-explorer-search]")?.addEventListener("input", applyThemeQuery);
  root.querySelector("[data-theme-explorer-search]")?.addEventListener("compositionend", applyThemeQuery);
  root.querySelectorAll("[data-theme-category]").forEach((button) => button.addEventListener("click", () => { state.themeExplorerShelf = button.dataset.themeCategory || "all"; state.focusSelector = `[data-theme-category="${state.themeExplorerShelf}"]`; render(); }));
  root.querySelector("[data-theme-reset]")?.addEventListener("click", () => { state.themeExplorerQuery = ""; state.themeExplorerShelf = "all"; state.themeExplorerTagFilter = "all"; state.focusSelector = "[data-theme-explorer-search]"; render(); });
  root.querySelectorAll('[data-action="theme-view"]').forEach((button) => button.addEventListener("click", () => { state.themeExplorerView = button.dataset.view === "list" ? "list" : "cards"; state.focusSelector = `[data-action="theme-view"][data-view="${state.themeExplorerView}"]`; try { localStorage.setItem("mingle.theme-explorer.view.v1", state.themeExplorerView); } catch {} render(); }));
  root.querySelector("[data-theme-tag-filter]")?.addEventListener("change", (event) => { state.themeExplorerTagFilter = event.currentTarget.value === "bookmarked" || event.currentTarget.value === "experienced" ? event.currentTarget.value : "all"; state.focusSelector = "[data-theme-tag-filter]"; render(); });
  root.querySelectorAll('[data-action="theme-shelf-scroll"]').forEach((button) => button.addEventListener("click", () => { const shelf = root.querySelector(`#${CSS.escape(button.dataset.target || "")}`); if (shelf) shelf.scrollBy({ left: Number(button.dataset.direction || 1) * Math.max(260, shelf.clientWidth * .72), behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }));
  root.querySelector("[data-mode-mixed]")?.addEventListener("change", (event) => {
    state.themeMode = event.target.checked ? "mixed" : "single";
    state.adultConfirmed = false;
    if (state.themeMode === "mixed") {
      const regular = new Set(decks.filter((deck) => !deck.adultOnly && participantRuleVisibleForParticipants(participantRuleForDeck(deck))).map((deck) => deck.id));
      state.selectedDeckIds = state.selectedDeckIds.filter((id) => regular.has(id));
      if (!state.selectedDeckIds.length && regular.has(state.selectedDeckId)) state.selectedDeckIds = [state.selectedDeckId];
      if (state.filter === "adult") state.filter = "all";
    } else {
      const candidates = decks.filter((deck) => participantRuleVisibleForParticipants(participantRuleForDeck(deck)) && canSeeDeck(deck) && canUseDeck(deck));
      state.selectedDeckId = candidates.find((deck) => state.selectedDeckIds.includes(deck.id))?.id || candidates[0]?.id || state.selectedDeckId;
      state.selectedDeckIds = state.selectedDeckId ? [state.selectedDeckId] : [];
    }
    state.selectedMySetId = null; state.focusSelector = "[data-mode-mixed]"; state.error = ""; render();
  });
  root.querySelectorAll("[data-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      state.filter = state.themeMode === "mixed" && button.dataset.filter === "adult" ? "all" : button.dataset.filter;
      state.focusSelector = `[data-filter="${state.filter}"]`;
      render();
    }),
  );
  root.querySelectorAll("[data-remove-deck]").forEach((button) =>
    button.addEventListener("click", () => { state.selectedDeckIds = state.selectedDeckIds.filter((id) => id !== button.dataset.removeDeck); state.selectedDeckId = state.selectedDeckIds[0] || state.selectedDeckId; state.error = "";
      render();
    }),
  );
  root.querySelector('[data-action="resume"]')?.addEventListener("click", () => resumeSaved());
  root.querySelector('[data-action="discard-resume"]')?.addEventListener("click", () => { clearSession(); state.resume = null; render(); });
  root.querySelector("[data-account-email]")?.addEventListener("input", (event) => { state.account.email = event.target.value; });
  root.querySelector("[data-profile-name]")?.addEventListener("input", (event) => { state.account.profileDraft = event.target.value; const button = root.querySelector('form[data-form="profile"] button[type="submit"]'); if (button) button.disabled = state.account.busy || !validDisplayName(state.account.profileDraft); });
  root.querySelector("[data-avatar-file]")?.addEventListener("change", prepareAvatar);
  root.querySelector("[data-share-facebook]")?.addEventListener("click", copyFacebookShareText);
  root.querySelector("[data-share-fallback]")?.addEventListener("focus", (event) => event.currentTarget.select());
  root.querySelectorAll("[data-action=\"audio-toggle\"]").forEach((button) => {
    const stop = (event) => event.stopPropagation();
    button.addEventListener("click", stop);
    button.addEventListener("keydown", stop);
  });
  root.querySelectorAll("[data-avatar-image]").forEach((image) => image.addEventListener("error", () => { image.replaceWith(document.createRange().createContextualFragment(accountAvatar(null))); }, { once: true }));
  root.querySelector("[data-custom-text]")?.addEventListener("input", (event) => { state.account.customDraft = event.target.value; const count = root.querySelector("[data-custom-count]");
    if (count) count.textContent = `文字数 ${Array.from(event.target.value.trim()).length} / 300。改行や制御文字は使えません。`;
  });
  root.querySelector("[data-custom-r18]")?.addEventListener("change", (event) => { state.account.customDraftR18 = event.currentTarget.checked; if (!event.currentTarget.checked) { const text = root.querySelector("[data-custom-text]"); if (text) text.value = state.account.customDraft; } });
  root.querySelector("[data-account-otp]")?.addEventListener("input", (event) => { state.account.otp = event.target.value; });
  root.querySelector("[data-adult-intent]")?.addEventListener("change", (event) => { state.account.adultIntent = event.currentTarget.checked; });
  root.querySelector("[data-age-confirm]")?.addEventListener("change", (event) => { state.account.ageConfirmChecked = event.currentTarget.checked; const button = root.querySelector('[data-action="age-confirm"]'); if (button) button.disabled = state.account.ageBusy || !state.account.ageConfirmChecked; });
  root.querySelectorAll("[data-r18-display]").forEach((input) => input.addEventListener("change", (event) => setR18DisplayVisible(event.currentTarget.checked === true)));
  root.querySelector("[data-venue-age]")?.addEventListener("change", (event) => { if (state.venue) { state.venue.ageTapped = event.currentTarget.checked; if (!state.venue.ageTapped) state.venue.displayR18 = false; } render(); });
  root.querySelector("[data-venue-r18]")?.addEventListener("change", (event) => { if (state.venue) state.venue.displayR18 = event.currentTarget.checked === true; render(); });
  root.querySelector("[data-venue-play-r18]")?.addEventListener("change", (event) => { if (state.venue) state.venue.displayR18 = event.currentTarget.checked === true; render(); });
  root.querySelector('form[data-form="account"]')?.addEventListener("submit", (event) => { event.preventDefault(); loginWithOtp(); });
  root.querySelector('form[data-form="profile"]')?.addEventListener("submit", (event) => { event.preventDefault(); saveProfile(); });
  root.querySelector('form[data-form="custom-card"]')?.addEventListener("submit", (event) => { event.preventDefault(); saveCustomCard(); });
  const shareOverlay = root.querySelector("[data-share-overlay]");
  shareOverlay?.addEventListener("click", (event) => {
    if (event.target !== event.currentTarget) return;
    state.shareDialogOpen = false;
    state.focusAction = "social-share";
    render();
  });
  shareOverlay?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      state.shareDialogOpen = false;
      state.focusAction = "social-share";
      render();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...shareOverlay.querySelectorAll("button:not([disabled]), textarea, summary, a[href]")].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  const accountOverlay = root.querySelector("[data-account-overlay]");
  accountOverlay?.addEventListener("click", (event) => { if (event.target === event.currentTarget && !state.account.busy) { state.account.profileRevision += 1;
      state.account.avatarDraft = "";
      state.account.avatarError = "";
      if (state.account.venueOnboarding) clearVenueOnboardingIntent();
      clearAccountShare({ close: true });
      state.continuePending = null;
      state.account.open = false;
      state.account.libraryOpen = false;
      state.focusAction = "account";
      render();
      if (state.account.enabled && !state.account.authReady) loadAccount();
    }
  });
  accountOverlay?.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.account.open && !state.account.busy) { event.preventDefault(); state.account.profileRevision += 1;
      state.account.avatarDraft = "";
      state.account.avatarError = "";
      if (state.account.venueOnboarding) clearVenueOnboardingIntent();
      clearAccountShare({ close: true });
      state.continuePending = null;
      state.account.open = false;
      state.account.libraryOpen = false;
      state.focusAction = "account";
      render();
      if (state.account.enabled && !state.account.authReady) loadAccount();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...accountOverlay.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]")].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  root.querySelectorAll("[data-select-card]").forEach((input) =>
    input.addEventListener("change", (event) => { const id = event.currentTarget.dataset.cardId; if (event.currentTarget.checked) { if (state.account.studioReplaceIndex !== null && state.account.studioReplaceIndex !== undefined) { const replaceIndex = state.account.studioReplaceIndex; const duplicate = state.account.studioItems.some((item, index) => index !== replaceIndex && item.kind === "saved" && item.cardId === id); if (duplicate) { event.currentTarget.checked = false; state.account.error = "同じ質問はセットに重複して追加できません。"; } else { const old = state.account.studioItems[replaceIndex]; if (old?.kind === "saved") state.account.selectedCards.delete(old.cardId); state.account.studioItems[replaceIndex] = { kind: "saved", cardId: id }; state.account.selectedCards.add(id); state.account.studioReplaceIndex = null; state.account.studioMode = "editor"; } } else if (state.account.studioItems.length >= 40) { event.currentTarget.checked = false; state.account.error = "質問は40枚まで追加できます。"; } else if (state.account.studioItems.some((item) => item.kind === "saved" && item.cardId === id)) { event.currentTarget.checked = false; state.account.error = "同じ質問はセットに重複して追加できません。"; } else { state.account.selectedCards.add(id); state.account.studioItems.push({ kind: "saved", cardId: id }); } } else { state.account.selectedCards.delete(id); state.account.studioItems = state.account.studioItems.filter((item) => !(item.kind === "saved" && item.cardId === id)); } state.focusSelector = `[data-select-card][data-card-id=\"${id}\"]`; render(); }),
  );
  root.querySelectorAll("[data-round-favorite]").forEach((input) =>
    input.addEventListener("change", (event) => {
    const context = state.roundFavorite;
    if (!context || context.saving) return;
    const id = event.currentTarget.dataset.cardId;
    if (event.currentTarget.checked) context.selected.add(id); else context.selected.delete(id);
    state.focusSelector = `[data-round-favorite][data-card-id="${id}"]`;
    render();
  }),
  );
  root.querySelector("[data-delete-confirm]")?.addEventListener("change", (event) => { state.account.deleteConfirmed = event.currentTarget.checked; const button = root.querySelector('[data-action="account-delete-confirm"]'); if (button) button.disabled = state.account.busy || !state.account.deletionAvailable || !state.account.deleteConfirmed; });
  const setNameInput = root.querySelector("[data-set-name]");
  const updateSetValidity = () => {
    const form = setNameInput?.closest("form"); const button = form?.querySelector('button[type=\"submit\"]') || root.querySelector('.studio-save-footer button[type=\"submit\"]'); if (!button || !setNameInput) return; const count = state.account.studioItems.length; button.disabled = state.account.busy || !setNameInput.value.trim() || Array.from(setNameInput.value.trim()).length > 80 || count > 40 || state.account.draftsAvailable === false; }; setNameInput?.addEventListener("input", (event) => { state.account.setName = event.currentTarget.value; if (!event.isComposing) updateSetValidity(); }); setNameInput?.addEventListener("compositionend", updateSetValidity);
  root.querySelector('[data-studio-audience]')?.addEventListener('change', (event) => { state.account.studioAudience = event.currentTarget.value; });
  root.querySelector('[data-studio-order]')?.addEventListener('change', (event) => { state.account.studioQuestionOrder = event.currentTarget.value; });
  root.querySelector('[data-studio-r18]')?.addEventListener('change', (event) => { if (!root.querySelector('[data-studio-r18]').disabled) state.account.studioR18 = event.currentTarget.checked === true; });
  root.querySelectorAll('[data-action="studio-design"]').forEach((button) => button.addEventListener('click', () => { const id = button.dataset.designId; if (!CREATOR_PRESET_IDS.includes(id)) return; state.account.studioDesign = { version: 1, kind: 'preset', presetId: id }; state.focusSelector = `[data-action="studio-design"][data-design-id="${id}"]`; render(); }));
  root.querySelectorAll('[data-studio-item-r18]').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.currentTarget.dataset.itemIndex); const item = state.account.studioItems[index]; if (item?.kind === 'custom') { item.r18 = event.currentTarget.checked === true; state.account.studioR18 = state.account.studioR18 === true; render(); } }));
  root.querySelectorAll('[data-action="studio-back"]').forEach((button) => button.addEventListener('click', () => { const mode = state.account.studioMode; state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; state.account.busy = false; if (mode === 'picker') state.account.studioMode = 'editor'; else if (mode === 'ai') state.account.studioMode = state.account.studioAiReturnMode === 'editor' ? 'editor' : 'list'; else { state.account.studioMode = 'list'; state.account.studioItems = []; state.account.selectedCards = new Set(); state.account.setName = undefined; state.account.editingDraftId = null; state.account.editingSetId = null; } if (mode !== 'ai' || state.account.studioMode === 'list') { state.account.aiQuestions = []; state.account.aiName = ''; state.account.aiTheme = ''; state.account.aiTone = ''; } render(); }));
  root.querySelector('[data-action="studio-picker"]')?.addEventListener('click', () => { state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; state.account.studioMode = 'picker'; render(); });
  root.querySelectorAll('[data-action="studio-remove-card"]').forEach((button) => button.addEventListener('click', () => { state.account.selectedCards.delete(button.dataset.cardId); state.account.studioItems = state.account.studioItems.filter((item) => item.cardId !== button.dataset.cardId); state.focusAction = 'studio-picker'; render(); }));
  root.querySelectorAll('[data-action="studio-remove-item"]').forEach((button) => button.addEventListener('click', () => { state.account.studioRequestId += 1; const index = Number(button.dataset.itemIndex); const item = state.account.studioItems[index]; if (item?.kind === 'saved') state.account.selectedCards.delete(item.cardId); state.account.studioItems.splice(index, 1); render(); }));
  root.querySelectorAll('[data-studio-item-text], [data-studio-custom-text]').forEach((input) => input.addEventListener('input', (event) => { const index = Number(event.currentTarget.dataset.itemIndex); const item = state.account.studioItems[index]; if (!item || item.kind !== 'custom') return; const value = event.currentTarget.value; item.text = value; const preview = root.querySelector('[data-creator-preview] span'); if (preview && index === 0) preview.textContent = value || 'ここに質問が表示されます'; }));
  root.querySelector('[data-custom-text]')?.addEventListener('input', (event) => { state.account.customDraft = event.currentTarget.value; const preview = root.querySelector('[data-custom-preview] span'); if (preview) preview.textContent = event.currentTarget.value || 'ここに質問が表示されます'; const count = root.querySelector('[data-custom-count]'); if (count) count.textContent = `文字数 ${Array.from(event.currentTarget.value).length} / 300`; });
  root.querySelectorAll('[data-action="studio-replace-item"]').forEach((button) => button.addEventListener('click', () => { const index = Number(button.dataset.itemIndex); if (!Number.isInteger(index) || !state.account.studioItems[index]) return; state.account.studioReplaceIndex = index; state.account.studioMode = 'picker'; state.focusAction = 'studio-back'; render(); }));
  root.querySelectorAll('[data-ai-select]').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.currentTarget.dataset.aiIndex); if (state.account.aiQuestions[index]) state.account.aiQuestions[index].selected = event.currentTarget.checked; }));
  root.querySelectorAll('[data-ai-text]').forEach((input) => input.addEventListener('input', (event) => { const index = Number(event.currentTarget.dataset.aiIndex); if (state.account.aiQuestions[index]) state.account.aiQuestions[index].text = event.currentTarget.value; }));
  root.querySelector('[data-ai-r18]')?.addEventListener('change', (event) => { state.account.aiR18 = event.currentTarget.checked === true; });
  root.querySelector('[data-form="ai"]')?.addEventListener('submit', (event) => { event.preventDefault(); state.account.aiTheme = root.querySelector('[data-ai-theme]')?.value || ''; state.account.aiTone = root.querySelector('[data-ai-tone]')?.value || ''; state.account.aiCount = Number(root.querySelector('[data-ai-count]')?.value || 6); state.account.aiR18 = root.querySelector('[data-ai-r18]')?.checked === true; generateStudioQuestions(); });
  root.querySelector('[data-action="studio-ai-adopt"]')?.addEventListener('click', adoptStudioQuestions);
  root.querySelector('[data-action="studio-ai-discard"]')?.addEventListener('click', () => { state.account.studioRequestId += 1; state.account.busy = false; state.account.aiQuestions = []; state.account.aiName = ''; state.account.aiTheme = ''; state.account.aiTone = ''; state.account.aiR18 = false; state.account.studioMode = state.account.studioAiReturnMode === 'editor' ? 'editor' : 'list'; render(); });
  root.querySelector('form[data-form="studio"]')?.addEventListener('submit', (event) => { event.preventDefault(); state.account.setName = root.querySelector('[data-set-name]')?.value || ''; saveStudioDraft(); });
  root.querySelector('.studio-editor .studio-save-footer button[type="submit"]')?.addEventListener('click', (event) => { event.preventDefault(); state.account.setName = root.querySelector('[data-set-name]')?.value || ''; saveStudioDraft(); });
  root.querySelector(".shared-question-card[data-action='reveal']")?.addEventListener("keydown", (event) => {
    if (event.target.closest("button")) return;
    if (event.key === "Enter" || event.key === ' ') { event.preventDefault(); playFlipSound(); const previous = ensureSession(); state.session = revealCard(previous); persist(previous); render(); }
  });
  updateAdultButton();
  const shareDialog = root.querySelector("[data-share-overlay]");
  const background = root.querySelectorAll(".topbar, .round-break");
  background.forEach((element) => { element.inert = Boolean(state.shareDialogOpen); });
  const pendingFocusSelector = state.focusSelector;
  const focusTarget = pendingFocusSelector ? (root.querySelector(pendingFocusSelector) || (pendingFocusSelector.includes('theme-bookmark') || pendingFocusSelector.includes('theme-experienced') ? root.querySelector('[data-theme-tag-filter]') : null)) : state.focusAction ? root.querySelector(`[data-action="${state.focusAction}"]`) : null;
  const shouldScrollToInput = Boolean(pendingFocusSelector?.includes("participant") || pendingFocusSelector?.includes("data-index"));
  state.focusSelector = null;
  state.focusAction = null;
  if (state.shareDialogOpen && state.shareFallbackText) root.querySelector(".share-dialog-details")?.setAttribute("open", "");
  const overlayFocus = root.querySelector(".account-overlay button:not([disabled]), .account-overlay input:not([disabled]), .account-overlay [href]");
  const shareFocus = shareDialog?.querySelector("button:not([disabled]), textarea, summary, a[href]");
  const focusElement = (state.shareDialogOpen ? (focusTarget || shareFocus) : focusTarget) || overlayFocus || root.querySelector("[data-focus]");
  focusElement?.focus({
    preventScroll: Boolean(focusTarget && !shouldScrollToInput),
  });
  if (state.shareDialogOpen && focusTarget?.matches(".share-dialog [data-share-fallback]")) focusTarget.select();
  if (focusTarget && shouldScrollToInput) focusTarget.scrollIntoView({ block: "nearest" });
  if (!focusTarget && explorerFocus) root.querySelector(`[data-theme-key="${CSS.escape(explorerFocus)}"]`)?.focus({ preventScroll: true });
  if (explorerScrollSnapshot.length && explorerWindowScroll) window.scrollTo({ left: explorerWindowScroll.x, top: explorerWindowScroll.y, behavior: "auto" });
  registerWebMcp();
}
function actionIcon(name) { const paths = { grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>', list: '<path d="M5 6h14M5 12h14M5 18h14"/>', bookmark: '<path d="M6 4h12v16l-6-3-6 3Z"/>', search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5"/>', building: '<path d="M4 20V6l8-3 8 3v14M8 20v-5h8v5M8 8h1M12 8h1M16 8h1M8 11h1M12 11h1M16 11h1"/>', settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/>', play: '<path d="m8 5 11 7-11 7Z"/>', pencil: '<path d="m5 17-1 4 4-1L19 9l-3-3Z"/><path d="m14 7 3 3"/>', check: '<path d="m5 12 4 4L19 6"/>', heart: '<path d="M12 20S4 15.5 4 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.5 12 20 12 20Z"/>', left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', skip: '<path d="m5 5 7 7-7 7Z"/><path d="M19 5v14"/>', share: '<circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>' }; return `<svg class="action-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.grid}</svg>`; }function brandHomeButton() { return `<button type="button" class="brand app-brand-home" data-action="home" aria-label="ホームに戻る" title="ホームに戻る"><img src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards" /></button>`; }
function frame(content, eyebrow = "Mingle.Cards", withHeader = true) { const soloFrame = state.screen === "play" && state.session?.mode === "solo"; const themeFrame = state.screen === "decks"; const playFrame = state.screen === "play"; const homeFrame = state.screen === "participants"; const quietText = soloFrame ? "ひとりで" : state.session?.revealed && currentCard(state.session)?.kind === "challenge" ? "やりたくないお題はパスしてOK" : "話したくない質問はパスしてOK"; const header = homeFrame ? "" : themeFrame ? `<header class="topbar theme-frame-topbar">${brandHomeButton()}${accountButton(state.account)}</header>` : `<header class="topbar${playFrame ? " play-frame-topbar" : ""}">${brandHomeButton()}<span class="quiet">${quietText}</span></header>`; return `${withHeader ? header : ""}<section class="content${playFrame ? " play-frame-content" : ""}${homeFrame ? " home-frame-content" : ""}">${content}</section>`; }function sharedView() {
  const shared = state.shared || {};
  const venueSet = syncSelectedVenueSet();
  const blocked = sharedBlocked();
  const displayAllowed = state.venue ? state.venue.displayR18 === true : (!shared.adultOnly || r18DisplayVisible());
  const consent = !blocked && displayAllowed && (state.venue ? venueSet?.adultOnly === true : shared.adultOnly === true);
  const blockedActions = !state.account.enabled ? "" : isRegisteredUser() ? '<button type="button" class="primary-button" data-action="age-settings-open">アカウント設定を開く</button>' : '<button type="button" class="primary-button" data-action="account" data-auth-return="true">ログイン / 新規登録</button>';
  const blockedPanel = blocked ? `<section class="panel form-panel shared-age-blocked"><p class="guest-theme-note">このセットは、18歳以上であることを確認したアカウントでのみ表示できます。</p>${blockedActions}</section>` : "";
  const venueDisplayToggle = state.venue && venueSet?.adultOnly && state.venue.ageTapped ? `<label class="adult-consent"><input type="checkbox" data-venue-r18 ${state.venue.displayR18 ? "checked" : ""} /> R18を表示する</label>` : "";
  const sharedDisplaySettings = !state.venue && shared.adultOnly && ageConfirmed() && isRegisteredUser() ? '<button type="button" class="text-button shared-r18-settings" data-action="age-settings-open">R18の表示設定</button>' : "";
  const venueAgeTap = state.venue && venueSet?.adultOnly ? `<label class="adult-consent venue-age-confirm"><input type="checkbox" data-venue-age ${state.venue.ageTapped ? "checked" : ""} /> <span><strong>この端末で遊ぶ参加者は全員18歳以上です</strong><br><small>このお店はR18のテーマを提供しています。店舗が参加者の年齢を確認する責任を負います。</small></span></label>${venueDisplayToggle}` : "";
  const consentControl = consent ? `${venueAgeTap}<label class="adult-consent"><input type="checkbox" data-shared-adult ${state.adultConfirmed ? "checked" : ""} /> ${state.venue ? "参加者全員がR18の話題に同意しています" : "参加者全員が18歳以上で、R18の話題に同意します"}</label>` : "";
  const venuePicker = state.venue ? `<label class="venue-picker"><span>店舗のおすすめテーマ</span><select data-venue-set aria-label="店舗のおすすめテーマ">${state.venue.sets.map((set) => `<option value="${esc(set.id)}" ${set.id === (venueSet?.id || '') ? 'selected' : ''}>${esc(set.adultOnly && !displayAllowed ? 'R18を含むテーマ' : set.name)}（${set.cardCount}枚${set.adultOnly ? '・R18' : ''}）</option>`).join('')}</select></label>` : '';
  const participantFields = `<div class="participant-list">${state.participants.map((name, index) => `<label class="name-field"><span class="name-avatar participant-color-${index}">${participantAvatar(name)}</span><input name="participant" data-index="${index}" value="${esc(name)}" maxlength="80" placeholder="${state.venue ? '呼び名（任意）' : '呼び名'}" aria-label="${index + 1}人目の呼び名" /></label>`).join("")}</div>`;
  const participantInput = state.venue ? `<label class="venue-count"><span>参加人数</span><select data-venue-count aria-label="参加人数">${Array.from({ length: MAX_PARTICIPANTS - 1 }, (_, index) => index + 2).map((count) => `<option value="${count}" ${count === state.participants.length ? "selected" : ""}>${count}人</option>`).join("")}</select></label><details class="venue-names"><summary>呼び名をつける（任意）</summary>${participantFields}</details>` : `${participantFields}<div class="inline-actions"><button type="button" class="text-button add-person" data-action="add-person" ${state.participants.length >= MAX_PARTICIPANTS ? "disabled" : ""}>＋ 参加者を追加</button>${state.participants.length > 2 ? '<button type="button" class="text-button muted" data-action="remove-person">最後の人を削除</button>' : ""}</div>`;
  const title = state.venue ? state.venue.venue.name : '共有されたマイセット';
  const welcome = state.venue?.venue.welcomeText ? `<p class="account-hint venue-welcome">${esc(state.venue.venue.welcomeText)}</p>` : "";
  const store = state.venue?.venue.storeUrl ? `<a class="text-button venue-store-link" href="${esc(state.venue.venue.storeUrl)}" target="_blank" rel="noopener noreferrer">店舗の公式サイト</a>` : "";
  const footer = state.venue ? `<div class="venue-footer-links">${store}<button type="button" class="back-link" data-action="home">通常のMingle.Cardsへ</button></div>` : `<button type="button" class="back-link" data-action="home">通常のMingle.Cardsへ</button>`;
  const landingHint = state.venue ? "テーマと人数を選んで、会話をはじめましょう。" : "質問内容は、参加者を入力して始めるまで表示されません。";
  const venueGameButton = (id) => {
    const game = groupGames.find((item) => item.id === id);
    const gate = gameParticipantGate(game, state.participants.length);
    if (!gate.valid) return '';
    return `<button type="button" class="text-button" data-action="game-launch" data-game-id="${esc(id)}">${esc(game.title)}</button>`;
  };
  const venueGames = state.venue ? `<section aria-labelledby="venue-games-heading"><p class="eyebrow" id="venue-games-heading">ゲーム</p><div class="inline-actions">${venueGameButton('match')}${venueGameButton('choice')}${venueGameButton('minority-topic')}${venueGameButton('question-wolf')}${venueGameButton('ochi-kara')}${venueGameButton('one-cut')}${venueGameButton('mission-mingle')}</div></section>` : '';
  return frame(`<div class="shared-landing${state.venue ? ' venue-landing' : ''}"><div class="shared-brand">${state.venue?.venue.logoUrl ? `<img src="${esc(state.venue.venue.logoUrl)}" alt="${esc(title)}" width="160" height="60" />` : '<img src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards" width="160" height="113" />'}</div><p class="eyebrow">${state.venue ? '店舗のおすすめカード' : '共有されたマイセット'}</p><h1 tabindex="-1" data-focus>${esc(state.venue ? (venueSet?.adultOnly && !displayAllowed ? "R18を含むテーマ" : title) : (blocked || (shared.adultOnly && !displayAllowed) ? "共有セット" : (shared.name || "共有セット")))}</h1><p class="shared-meta">${state.venue ? esc(state.venue.table.label) : ''} ${!blocked && Number.isFinite(shared.cardCount) ? `${shared.cardCount}枚` : ""}${consent ? " · R18を含みます" : ""}</p>${welcome}${blocked ? "" : `<p class="account-hint">${landingHint}</p>`}${blockedPanel}${blocked ? "" : `<form class="panel form-panel" data-form="shared-participants">${venuePicker}${participantInput}${sharedDisplaySettings}${venueAgeTap}${consentControl}<p class="form-error" role="alert">${esc(state.error)}</p><button type="submit" class="primary-button" ${sharedSubmitDisabled() ? "disabled" : ""}>${state.busy ? "開始中…" : "このセットで遊ぶ"}</button>${state.venue ? venueGames : ''}</form>`}${footer}${state.account.open ? accountView({ overlayOnly: true }) : ""}</div>`, state.venue ? "店舗カード" : "共有セット", false); }

function participantsView() {
  syncAccountParticipantName();
  const participantCount = Math.max(1, Math.min(MAX_PARTICIPANTS, state.participants.length || 1));
  if (state.participants.length !== participantCount) state.participants = state.participants.length ? state.participants.slice(0, participantCount) : [""];
  const soloActive = participantCount === 1;
  if (soloActive) {
    state.themeMode = "solo";
    state.participantTab = "solo";
  } else if (state.themeMode === "solo") {
    state.themeMode = "single";
    state.participantTab = "group";
  }
  const atLimit = participantCount >= MAX_PARTICIPANTS;
  const resumeCard = state.resume && canAccessSessionContent(state.resume, state.account, { activeVenue: isActiveVenueSession(state.resume), venueDisplay: state.venue?.displayR18 === true }) ? `<aside class="resume-card" aria-label="前回の続き"><strong>前回の続き</strong><span>${esc(state.resume.mixed ? "テーマミックス" : state.resume.customSet ? "マイセット" : decks.find((deck) => deck.id === state.resume.deckId)?.title || "会話カード")} · ${state.resume.cursor}/${state.resume.questions?.length || 40}</span><div><button type="button" class="primary-button" data-action="resume">続きから</button><button type="button" class="text-button muted" data-action="discard-resume">削除</button></div></aside>` : "";
  const modeDescription = `<p class="home-mode-description" aria-live="polite">${soloActive ? "自分をもっとよく知るための質問が出てくるよ" : "会話のきっかけになる質問がでてくるよ"}</p>`;
  const countStepper = `<div class="participant-count-stepper" role="group" aria-label="参加人数"><span class="participant-count-label">参加人数</span><button type="button" class="participant-count-button" data-action="remove-person" aria-label="人数を減らす" ${participantCount <= 1 ? "disabled" : ""}>−</button><output aria-live="polite">${participantCount}人</output><button type="button" class="participant-count-button" data-action="add-person" aria-label="人数を増やす" ${atLimit ? "disabled" : ""}>＋</button></div>`;
  const groupForm = `<form class="panel form-panel" data-form="participants"><div class="participant-list">${state.participants.map((name, index) => `<label class="name-field"><span class="name-avatar participant-color-${index}">${participantAvatar(name)}</span><input name="participant" data-index="${index}" value="${esc(name)}" maxlength="80" placeholder="呼び名" aria-label="${index + 1}人目の呼び名" autocomplete="off" enterkeyhint="${index === state.participants.length - 1 ? "done" : "next"}" /></label>`).join("")}</div>${countStepper}<p class="form-error" role="alert">${esc(state.error)}</p><button type="submit" class="primary-button" ${participantNamesReadyForHome(state.participants) ? "" : "disabled"}>話すテーマを選ぼう！</button></form>`;
  return frame(`<div class="home-screen">${accountView()}<div class="masthead-slot"><img class="masthead-image" src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards。やっぱり人って面白い。" width="1493" height="1054" /><h1 class="visually-hidden" tabindex="-1" data-focus>Mingle.Cards</h1></div>${resumeCard}${modeDescription}${groupForm}<img class="home-illustration" src="/assets/friends-conversation-closeup.png" alt="会話を楽しむ人たちのイラスト" width="1611" height="976" loading="eager" />${renderAd("top")}<footer class="home-footer"><p><span>α版</span><span>開発：株式会社ErudAite</span></p><nav aria-label="ご案内"><a href="/terms.html">利用規約</a><a href="/privacy.html">プライバシーポリシー</a><a href="/personal-information.html">個人情報保護法に基づく公表事項</a><a href="/update-history.html">開発更新履歴</a><a class="venue-footer-link" href="https://partnerplan.mingle.cards">店舗の体験向上のために導入する</a></nav></footer></div>`, "Mingle.Cards", true);
}
function homeParticipantValidationError(names) {
  if (!Array.isArray(names) || names.length < 1 || names.length > MAX_PARTICIPANTS) return "呼び名を確認してください。";
  for (const name of names) {
    if (typeof name !== "string" || !name.trim()) return "呼び名を入力してください。";
    const trimmed = name.trim();
    if (Array.from(trimmed).length > MAX_NAME_LENGTH) return `呼び名は${MAX_NAME_LENGTH}文字以内で入力してください。`;
    if (/[\u0000-\u001f\u007f]/u.test(trimmed)) return "呼び名に使用できない文字が含まれています。";
  }
  return "";
}
function participantNamesReadyForHome(names) {
  return !homeParticipantValidationError(names);
}
function avatarImageSrc(value) {
  return typeof value === "string" && /^(?:data:image\/(?:png|jpe?g|webp);base64,|https?:\/\/)/i.test(value) && value.length <= 360000 ? value : "";
}
function accountAvatar(user = null) {
  const src = avatarImageSrc(user?.avatarUrl);
  if (src) return `<img data-avatar-image src="${esc(src)}" alt="" loading="eager" decoding="async" />`;
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.25"/><path d="M5.5 20c.6-3.7 2.8-5.8 6.5-5.8s5.9 2.1 6.5 5.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
}
function accountDialog(content, className = "") {
  return `<div class="account-overlay" data-account-overlay><div id="account-dialog" class="account-dialog ${className}" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">${content}</div></div>`;
}
function accountButton(a) {
  const label = a.user ? "アカウントメニュー" : "ログインして保存";
  return `<div class="account-bar"><button type="button" class="account-button" data-action="account" aria-label="${label}" aria-expanded="${a.open}" aria-controls="account-dialog" title="${label}"><span class="account-avatar">${accountAvatar(a.user)}</span><span class="visually-hidden">${label}</span></button></div>`;
}
function libraryAccountView(a) {
  return accountDialog(`<header class="creator-library-header"><a class="creator-library-logo" href="/" aria-label="Mingle.Cards ホーム"><img src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards" /></a><div class="creator-library-title"><strong id="account-dialog-title">${a.customEditorOpen ? (a.editingCardId ? "質問を編集" : "質問を作る") : a.studioMode === "editor" ? "テーマを作る" : "マイセット"}</strong></div><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></header><div class="creator-library-shell"><nav class="creator-library-nav" aria-label="作成メニュー"><a href="/marketplace.html">${actionIcon("grid")}マーケットプレイス</a><button type="button" data-action="custom-card-new" class="${a.customEditorOpen ? "is-current" : ""}">${actionIcon("pencil")}質問を作る</button><button type="button" data-action="set-new" class="${!a.customEditorOpen && a.studioMode === "editor" ? "is-current" : ""}">${actionIcon("pencil")}テーマを作る</button><button type="button" class="${!a.customEditorOpen && a.studioMode !== "editor" ? "is-current" : ""}" data-action="account-library-open">${actionIcon("grid")}マイセット</button></nav><div class="creator-library-main">${a.pendingSet ? '<p class="account-status">このセットにはR18カードが含まれます。参加者全員の同意が必要です。</p><button type="button" class="primary-button" data-action="confirm-set-play">同意して遊ぶ</button>' : ""}${renderLibrary({ ...a, replaceItemIndex: a.studioReplaceIndex, hideTitle: true })}</div></div>`, "account-dialog-library");
}
function avatarSettingsView(a) {
  const remove = a.avatarUrl ? `<button type="button" class="text-button muted" data-action="avatar-remove" ${a.avatarBusy ? "disabled" : ""}>画像を削除</button>` : "";
  const save = a.avatarDraft ? `<button type="button" class="primary-button avatar-save-button" data-action="avatar-save" ${a.avatarBusy ? "disabled" : ""}>画像を保存</button><button type="button" class="text-button muted" data-action="avatar-cancel" ${a.avatarBusy ? "disabled" : ""}>取り消す</button>` : "";
  return `<section class="account-avatar-settings" aria-labelledby="avatar-settings-title"><strong id="avatar-settings-title">プロフィール画像</strong><div class="avatar-settings-row"><span class="account-avatar account-avatar-large">${accountAvatar({ avatarUrl: a.avatarDraft || a.avatarUrl })}</span><div class="avatar-settings-actions"><label class="secondary-button avatar-file-label">画像を選ぶ<input type="file" data-avatar-file accept="image/png,image/jpeg,image/webp" ${a.avatarBusy ? "disabled" : ""} /></label>${remove}${save}</div></div><p class="account-hint">PNG・JPEG・WebP、正方形に縮小して保存します。</p>${a.avatarError ? `<p class="form-error" role="alert">${esc(a.avatarError)}</p>` : ""}</section>`;
}
function validDisplayName(value) {
  return typeof value === "string" && !/[\u0000-\u001f\u007f]/u.test(value) && Array.from(value.trim()).length <= 40;
}
function avatarDataUrlFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      reject(new Error("PNG・JPEG・WebP画像を選んでください。"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error("画像は10MB以下にしてください。"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
      image.onload = () => {
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        if (!side) {
          reject(new Error("画像を読み込めませんでした。"));
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = 384;
        canvas.height = 384;
        const context = canvas.getContext("2d");
        context.fillStyle = "#fffaf0";
        context.fillRect(0, 0, 384, 384);
        context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 384, 384);
        const data = canvas.toDataURL("image/jpeg", 0.82);
        const payload = data.slice(data.indexOf(",") + 1);
        const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
        const byteLength = Math.floor(payload.length * 3 / 4) - padding;
        if (byteLength > 256 * 1024) {
          reject(new Error("画像を小さくできませんでした。別の画像をお試しください。"));
          return;
        }
        resolve(data);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function prepareAvatar(event) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file || state.account.avatarBusy) return;
  const generation = state.account.generation;
  const avatarRevision = ++state.account.avatarRevision;
  const revision = state.account.profileRevision;
  state.account.avatarError = "";
  state.account.status = "";
  try {
    const draft = await avatarDataUrlFromFile(file);
    if (generation !== state.account.generation || avatarRevision !== state.account.avatarRevision || revision !== state.account.profileRevision || !state.account.settingsOpen) return;
    state.account.avatarDraft = draft;
  } catch (error) {
    if (generation !== state.account.generation || avatarRevision !== state.account.avatarRevision || revision !== state.account.profileRevision || !state.account.settingsOpen) return;
    state.account.avatarDraft = "";
    state.account.avatarError = error.message || "画像を読み込めませんでした。";
  }
  render();
}
async function saveAvatar() {
  if (state.account.avatarBusy || !state.account.user || !state.account.avatarDraft) return;
  const generation = state.account.generation;
  const avatarRevision = ++state.account.avatarRevision;
  const imageData = state.account.avatarDraft;
  state.account.avatarBusy = true;
  state.account.avatarError = "";
  state.account.status = "";
  render();
  try {
    const result = await accountApi.updateAvatar(imageData);
    if (generation !== state.account.generation) return;
    const avatarUrl = avatarImageSrc(result.avatarUrl);
    state.account.avatarUrl = avatarUrl;
    state.account.avatarDraft = "";
    state.account.user = normalizeAccountUser({ ...state.account.user, avatarUrl }, state.account.user);
    state.account.status = "プロフィール画像を保存しました。";
  } catch {
    if (generation === state.account.generation) state.account.avatarError = "プロフィール画像を保存できませんでした。";
  } finally {
    if (generation === state.account.generation) {
      state.account.avatarBusy = false;
      render();
    }
  }
}
async function removeAvatar() {
  if (state.account.avatarBusy || !state.account.user || !state.account.avatarUrl) return;
  const generation = state.account.generation;
  const avatarRevision = ++state.account.avatarRevision;
  state.account.avatarBusy = true;
  state.account.avatarError = "";
  state.account.status = "";
  render();
  try {
    const result = await accountApi.deleteAvatar();
    if (generation !== state.account.generation) return;
    state.account.avatarUrl = "";
    state.account.avatarDraft = "";
    state.account.user = normalizeAccountUser({ ...state.account.user, avatarUrl: result.avatarUrl || null }, state.account.user);
    state.account.status = "プロフィール画像を削除しました。";
  } catch {
    if (generation === state.account.generation) state.account.avatarError = "プロフィール画像を削除できませんでした。";
  } finally {
    if (generation === state.account.generation) {
      state.account.avatarBusy = false;
      render();
    }
  }
}
async function generateShareQr(url, generation, requestId) {
  if (!url || !state.account.shareOpen) return;
  state.account.qrBusy = true;
  state.account.qrError = "";
  render();
  const current = () => generation === state.account.generation && requestId === state.account.shareRequestId && state.account.shareOpen && state.account.share?.url === url;
  try {
    const qr = await import("./vendor/qr.js");
    const dataUrl = await qr.toDataURL(url, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: "M",
    });
    if (!current()) return;
    state.account.share.qrDataUrl = dataUrl;
  } catch {
    if (current()) state.account.qrError = "QRコードを作成できませんでした。";
  } finally {
    if (generation === state.account.generation && requestId === state.account.shareRequestId) {
      state.account.qrBusy = false;
      if (state.account.shareOpen) render();
    }
  }
}
function shareDialogView(a) {
  const share = a.share || {};
  const soloOnly = share.audience === 'solo';
  const displayName = share.adultOnly === true && !r18DisplayVisible() ? "R18を含む共有セット" : (share.name || "マイセット");
  const url = typeof share.url === "string" ? share.url : "";
  const qr = a.qrBusy ? '<p class="account-hint" role="status">QRコードを作成中…</p>' : share.active === false ? `<p class="account-hint" role="status">${soloOnly ? "この共有は停止中です。" : "この共有は停止中です。リンクを作り直してください。"}</p>` : typeof share.qrDataUrl === "string" && share.qrDataUrl.startsWith("data:image/") ? `<img class="share-qr" src="${esc(share.qrDataUrl)}" alt="共有リンクのQRコード" />` : `<p class="account-hint" role="status">${esc(a.qrError || "QRコードを作成できませんでした。リンクをコピーして共有できます。")}</p>`;
  const controls = soloOnly ? (url && share.active !== false ? `<span class="account-hint">以前に発行した共有リンクを管理できます。新しいリンクは発行できません。</span><button type="button" class="text-button" data-action="share-stop" ${a.shareBusy ? "disabled" : ""}>共有を停止</button>` : '<span class="account-hint">以前に発行した共有リンクを管理できます。新しいリンクは発行できません。</span>') : `<button type="button" class="secondary-button" data-action="share-rotate" ${a.shareBusy ? "disabled" : ""}>${url ? "リンクを作り直す" : "リンクを発行"}</button>${url && share.active !== false ? `<button type="button" class="text-button" data-action="share-stop" ${a.shareBusy ? "disabled" : ""}>共有を停止</button>` : ""}`;
  return accountDialog(`<div class="account-panel-head"><button type="button" class="text-button account-back" data-action="share-close">戻る</button><strong id="account-dialog-title">セットを共有</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div><p class="account-share-title">${esc(displayName)}</p><p class="account-hint">${Number.isFinite(share.cardCount) ? `${share.cardCount}枚` : ""}${share.adultOnly === true ? " · R18を含む" : ""}${soloOnly ? "。以前に発行した共有リンクを管理できます。" : "。リンクを知っている人は、最初の6枚を登録なしで遊べます。"}</p>${url ? `<label class="account-share-url">共有リンク<input readonly value="${esc(url)}" data-share-url /></label>${share.active === false ? "" : `<div class="share-actions"><button type="button" class="primary-button" data-action="share-copy">リンクをコピー</button><button type="button" class="secondary-button" data-action="share-native">端末で共有</button></div>`}${qr}` : '<p class="account-hint">共有リンクはまだ発行されていません。</p>'}<div class="share-actions">${controls}</div>${a.error ? `<p class="form-error" role="alert">${esc(a.error)}</p>` : ""}${a.status ? `<p class="account-status" role="status">${esc(a.status)}</p>` : ""}`, "account-dialog-share");
}
function ageSettingsView(a) {
  const section = (inner) => `<section class="account-age-section" aria-labelledby="account-age-title"><h2 id="account-age-title">年齢の確認</h2>${inner}</section>`;
  if (a.ageConfirmedAt) {
    if (a.ageRevokeOpen) return section(`<p class="account-hint">取り消すと、R18のテーマ、R18を含むマイセットや途中のセッションが表示されなくなります。保存したカードやセットは削除されません。</p><div class="account-age-actions"><button type="button" class="danger-button" data-action="age-revoke-confirm" ${a.ageBusy ? "disabled" : ""}>${a.ageBusy ? "取り消し中…" : "取り消す"}</button><button type="button" class="text-button" data-action="age-revoke-cancel" ${a.ageBusy ? "disabled" : ""}>キャンセル</button></div>`);
    const date = formatConfirmedDate(a.ageConfirmedAt);
    return section(`<p>18歳以上であることを確認済みです${date ? `（${esc(date)}）` : ""}。</p><label class="account-age-check"><input type="checkbox" data-r18-display ${a.r18DisplayEnabled ? "checked" : ""}/> <span>R18を表示する</span></label><p class="account-hint">年齢確認済みでも、選ぶまでR18のテーマ・質問・保存内容は表示しません。いつでもオフにできます。</p><div class="account-age-actions"><button type="button" class="text-button" data-action="age-revoke-open" ${a.ageBusy ? "disabled" : ""}>確認を取り消す</button></div>`);
  }
  if (a.adultConfirmationAvailable !== true) return section('<p class="account-hint">年齢の確認は現在利用できません。</p>');
  return section(`<p class="account-hint">R18のテーマは、18歳以上であることを確認したアカウントにだけ表示されます。</p><label class="account-age-check"><input type="checkbox" data-age-confirm ${a.ageConfirmChecked ? "checked" : ""} ${a.ageBusy ? "disabled" : ""}/> <span>私は18歳以上です</span></label><div class="account-age-actions"><button type="button" class="primary-button" data-action="age-confirm" ${a.ageBusy || !a.ageConfirmChecked ? "disabled" : ""}>${a.ageBusy ? "保存中…" : "確認して保存"}</button></div>`);
}
function accountSettingsView(a) {
  if (a.deleteOpen) return accountDialog(`<div class="account-panel-head"><button type="button" class="text-button" data-action="account-settings">戻る</button><strong id="account-dialog-title">退会の確認</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div><div class="account-delete-warning"><p>退会すると、このアカウントの表示名・年齢確認の記録・お気に入り・自作質問カード・非公開マイセットを削除します。</p><p>このアカウントが所有する店舗設定・提供テーマ・卓上QR・利用集計も削除されます。</p><p>このアカウントが所有する企業組織と、そのメンバー登録・テーマや機能の設定も削除されます。所属しているだけの組織では、自分の登録だけが削除されます。</p><p>この端末の呼び名と途中データも削除されます。</p><p>削除後は取り消せません。</p><label class="account-delete-confirm-label"><input type="checkbox" data-delete-confirm ${a.deleteConfirmed ? "checked" : ""} ${a.busy ? "disabled" : ""}/> 内容を確認しました</label></div>${a.error ? `<p class="form-error" role="alert">${esc(a.error)}</p>` : ""}<div class="account-delete-actions"><button type="button" class="text-button" data-action="account-delete-cancel" ${a.busy ? "disabled" : ""}>キャンセル</button><button type="button" class="danger-button" data-action="account-delete-confirm" ${a.busy || !a.deletionAvailable || !a.deleteConfirmed ? "disabled" : ""}>${a.busy ? "削除中…" : "退会して削除"}</button></div>`, "account-dialog-delete");
  const valid = validDisplayName(a.profileDraft);
  return accountDialog(`<div class="account-panel-head"><button type="button" class="text-button" data-action="account-menu">戻る</button><strong id="account-dialog-title">アカウント設定</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div>${avatarSettingsView(a)}<form class="account-settings-form" data-form="profile"><label>表示名<input type="text" data-profile-name value="${esc(a.profileDraft)}" maxlength="80" autocomplete="nickname" ${a.busy ? "disabled" : ""}/></label><p class="account-hint">1人目の呼び名に自動入力されます。遊ぶときに変更できます。</p><p class="account-email">${esc(a.user?.email || "")}</p><button type="submit" class="primary-button" ${a.busy || !valid ? "disabled" : ""}>${a.busy ? "保存中…" : "表示名を保存"}</button></form>${a.status ? `<p class="account-status" role="status">${esc(a.status)}</p>` : ""}${a.error ? `<p class="form-error" role="alert">${esc(a.error)}</p>` : ""}${ageSettingsView(a)}<section class="account-delete-section"><h2>退会</h2>${a.deletionAvailable ? `<button type="button" class="danger-button" data-action="account-delete-open" ${a.avatarBusy ? "disabled" : ""}>アカウントを削除</button>` : '<p class="account-hint">退会手続きは現在利用できません。</p><a class="account-support" href="mailto:inquiry@erudaite.ai">問い合わせる</a>'}</section>`, "account-dialog-settings");
}
function accountView(options = {}) {
  if (!state.account.enabled) return "";
  const a = state.account;
  const overlayOnly = options.overlayOnly === true;
  const bar = accountButton(a);
  const wrap = (dialog) => (overlayOnly ? dialog : `${bar}${dialog}`);
  if (!a.open) return overlayOnly ? "" : bar;
  if (a.user && a.shareOpen) return wrap(shareDialogView(a));
  if (a.user && a.settingsOpen) return wrap(accountSettingsView(a));
  if (a.user && a.libraryOpen) return wrap(libraryAccountView(a));
  if (a.user) return wrap(accountDialog(`<div class="account-panel-head"><strong id="account-dialog-title">アカウント</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div><div class="account-menu-avatar"><span class="account-avatar">${accountAvatar(a.user)}</span></div>${a.user.displayName ? `<p class="account-display-name">${esc(a.user.displayName)}</p>` : ""}<p class="account-email">${esc(a.user.email || a.user.name || "ログイン中")}</p><button type="button" class="secondary-button account-menu-action" data-action="account-settings-open">${actionIcon("settings")}<span>アカウント設定</span></button>${!a.ageConfirmedAt && a.adultConfirmationAvailable ? '<p class="account-hint">R18テーマを表示するには、アカウント設定で年齢の確認が必要です。</p>' : ""}<a class="secondary-button account-menu-action" href="/daily.html">${actionIcon("clock")}<span>1日1問</span></a><button type="button" class="secondary-button account-menu-action" data-action="account-library-open">${actionIcon("bookmark")}<span>保存したカード・マイセット</span></button><a class="secondary-button account-menu-action" href="/marketplace.html">${actionIcon("search")}<span>マーケットプレイス</span></a><a class="secondary-button account-menu-action" href="${a.hasVenue ? '/venue.html' : 'https://partnerplan.mingle.cards'}">${actionIcon("building")}<span>${a.hasVenue ? '店舗管理' : '店舗の体験向上のために導入する'}</span></a><button type="button" class="text-button account-menu-action" data-action="logout">${actionIcon("right")}<span>ログアウト</span></button>${a.error ? `<p class="form-error" role="alert">${esc(a.error)}</p>` : ""}`, "account-dialog-menu"));
  return wrap(accountDialog(`<div class="account-panel-head"><strong id="account-dialog-title">${a.venueOnboarding ? "店舗アカウントを作成・ログイン" : state.continuePending ? "ログイン / 新規登録" : "ログインする"}</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div>${a.venueOnboarding ? '<p class="account-hint">ログイン後、店舗情報の入力画面へ戻ります。</p>' : '<p class="account-hint"><a href="https://partnerplan.mingle.cards">店舗の体験向上のために導入する</a></p>'}${a.google ? '<button type="button" class="secondary-button account-provider" data-action="google-login">Googleで続ける</button>' : ""}${a.venueOnboarding ? "" : `<label class="account-adult-intent"><input type="checkbox" data-adult-intent ${a.adultIntent ? "checked" : ""} /> <span>私は18歳以上です（任意）</span><small>チェックすると、ログイン後に年齢確認を設定できます。表示はアカウント設定で「R18を表示する」を選んだ場合だけです。</small></label>`}<form class="account-otp" data-form="account"><label>メールアドレス<input type="email" data-account-email value="${esc(a.email)}" required autocomplete="email" /></label>${a.otpSent ? '<label>確認コード<input inputmode="numeric" data-account-otp value="' + esc(a.otp) + '" required autocomplete="one-time-code" /></label><button type="button" class="text-button muted" data-action="reset-otp"' + (a.busy ? " disabled" : "") + ">メールアドレスを変更／コードを再送</button>" : ""}<button type="submit" class="primary-button">${a.busy ? "処理中…" : a.otpSent ? "ログインする" : "確認コードを送る"}</button></form><p class="account-status" role="status">${esc(a.status || (a.venueOnboarding ? "店舗情報を登録するにはログインしてください" : "ログインすると質問を保存できます"))}</p><p class="form-error" role="alert">${esc(a.error)}</p>`, "account-dialog-login"));
}
function topicIcon(deck) {
  const paths = {
    "acquaintance-date": '<path d="m12 20-1.7-1.55C4.25 12.93 1 9.9 1 6.2A5.2 5.2 0 0 1 6.2 1c1.7 0 3.32.8 4.3 2.06A5.57 5.57 0 0 1 14.8 1 5.2 5.2 0 0 1 20 6.2c0 3.7-3.25 6.73-9.3 12.25L12 20Z"/>', date: '<path d="m12 20-1.7-1.55C4.25 12.93 1 9.9 1 6.2A5.2 5.2 0 0 1 6.2 1c1.7 0 3.32.8 4.3 2.06A5.57 5.57 0 0 1 14.8 1 5.2 5.2 0 0 1 20 6.2c0 3.7-3.25 6.73-9.3 12.25L12 20Z"/>', couples: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>', intimacy: '<path d="M12 2c3.8 2.4 5.5 5.3 5.5 8.2A5.5 5.5 0 0 1 12 15.7a5.5 5.5 0 0 1-5.5-5.5C6.5 7.3 8.2 4.4 12 2Zm0 13.7c3.1 0 5.5 1.2 5.5 2.8S15.1 21 12 21s-5.5-1.1-5.5-2.5 2.4-2.8 5.5-2.8Z"/>', friends: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 19c.5-3 2.5-4.5 6-4.5S13.5 16 14 19M10 19c.5-3 2.5-4.5 6-4.5 2.4 0 4 .8 5 2.5"/>', founders: '<path d="M12 2 14.8 8l6.2.6-4.7 4.1 1.4 6.1-5.7-3.3-5.7 3.3 1.4-6.1-4.7-4.1L9.2 8 12 2Z"/>', team: '<path d="M4 18V7h16v11M8 7V4h8v3M2 20h20M9 12h6M9 15h6"/>',
    "sports-teammates": '<circle cx="12" cy="12" r="8"/><path d="m4.8 8.3 5.1 1.4 3.1-4.3M10 9.7l2.6 4.2 5.1 1.5M12.6 13.9l-4.2 2.6"/>',
    "parent-50plus": '<path d="m3 11 9-7 9 7v9H3v-9Zm5 9v-5h8v5M7 11h10"/>',
    "parent-under12": '<path d="M12 3v18M3 12h18"/>',
    reunion: '<path d="M4 5h16v11H8l-4 4V5Z"/><path d="M8 9h8M8 12h5"/>',
    siblings: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 19c.5-3 2.5-5 6-5s5.5 2 6 5M10 19c.5-3 2.5-5 6-5 3.5 0 5.5 2 6 5"/>',
    "new-couple": '<path d="M12 20S3 14.8 3 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 9 2.5C21 14.8 12 20 12 20Z"/>',
    "moving-in": '<path d="m3 11 9-8 9 8v9H3v-9Z"/><path d="M9 20v-6h6v6M7 11h10"/>',
    "first-intimacy": '<path d="M12 20S4 15.5 4 9a4 4 0 0 1 8-2 4 4 0 0 1 8 2c0 6.5-8 11-8 11Z"/><path d="M12 10v4M10 12h4"/>',
    "intimacy-refresh": '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 5v5h5"/><path d="M12 8v4l3 2"/>',
    "intimacy-distance": '<circle cx="8" cy="12" r="3"/><circle cx="16" cy="12" r="3"/><path d="M11 12h2M8 9V6M16 15v3"/>',
    "family-reunion": '<path d="M3 10 12 3l9 7v10H3V10Z"/><path d="M8 20v-6h8v6M7 10h10"/>',
    "new-colleagues": '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 20c.5-4 2.5-6 5-6s4.5 2 5 6M13 14h8M17 10v8"/>',
  };
  paths.omiai = '<path d="M3 10.5 12 3l9 7.5v9H3v-9Z"/><path d="M8 20v-5h8v5M7 10h10"/>';
  paths["party-first-meeting"] = '<circle cx="12" cy="8" r="4"/><path d="M4 21c.7-4 3.3-6 8-6s7.3 2 8 6M18 4l1 2 2 .3-1.5 1.5.4 2.2L18 9l-1.9 1M6 4 5 6l-2 .3 1.5 1.5-.4 2.2L6 9l1.9 1"/>';
  paths["business-meetup"] = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5V3h8v2M7 11h10M12 11v3"/>';
  paths["bar-first-meeting"] = '<path d="M4 4h16l-6 7v6l3 2H7l3-2v-6L4 4Z"/><path d="M8 8h8"/>';
  paths["promotion-rivals"] = '<path d="M4 20V9h5v11M10 20V4h5v16M16 20v-7h4v7M2 20h20"/>';
  paths["love-rivals"] = '<path d="M12 20S3 14.8 3 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 9 2.5C21 14.8 12 20 12 20Z"/><path d="M5 4l.7 1.4L7 6l-1.3.6L5 8l-.7-1.4L3 6l1.3-.6L5 4Z"/>';
  paths["arch-enemies"] = '<path d="m5 5 14 14M19 5 5 19"/><circle cx="12" cy="12" r="9"/>';
  paths["hero-and-demon-king"] = '<path d="M12 3 14 8l5 1-4 3 1 6-4-3-4 3 1-6-4-3 5-1 2-5Z"/><path d="M4 21h16"/>';
  paths["assassin-and-target"] = '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="m4 4 5 5"/>';
  paths["ex-lovers"] = '<path d="M12 20S3 14.8 3 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 9 2.5C21 14.8 12 20 12 20Z"/><path d="m12 6-1.5 4 3 2-1.5 4"/>';
  paths["detective-and-phantom-thief"] = '<circle cx="10" cy="10" r="6"/><path d="m14.5 14.5 6 6M7.5 10h5"/>';
  paths["in-laws"] = '<path d="M4 9h13v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6V9Z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3"/>';
  paths["same-oshi-fans"] = '<path d="M9 21h6M10 21V11h4v10"/><path d="M12 3v4M6.5 5.5l2 2M17.5 5.5l-2 2"/>';
  paths["roommates"] = '<path d="m3 11 9-8 9 8v9H3v-9Z"/><path d="M7 20v-5h3v5M14 20v-5h3v5"/>';
  paths["grandparents-and-grandchildren"] = '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="10" r="2"/><path d="M3 20c.5-4 2.5-6 5-6s4.5 2 5 6M14 20c.4-2.6 1.4-4 3-4s2.6 1.4 3 4"/>';
  paths["neighbors"] = '<path d="M2 20v-9l5-4 5 4v9M12 20v-9l5-4 5 4v9M1 20h22"/>';
  paths["travel-companions"] = '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V4h6v3M4 12h16"/>';
  paths["late-night-diner"] = '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>';
  paths["group-mixer"] = '<circle cx="6" cy="9" r="2.5"/><circle cx="12" cy="7" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M2 19c.4-3 1.8-5 4-5M22 19c-.4-3-1.8-5-4-5M8 19c.5-3.5 1.8-6 4-6s3.5 2.5 4 6"/>';
  paths["engaged-couple"] = '<circle cx="9" cy="15" r="5"/><circle cx="15" cy="15" r="5"/><path d="m10 5 2-2 2 2-2 3-2-3Z"/>';
  paths["classmates"] = '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M7 20l2-4M17 20l-2-4M7 9h6M7 12h4"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[deck.id] ?? paths.team}</svg>`;
}
function soloHistoryView() {
  if (!state.soloHistoryOpen) return `<button type="button" class="text-button solo-history-open" data-action="solo-history-open">${actionIcon("clock")}メモ一覧</button>`;
  if (!state.account.user) return `<section class="solo-history"><h2>保存したメモ</h2><p>保存済みメモを見るにはログインしてください。</p><button type="button" class="secondary-button" data-action="account">ログインする</button><button type="button" class="text-button" data-action="solo-history-close">閉じる</button></section>`;
  const rows = state.soloHistory.map((note) => { const editing = state.soloHistoryEditing?.id === note.id; const label = note.slotKind === "summary" ? `第${note.roundNumber}ラウンドまとめ` : (note.questionText || "質問メモ"); const disabled = state.busy ? "disabled" : ""; const locked = note.locked === true || (note.r18 === true && (!ageConfirmed() || !r18DisplayVisible())); const title = locked ? "R18のメモ" : (note.sourceTitle || "ひとりで"); const lockedMessage = note.r18 === true && r18DisplayVisible() === false && ageConfirmed() ? "「R18を表示する」を選ぶと表示できます。" : "年齢確認後に表示できます。"; return `<article class="solo-history-row"><time>${esc(new Date(note.createdAt || note.created_at).toLocaleString("ja-JP"))}</time><strong>${esc(title)}</strong><span>${esc(locked ? "R18のメモ" : label)}</span>${locked ? `<p class="account-hint">${lockedMessage}</p>` : editing ? `<textarea data-history-edit maxlength="2000" ${disabled}>${esc(state.soloHistoryEditing.note)}</textarea><div><button class="secondary-button" data-action="solo-history-save" data-note-id="${esc(note.id)}" ${disabled}>保存</button><button class="text-button" data-action="solo-history-cancel" ${disabled}>キャンセル</button></div>` : `<p class="solo-history-note">${esc(note.note)}</p><button class="text-button" data-action="solo-history-edit" data-note-id="${esc(note.id)}" ${disabled}>編集</button>`}<button class="text-button" data-action="solo-history-delete" data-note-id="${esc(note.id)}" ${disabled}>削除</button></article>`; }).join("");
  const retry = state.soloHistoryError ? `<button type="button" class="secondary-button" data-action="solo-history-retry" ${state.soloHistoryLoading || state.busy ? "disabled" : ""}>再試行</button>` : "";
  return `<section class="solo-history"><div class="solo-history-head"><h2>保存したメモ</h2><button type="button" class="text-button" data-action="solo-history-close">閉じる</button></div>${state.soloHistoryLoading ? "<p>読み込み中…</p>" : ""}${state.soloHistoryError ? `<p class="form-error">${esc(state.soloHistoryError)}</p>${retry}` : ""}${rows || (!state.soloHistoryLoading && !state.soloHistoryError ? "<p>保存済みメモはありません。</p>" : "")}${state.soloHistoryHasMore ? `<button class="secondary-button" data-action="solo-history-more" ${state.busy ? "disabled" : ""}>もっと見る</button>` : ""}</section>`;
}
async function loadSoloHistory(append = false) {
  if (!state.account.user || state.soloHistoryLoading || state.busy) return;
  const generation = state.account.generation; const ownerId = state.account.user.id; state.soloHistoryLoading = true; state.soloHistoryError = ""; render();
  try { const query = new URLSearchParams({ limit: "20" }); if (append && state.soloHistoryCursor) query.set("cursor", state.soloHistoryCursor); const result = await accountApi.listSoloNotes(query.toString()); if (generation !== state.account.generation || state.account.user?.id !== ownerId) return; const rows = Array.isArray(result.notes) ? result.notes : Array.isArray(result) ? result : []; state.soloHistory = append ? [...state.soloHistory, ...rows] : rows; state.soloHistoryCursor = result.nextCursor || result.next_cursor || null; state.soloHistoryHasMore = Boolean(state.soloHistoryCursor); }
  catch { if (generation === state.account.generation) state.soloHistoryError = "履歴を読み込めませんでした。"; }
  finally { if (generation === state.account.generation && state.account.user?.id === ownerId) { state.soloHistoryLoading = false; render(); } }
}
const SOLO_TOPIC_ICONS = {
  "self-love-now": '<path d="M12 20S4 14.5 4 9a4 4 0 0 1 8-1.5A4 4 0 0 1 20 9c0 5.5-8 11-8 11Z"/>',
  "self-crush": '<path d="M11 20S4 15 4 10a3.6 3.6 0 0 1 7-1.4A3.6 3.6 0 0 1 18 10c0 1-.2 1.9-.6 2.8"/><path d="M19 3v4M17 5h4"/>',
  "self-breakup-decided": '<path d="M14 4h5v16h-5"/><path d="M10 12H3m3-3-3 3 3 3"/>',
  "self-breakup-lingering": '<path d="M12 20S4 14.5 4 9a4 4 0 0 1 8-1.5A4 4 0 0 1 20 9c0 5.5-8 11-8 11Z"/><path d="m12 7.5-1.5 3 3 2-1.5 3"/>',
  "self-strengths": '<path d="m12 4 2 5 5 .5-3.8 3.4L16.4 18 12 15.3 7.6 18l1.2-5.1L5 9.5l5-.5z"/>',
  "self-work": '<path d="M4 8h16v11H4zM8 8V5h8v3"/><path d="M4 12h16"/>',
  "self-school": '<path d="m3 8 9-4 9 4-9 4z"/><path d="M7 10v4.5c3 2 7 2 10 0V10"/>',
  "self-club": '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>',
  "self-friends": '<circle cx="9" cy="9" r="3"/><circle cx="16" cy="10" r="2.5"/><path d="M3.5 19c.6-3 2.6-5 5.5-5s4.9 2 5.5 5M14.5 19c.3-2 1.4-3.5 3-3.5 1.4 0 2.6 1.2 3 3.5"/>',
  "self-values": '<path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  "self-checkin": '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
};
function soloTopicIcon(deck) { const path = SOLO_TOPIC_ICONS[String(deck?.id || "")] || '<circle cx="12" cy="12" r="7"/><path d="m12 8 1.2 2.6L16 12l-2.8 1.4L12 16l-1.2-2.6L8 12l2.8-1.4z"/>'; return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`; }
function participantRuleVisibleForParticipants(rule) {
  if (state.themeMode === 'solo') return rule === 'solo';
  const count = Array.isArray(state.participants) ? state.participants.length : 0;
  if (count === 2) return rule === 'pair' || rule === 'group';
  return rule === 'group';
}
function themeExplorerText(deck, categoryLabels = {}) {
  const categories = (themeGroups[deck.id] || []).map((id) => categoryLabels[id] || id).join('・');
  const soloCategory = soloCategories.find((category) => category.id === deck.category)?.label || deck.category || '';
  return `${deck.title || ''} ${deck.subtitle || ''} ${categories} ${soloCategory}`.toLocaleLowerCase('ja-JP');
}
function themeExplorerCard(deck, { solo = false, mixed = false, selectedMySet = null, shelfId = 'main' } = {}) {
  const set = deck.__mySet || null;
  const mySetSelected = Boolean(selectedMySet || state.selectedMySetId);
  const selected = set ? state.selectedMySetId === set.id : solo ? (!mySetSelected && state.selectedDeckId === deck.id) : (mixed ? !mySetSelected && state.selectedDeckIds.includes(deck.id) : !mySetSelected && state.selectedDeckId === deck.id);
  const available = set ? true : solo ? true : canUseDeck(deck); const locked = !available;
  const name = `theme-${solo ? 'solo' : 'group'}-${shelfId}-${deck.id}`;
  const control = '';
  const image = set ? cardDesignForSession({ mode: solo ? 'solo' : 'group', customSet: true, deckId: set.deckId || (solo ? 'self-values' : 'date'), design: set.design }).back : themeExplorerImage(deck.id);
  const title = set?.name || deck.title;
  const subtitle = set?.description || themeExampleForDeck(deck);
  const count = set?.cardCount || (Array.isArray(deck.questions) ? deck.questions.length : 40);
  const action = set ? 'choose-myset' : 'theme-select';
  const bookmarkId = set ? `set:${set.id}` : deck.id;
  const bookmarked = themeExplorerBookmarks(state.account.user?.id).includes(bookmarkId);
  const experienced = themeExplorerExperienced(state.account.user?.id).includes(bookmarkId);
  const showRecommendationNode = !set && (shelfId === 'recommended' || shelfId === 'solo-recommended' || state.themeExplorerView === 'list');
  const labelKind = showRecommendationNode ? recommendationLabel(deck.id) : '';
  const label = labelKind === 'yesterday_top' ? '昨日の人気No.1' : labelKind === 'rising' ? '人気上昇中！' : '';
  const labelTitle = labelKind === 'yesterday_top' ? '昨日のテーマ開始数で1位' : labelKind === 'rising' ? '昨日のテーマ開始数が一昨日より増加' : '';
  const imageMarkup = image ? `<span class="theme-explorer-image-wrap"><img class="theme-explorer-image" src="${esc(image)}" alt="" loading="lazy" width="320" height="213" />${showRecommendationNode ? `<span class="theme-explorer-label" data-theme-recommendation-label="${esc(deck.id)}" title="${esc(labelTitle)}">${label}</span>` : ''}</span>` : '';
  const bookmark = `<button type="button" class="theme-explorer-bookmark ${bookmarked ? 'is-active' : ''}" data-action="theme-bookmark" data-bookmark-id="${esc(bookmarkId)}" aria-pressed="${bookmarked}" aria-label="${bookmarked ? '保存を外す' : 'テーマを保存'}：${esc(title)}" title="${bookmarked ? '保存を外す' : 'テーマを保存'}：${esc(title)}">${actionIcon('bookmark')}</button>`;
  const experiencedToggle = `<button type="button" class="theme-explorer-experienced ${experienced ? 'is-active' : ''}" data-action="theme-experienced" data-experienced-id="${esc(bookmarkId)}" aria-pressed="${experienced}" aria-label="${experienced ? '体験済みを外す' : '体験済みにする'}：${esc(title)}">${experienced ? '✓ 体験済み' : '体験済みにする'}</button>`;
  return `<div class="theme-explorer-card-wrap">${bookmark}<button type="button" class="theme-explorer-card ${selected ? 'is-selected' : ''} ${locked ? 'is-locked' : ''}" data-action="${action}" data-theme-card data-theme-id="${esc(deck.id)}" ${set ? `data-set-id="${esc(set.id)}"` : ''} data-theme-key="${esc(shelfId)}:${esc(deck.id)}" aria-pressed="${selected}" aria-disabled="${locked}" ${locked ? 'disabled' : ''}>${imageMarkup}<span class="theme-explorer-card-body">${control}<strong>${esc(title)}</strong><small>${esc(subtitle)}</small><span class="theme-explorer-meta">${locked ? '🔒 登録で解放' : `${count}枚`}</span></span></button>${experiencedToggle}</div>`;
}
function themeExplorerShelf(id, title, decksForShelf, options = {}) {
  const cards = decksForShelf.map((deck) => themeExplorerCard(deck, { ...options, shelfId: id })).join('');
  if (!cards) return '';
  const controls = state.themeExplorerView === 'list' ? '' : `<div class="theme-explorer-shelf-controls"><button type="button" class="icon-button" data-action="theme-shelf-scroll" data-target="${esc(id)}" data-direction="-1" aria-label="${esc(title)}を左へ" title="左へ">${actionIcon('left')}</button><button type="button" class="icon-button" data-action="theme-shelf-scroll" data-target="${esc(id)}" data-direction="1" aria-label="${esc(title)}を右へ" title="右へ">${actionIcon('right')}</button></div>`;
  return `<section class="theme-explorer-shelf" aria-labelledby="${esc(id)}-heading"><div class="theme-explorer-shelf-head"><h2 id="${esc(id)}-heading">${esc(title)}</h2>${controls}</div><div class="theme-explorer-track ${state.themeExplorerView === 'list' ? 'is-list' : ''}" id="${esc(id)}" tabindex="0" data-theme-rail>${cards}</div></section>`;
}
function themeGameCard(game, shelfId = 'game') {
  const icon = '<svg viewBox="0 0 72 56" focusable="false"><rect x="18" y="8" width="38" height="40" rx="5" fill="currentColor" opacity=".28" transform="rotate(9 18 8)"/><rect x="11" y="10" width="38" height="40" rx="5" fill="currentColor" opacity=".9"/><rect x="24" y="17" width="38" height="40" rx="5" fill="#f07867" opacity=".92"/><path d="M34 28h17M34 34h11" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';
  const gate = gameParticipantGate(game, state.participants.length);
  if (!gate.valid) return '';
  const meta = game.meta;
  const imageSrc = gameCardImage(game.id); const image = imageSrc ? `<span class="theme-explorer-image-wrap theme-game-image-wrap"><img class="theme-explorer-image theme-game-image" src="${esc(imageSrc)}" alt="" loading="lazy" decoding="async" width="960" height="640" /></span>` : `<span class="theme-explorer-image-wrap theme-game-icon" aria-hidden="true">${icon}</span>`;
  return `<div class="theme-explorer-card-wrap"><button type="button" class="theme-explorer-card theme-game-card" data-action="game-launch" data-game-id="${esc(game.id)}" data-theme-key="${esc(shelfId)}:${esc(game.id)}">${image}<span class="theme-explorer-card-body"><strong>${esc(game.title)}</strong><small>${esc(game.subtitle)}</small><span class="theme-explorer-meta">${esc(meta)}</span></span></button></div>`;
}
function themeGameShelf(games) {
  const cards = games.map((game) => themeGameCard(game)).join('');
  if (!cards) return themeExplorerEmpty();
  return `<section class="theme-explorer-shelf" aria-labelledby="group-games-heading"><div class="theme-explorer-shelf-head"><h2 id="group-games-heading">ゲーム</h2></div><div class="theme-explorer-track ${state.themeExplorerView === 'list' ? 'is-list' : ''}" id="group-games" data-theme-rail>${cards}</div></section>`;
}

function themeExplorerUnique(decksForResult) {
  return [...new Map(decksForResult.map((deck) => [deck.id, deck])).values()];
}
function themeExplorerEmpty() {
  return '<p class="theme-explorer-empty" role="status">見つかりませんでした。<button type="button" class="secondary-button" data-theme-reset>絞り込みを解除</button></p>';
}
function themeTagMatches(id, tagFilter, bookmarkedIds, experiencedIds) {
  return tagFilter === 'bookmarked' ? bookmarkedIds.has(id) : tagFilter === 'experienced' ? experiencedIds.has(id) : true;
}
function themeExplorerToolbar({ solo = false, filters = '', mix = false, hideTag = false } = {}) {
  const mixControl = mix ? `<label class="mode-switch compact-mode-switch"><input type="checkbox" data-mode-mixed ${state.themeMode === 'mixed' ? 'checked' : ''}/> <span>テーマミックス</span><small>2〜3テーマ</small></label>` : '';
  const tagControl = hideTag ? '' : `<select class="theme-explorer-tag-filter" data-theme-tag-filter aria-label="テーマのタグ"><option value="all" ${state.themeExplorerTagFilter === 'all' ? 'selected' : ''}>すべて</option><option value="bookmarked" ${state.themeExplorerTagFilter === 'bookmarked' ? 'selected' : ''}>保存済み</option><option value="experienced" ${state.themeExplorerTagFilter === 'experienced' ? 'selected' : ''}>体験済み</option></select>`;
  return `<div class="theme-explorer-toolbar-row">${mixControl}<div class="theme-explorer-toolbar"><label class="theme-explorer-search"><span class="sr-only">テーマを検索</span><input type="search" data-theme-explorer-search value="${esc(state.themeExplorerQuery)}" placeholder="テーマを検索" autocomplete="off" /></label>${tagControl}<div class="theme-explorer-view" role="group" aria-label="表示形式"><button type="button" class="icon-button ${state.themeExplorerView === 'cards' ? 'is-active' : ''}" data-action="theme-view" data-view="cards" aria-pressed="${state.themeExplorerView === 'cards'}" title="カード表示">${actionIcon('grid')}</button><button type="button" class="icon-button ${state.themeExplorerView === 'list' ? 'is-active' : ''}" data-action="theme-view" data-view="list" aria-pressed="${state.themeExplorerView === 'list'}" title="リスト表示">${actionIcon('list')}</button></div></div></div>${filters ? `<div class="filter-chips theme-explorer-filters" role="toolbar" aria-label="テーマカテゴリ">${filters}</div>` : ''}`;
}
function themeExplorerSelectedBar({ solo = false, selected, selectedMySet = null, mixed = false, showSettings = false, optionsOpen = state.themeOptionsOpen, canStart = true, participantRule = 'group' } = {}) {
  const mixedLabel = state.selectedDeckIds.map((id) => [...decks, ...soloDecks].find((deck) => deck.id === id)?.title).filter(Boolean).join('・');
  const label = selectedMySet
    ? selectedMySet.name
    : mixed
      ? `${state.selectedDeckIds.length}テーマ: ${mixedLabel || '未選択'}`
      : selected?.title || 'テーマを選択してください';
  const blocked = selectedMySet?.hasR18 === true && !state.adultConfirmed;
  const namesValid = solo || (state.participants.length >= 2 && state.participants.length <= 8 && state.participants.every((name) => typeof name === 'string' && name.trim()));
  const participantMismatch = !solo && participantRule === 'pair' && state.participants.length !== 2;
  const disabled = blocked || canStart !== true || !namesValid || participantMismatch;
  const reason = participantMismatch ? `2人専用です（現在${state.participants.length}人）` : !namesValid ? '参加者の名前を入力してください' : state.error;
  const changeParticipants = participantMismatch || !namesValid ? `<button type="button" class="secondary-button participant-edit-link" data-action="edit-participants">参加者を変更</button>` : '';
  return `<div class="theme-explorer-selected-bar">${reason ? `<span class="theme-explorer-selection-error" role="alert">${esc(reason)}</span>` : ''}<span>選択中: <strong>${esc(label)}</strong></span><div class="theme-explorer-selected-actions">${changeParticipants}${showSettings ? `<button type="button" class="icon-button theme-options-toggle" data-action="theme-options-toggle" aria-expanded="${optionsOpen}" aria-label="詳細設定" title="詳細設定">${actionIcon('settings')}</button>` : ''}<button class="primary-button selected-start" type="button" data-action="${selectedMySet ? 'choose-myset-start' : (solo ? 'solo-start' : 'choose-deck')}" ${selectedMySet ? `data-set-id="${esc(selectedMySet.id)}"` : selected ? `data-deck="${esc(selected.id)}"` : ''} ${disabled ? 'disabled' : ''}>${actionIcon('play')}はじめる</button></div></div>`;
}
function soloDecksView() {
  const selected = state.selectedMySetId ? null : (soloDecks.find((deck) => deck.id === state.selectedDeckId) || soloDecks[0]);
  const query = state.themeExplorerQuery.trim().toLocaleLowerCase('ja-JP');
  const matches = (deck) => !query || themeExplorerText(deck, Object.fromEntries(soloCategories.map((c) => [c.id, c.label]))).includes(query);
  const bookmarkedIds = new Set(themeExplorerBookmarks(state.account.user?.id));
  const experiencedIds = new Set(themeExplorerExperienced(state.account.user?.id));
  const tagMatches = (deck) => themeTagMatches(deck.__mySet ? `set:${deck.__mySet.id}` : deck.id, state.themeExplorerTagFilter, bookmarkedIds, experiencedIds);
  const all = soloDecks.filter(matches).filter(tagMatches);
  const historyIds = themeExplorerHistory(state.account.user?.id, 'solo').flatMap((row) => row.themeIds || []);
  const history = historyIds.map((id) => soloDecks.find((deck) => deck.id === id)).filter(Boolean).filter(matches);
  const historyRows = history.map((deck) => ({ themeIds: [deck.id] }));
  const filters = [`<button type="button" class="filter-chip ${state.themeExplorerShelf === 'all' ? 'is-active' : ''}" data-theme-category="all">すべて</button>`, ...soloCategories.map((category) => `<button type="button" class="filter-chip ${state.themeExplorerShelf === category.id ? 'is-active' : ''}" data-theme-category="${esc(category.id)}">${esc(category.label)}</button>`)].join('');
  const categoryDecks = state.themeExplorerShelf !== 'all' ? all.filter((deck) => deck.category === state.themeExplorerShelf) : all;
  const soloCategoryShelves = soloCategories.map((category) => themeExplorerShelf(`solo-category-${category.id}`, category.label, categoryDecks.filter((deck) => deck.category === category.id), { solo: true })).join('');
  const allowedSets = playableSavedSets(state.account.sets, state.account.customCards).filter((set) => ['solo', 'both'].includes(set.audience) && (!set.hasR18 || (ageConfirmed() && r18DisplayVisible())));
  const sets = allowedSets.filter((set) => !query || `${set.name || 'マイセット'} ${set.description || ''}`.toLocaleLowerCase('ja-JP').includes(query));
  const selectedMySet = allowedSets.find((set) => set.id === state.selectedMySetId) || null;
  if (state.selectedMySetId && !selectedMySet) state.selectedMySetId = null;
  const mySetEntries = sets.map((set) => ({ id: `set:${set.id}`, title: set.name || 'マイセット', __mySet: set })).filter(tagMatches);
  const historyEntries = historyIds.map((id) => {
    const deck = history.find((item) => item.id === id);
    if (deck) return deck;
    const set = sets.find((item) => item.id === id);
    return set ? { id: `set:${set.id}`, title: set.name || 'マイセット', __mySet: set } : null;
  }).filter(Boolean);
  const recommendedIds = ['self-values', 'self-checkin', 'self-work', 'self-friends', 'self-love-now', 'self-school', 'self-strengths', 'self-club'];
  const recommended = rankThemeRecommendations({
    decks: all,
    historyRows,
    baseIds: recommendedIds,
    // Solo cards keep the existing guest-first behavior; group guest access
    // must not accidentally lock the standard solo catalog.
    isAvailable: () => true,
    categoryOf: (deck) => deck?.category ? [deck.category] : [],
  });
  const visibleMySetEntries = query.length || state.themeExplorerView === 'list'
    ? mySetEntries.filter((entry) => state.themeExplorerShelf === 'all' || entry.__mySet?.category === state.themeExplorerShelf)
    : [];
  const soloFlat = themeExplorerUnique([...categoryDecks, ...visibleMySetEntries]);
  const soloNeedsFlat = state.themeExplorerView === 'list' || query.length > 0 || state.themeExplorerShelf !== 'all' || state.themeExplorerTagFilter !== 'all';
  const soloBrowse = soloNeedsFlat
    ? (soloFlat.length ? themeExplorerShelf('solo-filtered', 'テーマ一覧', soloFlat, { solo: true, selectedMySet }) : themeExplorerEmpty())
    : `${themeExplorerShelf('solo-recommended', 'おすすめ', recommended, { solo: true, selectedMySet })}${historyEntries.length ? themeExplorerShelf('solo-history', '最近遊んだテーマ', historyEntries, { solo: true, selectedMySet }) : ''}${mySetEntries.length ? themeExplorerShelf('solo-mysets', 'マイセット', mySetEntries, { solo: true, selectedMySet }) : ''}${soloCategoryShelves}`;
  const soloConsent = selectedMySet?.hasR18 ? `<label class="consent selected-consent"><input type="checkbox" data-adult="my-set" ${state.adultConfirmed ? 'checked' : ''} ${!isRegisteredUser() ? 'disabled' : ''}/><span><strong>参加者全員が18歳以上で、R18の話題に同意しています</strong><small>このマイセットにはR18の質問が含まれています。</small></span></label>` : '';
  const soloOptionsOpen = state.themeOptionsOpen;
  const soloControls = `<div class="theme-options ${soloOptionsOpen ? 'is-expanded' : ''}"><div class="theme-options-details"><div class="theme-options-head"><strong>詳細設定</strong><button type="button" class="icon-button" data-action="theme-options-toggle" aria-label="詳細設定を閉じる" title="閉じる">×</button></div>${soloConsent}</div>${themeExplorerSelectedBar({ solo: true, selected, selectedMySet, showSettings: Boolean(soloConsent), optionsOpen: soloOptionsOpen, canStart: true })}</div>`;
  return frame(`<div class="theme-screen solo-theme-screen theme-explorer-screen"><div class="intro compact"><h1 tabindex="-1" data-focus>ひとりで</h1></div>${themeExplorerToolbar({ solo: true, filters })}${soloBrowse}<p class="form-error" role="alert">${esc(state.error)}</p>${soloControls}${state.account.open ? accountView({ overlayOnly: true }) : ''}</div>`, 'ひとりで', true);
}
function decksView() {
  if (state.themeMode === 'solo') return soloDecksView();
  const mixed = state.themeMode === 'mixed';
  const query = state.themeExplorerQuery.trim().toLocaleLowerCase('ja-JP');
  const allowedSets = !mixed && isRegisteredUser() ? playableSavedSets(state.account.sets, state.account.customCards).filter((set) => ['group', 'both'].includes(set.audience) && participantRuleVisibleForParticipants(participantRuleForSavedSet(set, 'group')) && (!set.hasR18 || (ageConfirmed() && r18DisplayVisible()))) : [];
  const mySets = allowedSets.filter((set) => participantRuleVisibleForParticipants(participantRuleForSavedSet(set, 'group')) && (!query || `${set.name || 'マイセット'} ${set.description || ''}`.toLocaleLowerCase('ja-JP').includes(query)));
  const selectedMySet = allowedSets.find((set) => set.id === state.selectedMySetId) || null;
  if (state.selectedMySetId && !selectedMySet) state.selectedMySetId = null;
  if (mixed) {
    const compatibleIds = state.selectedDeckIds.filter((id) => participantRuleVisibleForParticipants(participantRuleForDeck(id)));
    if (compatibleIds.length !== state.selectedDeckIds.length) {
      state.selectedDeckIds = compatibleIds;
      state.selectedDeckId = compatibleIds[0] || '';
    }
  }
  let selected = decks.find((deck) => deck.id === state.selectedDeckId) || decks[0];
  if (!mixed && !selectedMySet) {
    const selectedUsable = selected && participantRuleVisibleForParticipants(participantRuleForDeck(selected)) && canSeeDeck(selected) && canUseDeck(selected);
    if (!selectedUsable) {
      const candidate = decks
        .filter((deck) => participantRuleVisibleForParticipants(participantRuleForDeck(deck)) && canSeeDeck(deck))
        .find((deck) => canUseDeck(deck));
      if (candidate) {
        selected = candidate;
        state.selectedDeckId = candidate.id;
        state.selectedDeckIds = [candidate.id];
        state.adultConfirmed = false;
        state.themeOptionsOpen = false;
      }
    }
  }
  const categoryLabels = Object.fromEntries(Object.entries(groupLabels));
  const matches = (deck) => !query || themeExplorerText(deck, categoryLabels).includes(query);
  const bookmarkedIds = new Set(themeExplorerBookmarks(state.account.user?.id));
  const experiencedIds = new Set(themeExplorerExperienced(state.account.user?.id));
  const tagMatches = (deck) => themeTagMatches(deck.__mySet ? `set:${deck.__mySet.id}` : deck.id, state.themeExplorerTagFilter, bookmarkedIds, experiencedIds);
  const regular = decks.filter((deck) => !deck.adultOnly && matches(deck) && tagMatches(deck) && canSeeDeck(deck) && participantRuleVisibleForParticipants(participantRuleForDeck(deck)));
  const adult = decks.filter((deck) => (deck.adultOnly || deck.r18Available) && matches(deck) && tagMatches(deck) && ageConfirmed() && r18DisplayVisible() && canSeeDeck(deck) && participantRuleVisibleForParticipants(participantRuleForDeck(deck)));
  const historyIds = themeExplorerHistory(state.account.user?.id, 'group').flatMap((row) => row.themeIds || []);
  const history = historyIds.map((id) => decks.find((deck) => deck.id === id)).filter(Boolean).filter(matches).filter(tagMatches).filter((deck) => canSeeDeck(deck)).filter((deck) => participantRuleVisibleForParticipants(participantRuleForDeck(deck))).filter((deck) => !mixed || !deck.adultOnly);
  const historyRows = history.map((deck) => ({ themeIds: [deck.id] }));
  const filters = Object.entries(groupLabels).filter(([id]) => id !== 'adult' || (!mixed && ageConfirmed() && r18DisplayVisible())).map(([id, label]) => `<button type="button" class="filter-chip ${((mixed && state.themeExplorerShelf === 'adult' ? 'all' : state.themeExplorerShelf) === id) ? 'is-active' : ''}" data-theme-category="${esc(id)}">${esc(label)}</button>`).join('');
  const categoryId = mixed && state.themeExplorerShelf === 'adult' ? 'all' : state.themeExplorerShelf;
  const gameQuery = state.themeExplorerQuery.trim().toLocaleLowerCase('ja-JP');
  const visibleGames = groupGames.filter((game) => gameParticipantGate(game, state.participants.length).valid && (!gameQuery || `${game.title} ${game.subtitle} ${game.meta}`.toLocaleLowerCase('ja-JP').includes(gameQuery)));
  const categoryDecks = categoryId !== 'all' && categoryId !== 'adult' ? regular.filter((deck) => themeGroups[deck.id]?.includes(categoryId)) : categoryId === 'adult' ? adult : regular;
  const recommendedIds = state.participants.length >= 3
    ? ['friends', 'family-reunion', 'team', 'group-mixer', 'party-first-meeting', 'business-meetup', 'bar-first-meeting', 'date']
    : ['friends', 'date', 'party-first-meeting', 'business-meetup', 'bar-first-meeting', 'family-reunion', 'team', 'group-mixer'];
  const recommended = rankThemeRecommendations({
    decks: regular,
    historyRows,
    baseIds: recommendedIds,
    isAvailable: (deck) => canUseDeck(deck),
    categoryOf: (deck) => themeGroups[deck?.id] || [],
  });
  const groupCategoryShelves = Object.entries(groupLabels).filter(([id]) => !['all', 'adult', 'game'].includes(id)).map(([id, label]) => themeExplorerShelf(`group-category-${id}`, label, regular.filter((deck) => themeGroups[deck.id]?.includes(id)), { mixed })).join('');
  const mySetEntries = mySets.map((set) => ({ id: `set:${set.id}`, title: set.name || 'マイセット', __mySet: set })).filter(tagMatches);
  const historyEntries = historyIds.map((id) => {
    const deck = history.find((item) => item.id === id);
    if (deck) return deck;
    const set = mySets.find((item) => item.id === id);
    return set ? { id: `set:${set.id}`, title: set.name || 'マイセット', __mySet: set } : null;
  }).filter(Boolean).filter(tagMatches);
  const consent = !mixed && (canOfferR18(selected) || selected?.adultOnly); const consentCopy = selected?.r18Available ? 'R18を含めていい' : '参加者全員が18歳以上で、R18の話題に同意しています';
  const mySetConsent = selectedMySet?.hasR18 ? `<label class="consent selected-consent"><input type="checkbox" data-adult="my-set" ${state.adultConfirmed ? 'checked' : ''} ${!isRegisteredUser() ? 'disabled' : ''}/><span><strong>参加者全員が18歳以上で、R18の話題に同意しています</strong><small>このマイセットにはR18の質問が含まれています。</small></span></label>` : '';
  const allRegular = decks.filter((deck) => !deck.adultOnly && canSeeDeck(deck));
  const selectedRequiresConsent = !mixed && Boolean(selected?.adultOnly);
  const mixedRule = mixed && state.selectedDeckIds.some((id) => participantRuleForDeck(id) === 'pair') ? 'pair' : 'group';
  const selectedRule = selectedMySet ? participantRuleForSavedSet(selectedMySet, 'group') : mixed ? mixedRule : participantRuleForDeck(selected);
  const participantCountValid = selectedRule !== 'pair' || state.participants.length === 2;
  const canStart = selectedMySet ? participantCountValid : mixed ? state.selectedDeckIds.length >= 2 && state.selectedDeckIds.length <= 3 && state.selectedDeckIds.every((id) => allRegular.some((deck) => deck.id === id) && canUseDeck(decks.find((deck) => deck.id === id))) && participantCountValid : Boolean(selected && canUseDeck(selected) && (!selectedRequiresConsent || state.adultConfirmed) && participantCountValid);
  const optionsOpen = state.themeOptionsOpen;
  const challengeConsent = !selectedMySet ? `<label class="consent challenge-toggle"><input type="checkbox" data-challenges ${state.includeChallenges ? 'checked' : ''}/><span><strong>「やってみて」を入れる</strong><small>6枚につき1枚、お題が入ります。</small></span></label>` : '';
  const participantHint = !participantCountValid ? '<p class="form-error" role="alert">2人専用です。参加者を変更してください。</p>' : '';
  const optionBody = `${selectedMySet ? mySetConsent : (!mixed && consent ? `<label class="consent selected-consent"><input type="checkbox" data-adult="${esc(selected.id)}" ${state.adultConfirmed ? 'checked' : ''} ${!isRegisteredUser() ? 'disabled' : ''}/><span><strong>${esc(consentCopy)}</strong><small>全員が18歳以上で、話題に同意できるときに。</small></span></label>` : '')}${challengeConsent}${participantHint}<p class="form-error" role="alert">${esc(state.error)}</p>${isRegisteredUser() && !mixed && participantCountValid ? `<a class="secondary-button group-room-link" href="${groupRoomHref(groupRoomArgs(selected, selectedMySet))}">みんなのスマホで遊ぶ</a>` : ''}`;
  const participantNamesValid = state.participants.length >= 2 && state.participants.length <= 8 && state.participants.every((name) => typeof name === 'string' && name.trim());
  const controls = `<div class="theme-options ${optionsOpen ? 'is-expanded' : ''}"><div class="theme-options-details"><div class="theme-options-head"><strong>詳細設定</strong><button type="button" class="icon-button" data-action="theme-options-toggle" aria-label="詳細設定を閉じる" title="閉じる">×</button></div>${optionBody}</div>${themeExplorerSelectedBar({ selected, selectedMySet, mixed, showSettings: true, optionsOpen, canStart: canStart && participantNamesValid, participantRule: selectedRule })}</div>`;
  const listPool = mixed ? regular : [...regular, ...adult];
  const adultShelf = !mixed && categoryId === 'all' && adult.length ? themeExplorerShelf('group-category-adult', 'R18のテーマ', adult, { mixed }) : '';
  const visibleMySetEntries = query.length || state.themeExplorerView === 'list'
    ? mySetEntries.filter((entry) => categoryId === 'all' || (categoryId === 'adult' ? entry.__mySet?.hasR18 === true : entry.__mySet?.category === categoryId))
    : [];
  const groupFlat = themeExplorerUnique([...(categoryId === 'all' ? listPool : categoryDecks), ...visibleMySetEntries]);
  const groupNeedsFlat = state.themeExplorerView === 'list' || query.length > 0 || categoryId !== 'all' || state.themeExplorerTagFilter !== 'all';
  const groupBrowse = categoryId === 'game'
    ? themeGameShelf(visibleGames)
    : groupNeedsFlat
    ? `${groupFlat.length ? themeExplorerShelf('group-filtered', categoryId === 'all' ? 'テーマ一覧' : categoryId === 'adult' ? 'R18のテーマ' : 'カテゴリ別', groupFlat, { mixed, selectedMySet }) : (categoryId === 'all' && state.themeExplorerTagFilter === 'all' && visibleGames.length ? '' : themeExplorerEmpty())}${categoryId === 'all' && state.themeExplorerTagFilter === 'all' && visibleGames.length ? themeGameShelf(visibleGames) : ''}`
    : `${themeExplorerShelf('recommended', 'おすすめ', recommended.filter(matches), { mixed, selectedMySet })}${historyEntries.length ? themeExplorerShelf('history', '最近遊んだテーマ', historyEntries, { mixed, selectedMySet }) : ''}${mySetEntries.length ? themeExplorerShelf('group-mysets', 'マイセット', mySetEntries, { mixed, selectedMySet }) : ''}${groupCategoryShelves}${adultShelf}${state.themeExplorerTagFilter === 'all' && visibleGames.length ? themeGameShelf(visibleGames) : ''}`;
  const gameCategory = categoryId === 'game';
  return frame(`<div class="theme-screen theme-explorer-screen"><div class="intro compact"><h1 tabindex="-1" data-focus>質問テーマを選ぶ</h1></div>${!isRegisteredUser() ? `<p class="guest-theme-note">無料登録で、さらに多くのテーマが使えます。</p>` : ''}${themeExplorerToolbar({ filters, mix: !gameCategory, hideTag: gameCategory })}${state.error ? `<p class="form-error" role="alert">${esc(state.error)}</p>` : ''}${groupBrowse}${gameCategory ? '' : controls}${state.account.open ? accountView({ overlayOnly: true }) : ''}</div>`, 'Mingle.Cards', true);
}

function participantChips(session) { return session.participants.map((name, index) => { const initial = Array.from(name.trim())[0] ?? '・'; return `<span class="participant-chip participant-color-${index} ${index === currentParticipantIndex(session) ? "is-current" : ""}"><i aria-hidden="true">${esc(initial)}</i>${esc(name)}</span>`;
    })
    .join(""); }
function cardAudioButton() { return `<button type="button" class="card-audio-toggle" data-action="audio-toggle" aria-label="カードをめくる音を${isCardAudioEnabled() ? "オフ" : "オン"}にする" aria-pressed="${isCardAudioEnabled()}">${isCardAudioEnabled() ? "🔊" : "🔇"}</button>`; }

function sharedPlayView(session) {
  if (venueR18Hidden(session)) return frame(venueR18Gate(session), "店舗カード", true);
  const revealed = session.revealed === true;
  const card = revealed ? currentCard(session) : null;
  const activeCard = currentCard(session);
  const solo = session.mode === "solo";
  const roundPosition = session.cursor % ROUND_SIZE;
  const roundTotal = Math.min(ROUND_SIZE, remaining(session) + roundPosition);
  const playTitle = session.sharedGuest ? session.setName || "共有セット" : session.customSet ? "マイセット" : session.mixed ? `テーマミックス · ${session.deckIds.map((id) => [...decks, ...soloDecks].find((deck) => deck.id === id)?.title).filter(Boolean).join("・")}` : ([...decks, ...soloDecks].find((deck) => deck.id === session.deckId)?.title ?? "会話カード");
  const cardDesign = cardDesignForSession(session);
  const cardArtStyle = `--card-art-front:url('${cardDesign.front}');--card-art-back:url('${cardDesign.back}');--card-art-accent:${cardDesign.accent}`;
  const currentIndex = currentParticipantIndex(session);
  const previousSpeakerIndex = root.querySelector(".shared-speaker[data-speaker-index]")?.getAttribute("data-speaker-index");
  const speakerChanged = previousSpeakerIndex !== undefined && previousSpeakerIndex !== String(currentIndex);
  const speakerName = currentSpeaker(session);
  const sourceDeckId = session.questions?.[session.cursor]?.sourceDeckId || session.deckId;
  const cardDeck = [...decks, ...soloDecks].find((item) => item.id === sourceDeckId);
  const cardThemeMark = card?.kind === "challenge" ? "" : solo ? soloMotifForDeck(sourceDeckId) : cardDeck ? topicIcon(cardDeck) : "";
  const displayText = activeCard ? displayQuestionText(activeCard.text, { participants: session.participants, participantIndex: currentIndex, rule: participantRuleForSession(session) }) : "";
  const question = revealed ? esc(displayText || "カードを読み込んでいます…") : (solo ? "タップしてめくる" : "タップしてめくる");
  const isChallenge = Boolean(card?.kind === "challenge");
  const together = !solo && isTogetherCard(card);
  const favorite = revealed && !solo && state.account.user && state.account.enabled && card?.kind !== "challenge" && !card?.custom ? `<button type="button" class="favorite-card-button ${state.account.favorites.has(card.id) ? "is-saved" : ""}" data-action="favorite-card" aria-pressed="${state.account.favorites.has(card.id)}" aria-label="${state.account.favorites.has(card.id) ? "保存済み" : "質問を保存"}" title="${state.account.favorites.has(card.id) ? "保存済み" : "質問を保存"}" ${state.account.busy ? "disabled" : ""}>${state.account.favorites.has(card.id) ? "★" : "☆"}</button>` : `<span class="play-toolbar-slot" aria-hidden="true"></span>`;
  const cardAudio = cardAudioButton();
  const cardClass = revealed ? "shared-question-card is-revealed" : "shared-question-card is-face-down";
  const primaryAction = revealed ? (solo ? "next-answer" : "next-answer") : "reveal";
  const primaryLabel = revealed ? (solo ? "次へ" : together || session.answerIndex === session.participants.length - 1 ? "次のカード" : "次の人") : "めくる";
  const actions = solo ? `<div class="shared-actions" role="group" aria-label="操作"><button class="primary-button" data-action="${primaryAction}" ${state.busy ? "disabled" : ""}>${primaryLabel}</button><button class="pass-button" data-action="pass" aria-label="パス" title="パス" ${state.busy ? "disabled" : ""}>${actionIcon("skip")}</button></div>` : `<div class="shared-actions" role="group" aria-label="回答操作"><button class="secondary-button" data-action="previous-answer" aria-label="前の人へ" ${state.busy || !revealed || session.answerIndex === 0 ? "disabled" : ""}>${actionIcon("left")}</button><button class="like-button" data-action="like" aria-label="いいね" ${state.busy || !revealed ? "disabled" : ""}>${actionIcon("heart")} <strong>${revealed ? currentAnswerLikes(session) : 0}</strong></button><button class="primary-button" data-action="${primaryAction}" ${state.busy ? "disabled" : ""}>${primaryLabel}</button><button class="pass-button" data-action="pass" aria-label="パス" title="パス" ${state.busy ? "disabled" : ""}>${actionIcon("skip")}</button></div>`;
  const otherParticipants = session.participants.filter((_, index) => index !== currentIndex).join("・");
  const speaker = solo ? "" : together ? `<div class="shared-speaker is-together" aria-live="polite"><strong>${session.participants.length === 2 ? "ふたりで" : "みんなで"}</strong><span class="shared-participants">${esc(session.participants.join("・"))}</span></div>` : `<div class="shared-speaker${speakerChanged ? " is-speaker-changing" : ""}" data-speaker-index="${currentIndex}" aria-live="polite"><span class="shared-speaker-avatar" aria-hidden="true">${esc(Array.from((speakerName || "・").trim())[0] || "")}</span><strong>${esc(speakerName)}の番</strong>${otherParticipants ? `<span class="shared-participants">${esc(otherParticipants)}</span>` : ""}</div>`;
  const segments = Array.from({ length: roundTotal }, (_, index) => `<span class="round-segment ${index < roundPosition ? "is-done" : ""} ${index === roundPosition ? "is-current" : ""}"></span>`).join("");
  const accountOverlay = (state.account.open ? accountView({ overlayOnly: true }) : "") + (state.venue?.displayR18 === true && state.session?.venueSession && sessionHasR18(session) ? `<label class="adult-consent venue-play-toggle"><input type="checkbox" data-venue-play-r18 checked> <span>R18を表示する</span></label>` : "");
  const measurement = !revealed && displayText ? `<span class="shared-card-measure" aria-hidden="true">${esc(displayText)}</span>` : "";
  return frame(`<div class="shared-play-shell ${solo ? "is-solo" : "is-group"}"><div class="shared-play-head"><div><p class="play-deck">${esc(playTitle)}</p><p class="progress-copy" aria-label="全${session.questions.length}枚中${session.cursor + 1}枚目">${roundPosition + 1} / ${roundTotal}</p></div><button type="button" class="icon-action theme-change-button" data-action="decks" aria-label="テーマを変更">${actionIcon("grid")}</button></div><div class="round-progress shared-round-progress" aria-label="今回の進み具合">${segments}</div><article style="${cardArtStyle}" data-card-family="${cardDesign.family}" class="${cardClass}" ${!revealed ? 'data-action="reveal" role="button" tabindex="0" aria-label="カードをめくる"' : ""} aria-live="polite"><span class="shared-art-rail" aria-hidden="true"></span><span class="shared-card-copy">${isChallenge ? '<span class="challenge-badge">やってみて</span>' : ""}${question}</span>${measurement}<span class="shared-card-motif" aria-hidden="true">${cardThemeMark || ""}</span><span class="shared-bubbles" aria-hidden="true"><i></i><i></i></span>${favorite}${cardAudio}</article>${speaker}${actions}<p class="shared-pass-hint">話したくない質問はパスしてOK</p><p class="form-error" role="alert">${esc(state.error)}</p>${accountOverlay}</div>`, "Mingle.Cards", true);
}

function playView() {
  const session = state.session;
  if (venueR18Hidden(session)) return frame(venueR18Gate(session), "店舗カード", true);
  if (isFinished(session)) return finishView();
  if (isRoundComplete(session) && !session.revealed) return roundView();
  return sharedPlayView(session);
}

function feedbackState(session) {
  if (!session) return null;
  const key = feedbackKey(session.sessionId, session.cursor);
  if (!state.feedback || state.feedback.key !== key) { state.feedback = { key, rating: null, text: "", status: "", error: "" }; state.roundFeedbackExpanded = false; }
  return state.feedback;
}
function feedbackSubmitted(session) { return Array.isArray(session?.feedbackSubmitted) && session.feedbackSubmitted.includes(session.cursor); }
function likeTotalsView(session) {
  const all = summarizeLikes(session, 0, session.cursor);
  const currentStart = Math.max(0, Math.min(session.cursor, session.roundStart ?? 0));
  const current = summarizeLikes(session, currentStart, session.cursor);
  const duplicateNames = new Set(session.participants.filter((name, index, names) => names.indexOf(name) !== index));
  const rows = (totals) => totals.map((item) => `<li class="like-total-row participant-color-${item.index}"><span class="like-total-person"><i aria-hidden="true">${esc(Array.from(item.name.trim())[0] || "・")}</i>${esc(item.name)}${duplicateNames.has(item.name) ? `（${item.index + 1}人目）` : ""}</span><strong>${Number.isSafeInteger(item.likes) && item.likes >= 0 ? item.likes : 0}</strong><span aria-hidden="true">いいね</span></li>`).join("");
  const total = session.questions.length; const isFinal = session.cursor >= total;
  const body = isFinal
    ? `<p class="like-total-label">今回の全${total}枚</p><ul>${rows(all)}</ul>${currentStart < session.cursor ? `<p class="like-total-label">最後の${session.cursor - currentStart}枚</p><ul>${rows(current)}</ul>` : ""}` : `<p class="like-total-label">今回の${session.cursor - currentStart}枚</p><ul>${rows(current)}</ul>${currentStart > 0 ? `<p class="like-total-label">これまでの合計（${session.cursor}枚）</p><ul>${rows(all)}</ul>` : ""}`;
  const key = `${session.sessionId}:${session.cursor}`;
  if (state.roundLikeKey !== key) { state.roundLikeKey = key; state.roundLikeExpanded = false; }
  const displayCount = isFinal ? total : session.cursor - currentStart;
  const compact = session.participants.length <= 2 ? `<ul>${rows(isFinal ? all : current)}</ul>` : `<p class="round-collapsed-copy">${session.participants.length}人分の集計</p>`;
  const hasDetails = session.participants.length > 2 || currentStart > 0;
  const detailsAction = hasDetails ? `<button type="button" class="round-section-toggle" data-action="round-like-toggle" aria-expanded="${state.roundLikeExpanded}">${state.roundLikeExpanded ? "閉じる" : "詳しく見る"}</button>` : "";
  return `<section class="like-totals" aria-labelledby="like-totals-title"><div class="round-section-head"><h2 id="like-totals-title">いいね！の集計</h2><span class="round-section-count">${displayCount}枚</span></div>${state.roundLikeExpanded && hasDetails ? body : compact}${detailsAction}</section>`;
}
function roundFavoriteContext(session) {
  const cards = completedRoundFavoriteCards(session);
  if (!cards.length) {
    if (state.roundFavorite?.sessionId === session.sessionId) state.roundFavorite = null;
    return null;
  }
  const key = `${session.sessionId}:${session.roundStart}:${session.cursor}`;
  if (!state.roundFavorite || state.roundFavorite.key !== key) state.roundFavorite = { key, sessionId: session.sessionId, roundStart: session.roundStart, cursor: session.cursor, cards, selected: new Set(), saving: false, error: "",
      loginPending: false,
      expanded: false,
    };
  else state.roundFavorite.cards = cards;
  return state.roundFavorite;
}
function roundFavoriteView(session) {
  const context = roundFavoriteContext(session);
  if (!context) return "";
  const selectable = context.cards.filter((card) => !state.account.favorites.has(card.id));
  const selectedCount = [...context.selected].filter((id) => selectable.some((card) => card.id === id)).length;
  const rows = context.cards.map((card) => {
    const saved = state.account.favorites.has(card.id);
    const checked = saved || context.selected.has(card.id);
    const label = card.r18 === true && !session.adultConfirmed ? "R18のテーマ" : card.text;
      return `<label class="round-favorite-row"><input type="checkbox" data-round-favorite data-card-id="${esc(card.id)}" ${checked ? "checked" : ""} ${saved || context.saving ? "disabled" : ""}/><span>${esc(label)}</span>${saved ? "<small>保存済み</small>" : ""}</label>`;
    })
    .join("");
  const action = state.account.user ? `<button type="button" class="secondary-button" data-action="round-favorite-save" ${context.saving || !selectedCount ? "disabled" : ""}>${context.saving ? "保存中…" : "選択した質問を保存"}</button>` : state.account.enabled ? `<button type="button" class="secondary-button" data-action="round-favorite-login" ${context.saving || !selectedCount ? "disabled" : ""}>ログインして保存</button>` : '<p class="account-muted">現在、質問を保存できません。</p>';
  const savedCount = context.cards.length - selectable.length;
  const list = context.expanded ? `<div class="round-favorite-list">${rows}</div>${action}` : `<p class="round-collapsed-copy">${selectedCount}件選択中 · ${savedCount}件保存済み</p>`;
  return `<section class="round-favorites" aria-labelledby="round-favorites-title"><div class="round-section-head"><h2 id="round-favorites-title">気に入った質問を保存</h2><span class="round-section-count">${context.cards.length}件</span></div><button type="button" class="round-section-toggle" data-action="round-favorite-toggle" aria-expanded="${context.expanded}">${context.expanded ? "閉じる" : "質問を選ぶ"}</button>${list}<p class="form-error" role="alert">${esc(context.error || "")}</p></section>`;
}
function roundLikeThemes(session) {
  if (!session || session.customSet || session.sharedGuest || session.venueSession) return [];
  const start = Math.max(0, Math.min(Number(session.roundStart) || 0, session.cursor));
  const end = Math.max(start, Math.min(Number(session.cursor) || 0, Array.isArray(session.questions) ? session.questions.length : 0));
  const ids = session.mixed
    ? session.questions.slice(start, end).map((card) => card?.sourceDeckId).filter(Boolean)
    : [session.deckId];
  const catalog = new Map([...decks, ...soloDecks].map((deck) => [String(deck.id), deck]));
  return [...new Set(ids.map(String))].map((id) => ({ id, label: catalog.get(id)?.title || id })).filter((item) => catalog.has(item.id));
}
function roundThemeLikeView(session) {
  const themes = roundLikeThemes(session);
  if (!themes.length) return "";
  const buttons = themes.map(({ id, label }) => {
    const liked = hasThemeLike(id); const status = state.themeLikeStatus[id] || ""; const pending = state.themeLikePending.has(id);
    const success = status === "thanks" || liked;
    return `<div class="theme-like-item"><button type="button" class="theme-like-button${success ? " is-liked" : ""}" data-action="theme-like" data-theme-id="${esc(id)}" aria-pressed="${success}" ${success || pending ? "disabled" : ""}>${actionIcon("heart")}<span>${esc(label)}にいいね</span></button>${success ? '<span class="theme-like-thanks" role="status">ありがとう！</span>' : status === "pending" ? '<span class="theme-like-thanks" role="status">送信中…</span>' : status === "error" ? '<span class="theme-like-error" role="alert">送信できませんでした。もう一度お試しください。</span>' : ""}</div>`;
  }).join("");
  return `<section class="theme-likes" aria-label="テーマへのいいね"><div class="theme-like-list">${buttons}</div></section>`;
}
async function shareRoundResult() {
  if (!state.session) return;
  const text = roundShareText();
  try {
    if (navigator.share) {
      await navigator.share({ title: "Mingle.Cards", text });
      state.shareFallbackText = "";
      state.shareStatus = "共有しました。";
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      state.shareFallbackText = "";
      state.shareStatus = "共有文をコピーしました。";
    } else {
      state.shareStatus = "共有機能を利用できません。";
    }
  } catch (error) {
    if (error?.name !== "AbortError") state.shareStatus = "共有できませんでした。";
  }
  render();
}
function roundShareTitle(session) {
  if (session.sharedGuest) return sessionHasR18(session) && ((state.venue && state.venue.displayR18 !== true) || (!state.venue && !r18DisplayVisible())) ? "R18を含むテーマ" : (session.setName || "共有セット");
  if (session.customSet) return session.setName || state.account.sets.find((set) => set.id === session.setId)?.name || "マイセット";
  if (session.mixed) return session.deckIds.map((id) => decks.find((item) => item.id === id)?.title).filter(Boolean).join("・") || "テーマミックス";
  return [...decks, ...soloDecks].find((item) => item.id === session.deckId)?.title || "会話テーマ";
}
function roundShareText() { return buildShareText(roundShareTitle(state.session)); }
function lineShareUrl(text) { const body = text.endsWith("https://mingle.cards/") ? text.slice(0, -"https://mingle.cards/".length).trimEnd() : text; return `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent("https://mingle.cards/")}&text=${encodeURIComponent(body)}`; }
function roundShareDialogView() {
  const text = roundShareText();
  return `<div class="share-overlay" data-share-overlay><section class="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" tabindex="-1"><button type="button" class="share-dialog-close" data-action="share-dialog-close" aria-label="共有ダイアログを閉じる">×</button><img class="share-dialog-image" src="/assets/mingle-og.png" alt="Mingle.Cardsで会話を楽しむイメージ" width="934" height="559" /><div class="share-dialog-body"><p class="eyebrow">Mingle.Cards</p><h2 id="share-dialog-title">会話をシェアしよう</h2><p class="share-dialog-lead">${esc(roundShareTitle(state.session))}</p><div class="share-dialog-links" role="group" aria-label="SNSでシェア"><a class="share-social share-social-x" data-share-x href="${esc(buildXShareUrl(text))}" target="_blank" rel="noopener noreferrer" aria-label="Xで共有"><span aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.77 7.74L23.2 22h-6.24l-4.89-6.4L6.47 22H3.36l7.24-8.27L2.8 2h6.4l4.42 5.83L18.9 2Zm-1.1 17.8h1.73L8.27 4.1H6.41L17.8 19.8Z" fill="currentColor"/></svg></span><small>X</small></a><a class="share-social share-social-facebook" data-share-facebook href="${esc(buildFacebookShareUrl())}" target="_blank" rel="noopener noreferrer" aria-label="Facebookで共有"><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 8h3V3h-3c-3.31 0-5 1.91-5 5v3H6v5h3v8h5v-8h3.5l.5-5H14V8c0-.67.33-1 1-1Z" fill="currentColor"/></svg></span><small>Facebook</small></a><a class="share-social share-social-line" data-share-line href="${esc(lineShareUrl(text))}" target="_blank" rel="noopener noreferrer" aria-label="LINEで共有"><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21.5 11.5c0-4.14-4.04-7.5-9-7.5s-9 3.36-9 7.5c0 3.7 3.25 6.8 7.64 7.4l-.52 1.95c-.12.46.38.84.79.59l2.82-1.72c4.23-.7 7.27-3.85 7.27-7.72Z" fill="currentColor"/></svg></span><small>LINE</small></a><button type="button" class="share-social share-social-copy" data-action="social-share-copy" aria-label="共有文とURLをコピー"><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 8h11v12H8zM5 16H4V4h11v1" fill="none" stroke="currentColor" stroke-width="2"/></svg></span><small>コピー</small></button>${navigator.share ? `<button type="button" class="share-social share-social-more" data-action="social-share-native" aria-label="その他の共有方法"><span aria-hidden="true">•••</span><small>その他</small></button>` : ""}</div><p class="share-dialog-note">Facebookへ投稿する文章を確認できます。</p><details class="share-dialog-details"><summary>投稿文を確認</summary><textarea class="share-dialog-text" readonly aria-label="共有する本文とURL" data-share-fallback rows="4">${esc(text)}</textarea><p class="share-dialog-url"><span>リンク</span> https://mingle.cards/</p></details>${state.shareStatus ? `<p class="account-status" role="status">${esc(state.shareStatus)}</p>` : ""}</div></section></div>`;
}
async function copyFacebookShareText() {
  const text = roundShareText();
  let copied = false;
  try {
    if (navigator.clipboard) { await navigator.clipboard.writeText(text); copied = true; }
  } catch { copied = false; }
  if (!copied) { state.shareDialogOpen = true; state.focusSelector = ".share-dialog [data-share-fallback]"; }
  state.shareFallbackText = copied ? "" : text;
  state.shareStatus = copied ? "投稿文をコピーしました。Facebookで貼り付けてください。" : "投稿文をコピーできませんでした。下の本文を選択してコピーできます。";
  render();
}
async function copyRoundShare() {
  const text = roundShareText();
  try {
    if (!navigator.clipboard) throw new Error("clipboard");
    await navigator.clipboard.writeText(text);
    state.shareFallbackText = "";
    state.shareStatus = "共有文をコピーしました。";
  } catch { state.shareFallbackText = text; state.shareDialogOpen = true; state.focusSelector = ".share-dialog [data-share-fallback]"; state.shareStatus = "共有文をコピーできませんでした。下の本文を選択してコピーできます。"; }
  render();
}
function roundView() {
  const session = state.session;
  if (venueR18Hidden(session)) return frame(venueR18Gate(session), "店舗カード", true);
  if (session.mode === "solo") return soloRoundView(session);
  const totalCards = session.questions.length; const isFinal = session.cursor >= totalCards; const feedback = feedbackState(session); const submitted = feedbackSubmitted(session);
  const favoriteContext = roundFavoriteContext(session); const favoriteBusy = Boolean(favoriteContext?.saving);
  const endingLink = isActiveVenueSession() && state.venue?.venue.endingUrl ? `<a class="venue-ending-link" href="${esc(state.venue.venue.endingUrl)}" target="_blank" rel="noopener noreferrer">店舗の公式SNS/サイトを見る</a>` : "";
  const feedbackForm = submitted ? '<p class="feedback-success" role="status">フィードバック送信済み。ありがとう！</p>' : `<details class="round-feedback-details" data-round-feedback ${state.roundFeedbackExpanded ? "open" : ""}><summary>α版アンケート <span>ご意見をお聞かせください</span></summary><div class="feedback-box" aria-labelledby="feedback-title"><h2 id="feedback-title" class="feedback-survey-title">α版アンケート</h2><p id="feedback-survey-description" class="feedback-survey-description">今回のミングルについて意見をきかせてください。どうすればもっと楽しめますか？</p><div class="feedback-ratings" role="group" aria-label="評価"><button type="button" class="feedback-rating ${feedback.rating === "positive" ? "is-selected" : ""}" data-action="feedback-rating" data-rating="positive" aria-pressed="${feedback.rating === "positive"}" ${state.feedbackBusy ? "disabled" : ""}>いいね！</button><button type="button" class="feedback-rating ${feedback.rating === "needs_improvement" ? "is-selected" : ""}" data-action="feedback-rating" data-rating="needs_improvement" aria-pressed="${feedback.rating === "needs_improvement"}" ${state.feedbackBusy ? "disabled" : ""}>改善余地大きい！</button></div><label class="feedback-label" for="feedback-text">ひとこと（任意）</label><textarea id="feedback-text" data-feedback-text maxlength="1000" rows="3" placeholder="気づいたことがあれば" ${state.feedbackBusy ? "disabled" : ""}>${esc(feedback.text)}</textarea><p class="form-error" role="alert">${esc(feedback.error)}</p><button type="button" class="secondary-button feedback-submit" data-action="feedback-submit" ${state.feedbackBusy || (!feedback.rating && !feedback.text.trim()) ? "disabled" : ""}>${state.feedbackBusy ? "送信中…" : "送信する"}</button></div></details>`;
  const accountOverlay = (state.account.open ? accountView({ overlayOnly: true }) : "") + (state.venue?.displayR18 === true && state.session?.venueSession && sessionHasR18(state.session) ? `<label class="adult-consent venue-play-toggle"><input type="checkbox" data-venue-play-r18 checked> <span>R18を表示する</span></label>` : "");
  return frame(`<div class="round-break">${renderAd("round")}<img class="round-hero" src="/assets/friends-conversation-closeup.png" alt="会話を楽しむ人たち" width="1611" height="976" /><span class="round-badge">${session.cursor} / ${totalCards}</span><h1 tabindex="-1" data-focus>今回のミングルは<br>どうだった？</h1>${roundThemeLikeView(session)}<div class="break-actions">${!isFinal ? `<button class="primary-button" data-action="continue" ${state.busy || favoriteBusy ? "disabled" : ""}>${state.busy ? "確認中…" : `${actionIcon("right")}つづける`}</button>` : ""}<button class="secondary-button" data-action="finish" aria-label="プレイを終わる" title="終わる" ${favoriteBusy ? "disabled" : ""}>${actionIcon("stop")}終わる</button><button class="secondary-button social-share-button" data-action="social-share" aria-label="SNSでシェア" title="シェア" ${favoriteBusy ? "disabled" : ""}>${actionIcon("share")}シェア</button></div>${likeTotalsView(session)}${roundFavoriteView(session)}${feedbackForm}${endingLink}${state.shareStatus ? `<p class="account-status" role="status">${esc(state.shareStatus)}</p>` : ""}${state.shareFallbackText ? `<label class="share-fallback-label">共有文<textarea readonly data-share-fallback rows="4">${esc(state.shareFallbackText)}</textarea></label>` : ""}<p class="form-error" role="alert">${esc(state.error)}</p><button class="back-link" data-action="decks" aria-label="テーマを変更" title="テーマを変更" ${favoriteBusy ? "disabled" : ""}>${actionIcon("grid")}テーマ</button></div>${state.shareDialogOpen ? roundShareDialogView() : ""}${accountOverlay}`);
}

function finishView() { return roundView(); }


function normalizeAccountUser(user, previous = null) { if (!user) return null; const sameUser = previous?.id && user.id && previous.id === user.id; const hasDisplayName = Object.prototype.hasOwnProperty.call(user, "displayName");
  const hasAvatarUrl = Object.prototype.hasOwnProperty.call(user, "avatarUrl");
  const displayName = hasDisplayName ? user.displayName : sameUser ? previous.displayName : (user.user_metadata?.display_name ?? null);
  const avatarUrl = hasAvatarUrl ? user.avatarUrl : sameUser ? previous.avatarUrl || "" : "";
  return {
    ...user,
    displayName,
    avatarUrl: typeof avatarUrl === "string" ? avatarUrl : "",
  }; }
async function loadAccount() {
  if (!state.account.enabled) return;
  const generation = state.account.generation; const profileRevision = state.account.profileRevision; const avatarRevision = state.account.avatarRevision;
  const localDraftSnapshot = { drafts: state.account.drafts, sets: state.account.sets, customCards: state.account.customCards, soloNoteDrafts: state.soloNoteDrafts, soloSummaryDrafts: state.soloSummaryDrafts, soloHistory: state.soloHistory };
  const previousUser = state.account.user; let transientFailure = false;
  let continueAfterLogin = false;
  let resumeAfterLogin = null;
  let intentFailed = false;
  const current = () => generation === state.account.generation && profileRevision === state.account.profileRevision && avatarRevision === state.account.avatarRevision;
  try {
    const me = await accountApi.me();
    if (!current()) return;
    const previousUserId = state.account.user?.id || null, previousAgeConfirmedAt = state.account.ageConfirmedAt;
    state.account.user = normalizeAccountUser(me.user || null, state.account.user);
    state.account.hasVenue = me.account?.hasVenue === true;
    if (state.account.venueOnboarding && state.account.user) { clearVenueOnboardingIntent(); location.replace('/venue.html?onboarding=1'); return; }
    if (previousUserId && previousUserId !== state.account.user?.id) { try { sessionStorage.removeItem(AUTH_RETURN_KEY); } catch {} state.soloNoteDrafts = Object.create(null); state.soloNoteStatuses = Object.create(null); state.soloNoteErrors = Object.create(null); state.soloSummaryDrafts = Object.create(null); state.soloSummaryStatuses = Object.create(null); state.soloSummaryErrors = Object.create(null); state.soloHistory = []; state.soloHistoryCursor = null; state.soloHistoryHasMore = false; state.soloHistoryError = ""; }
    state.account.avatarUrl = avatarImageSrc(state.account.user?.avatarUrl);
    if (!state.account.avatarBusy && !state.account.avatarDraft) state.account.avatarError = "";
    state.account.deletionAvailable = me.account?.deletionAvailable === true;
    state.account.adultConfirmationAvailable = me.account?.adultConfirmationAvailable === true;
    // When the server could not read the status (available:false), keep the last known value for the same account only.
    state.account.ageConfirmedAt = nextAgeConfirmedAt({ previous: previousAgeConfirmedAt, sameAccount: Boolean(previousUserId && previousUserId === state.account.user?.id), confirmedAt: me.account?.adultConfirmedAt, available: me.account?.adultConfirmationAvailable });
    const serverAgeConfirmed = Boolean(state.account.user?.id && typeof state.account.ageConfirmedAt === "string" && state.account.ageConfirmedAt);
    if ((previousUserId && previousUserId !== state.account.user?.id) || (state.account.user && !serverAgeConfirmed)) { clearR18Visible(state.account, r18Storage()); state.account.r18DisplayHydrated = false; }
    else if (state.account.user && !state.account.r18DisplayHydrated) { const wasAuthReady = state.account.authReady; state.account.authReady = true; readR18Visible(state.account, r18Storage()); state.account.authReady = wasAuthReady; state.account.r18DisplayHydrated = true; }
    state.account.customCardsAvailable = me.customCardsAvailable === true;
    state.account.draftsAvailable = me.draftsAvailable === true; state.account.completionAvailable = me.account?.completionAvailable === true; state.account.aiGenerationAvailable = me.aiGenerationAvailable === true; state.account.drafts = Array.isArray(me.drafts) ? me.drafts : [];
    state.account.customCards = state.account.customCardsAvailable && Array.isArray(me.customCards) ? me.customCards.map((card) => ({ ...card, id: typeof card.id === "string" && card.id.startsWith("custom:") ? card.id : `custom:${card.id}`,
          }))
        : [];
    state.account.profileDraft = state.account.user?.displayName || "";
    syncAccountParticipantName();
    if (state.account.user) {
      const minorityIntent = state.account.venueOnboarding || state.account.libraryReturn ? null : consumeMinorityAuthIntent();
      if (minorityIntent) { state.account.open = false; location.replace(`/minority-room.html?create=1${minorityIntent.venueToken ? `&venue=${encodeURIComponent(minorityIntent.venueToken)}` : ''}`); return; }
      const questionWolfIntent = state.account.venueOnboarding || state.account.libraryReturn ? null : consumeQuestionWolfAuthIntent();
      if (questionWolfIntent) { if (!saveQuestionWolfAuthIntent(questionWolfIntent)) { state.account.status = '質問ウルフの復帰情報を保存できませんでした。'; } else { state.account.open = false; location.replace(`/question-wolf.html?create=1${questionWolfIntent.venueToken ? `&venue=${encodeURIComponent(questionWolfIntent.venueToken)}` : ''}`); return; } }
      intentFailed = await applyAdultIntent();
      if (!current()) return;
      restoreAuthReturnIntent();
      if (!current()) return;
      state.account.favorites = new Set((me.favorites || []).map((item) => item.cardId || item.card_id || item.id || item));
      state.account.sets = (me.sets || []).map((set) => ({ ...set, cards: set.cards || (set.card_ids || []).map((cardId) => ({ cardId })),
      }));
      const loginContext = state.roundFavorite;
      if (loginContext?.loginPending && state.session && isCurrentRoundFavorite(loginContext, state.session, loginContext.key)) { loginContext.loginPending = false; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.focusAction = "round-favorite-save"; }
      if (isContinuePendingCurrent()) { continueAfterLogin = true; state.continuePending = null; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.account.status = ""; state.focusAction = "continue"; }
      if (state.account.returnAfterAuth) { state.account.returnAfterAuth = false; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.account.status = ""; }
      if (state.soloHistoryOpen && !state.soloHistoryLoading) loadSoloHistory(false);
      if (state.continuePending?.kind === "resume" && state.continuePending.sessionId === state.resume?.sessionId) { resumeAfterLogin = state.continuePending.snapshot; state.continuePending = null; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.account.status = ""; state.focusAction = "resume"; }
      const pending = state.pendingCustomResume;
      if (pending) {
        if ((!pending.customQuestions?.length || state.account.customCardsAvailable) && pending.ownerUserId === state.account.user.id) state.resume = pending;
        else clearSession();
        state.pendingCustomResume = null;
      }
    }
  } catch { transientFailure = true; if (!current()) return; state.account.user = previousUser; state.account.ageConfirmedAt = previousUser ? state.account.ageConfirmedAt : null; state.account.adultConfirmationAvailable = previousUser ? state.account.adultConfirmationAvailable : false; state.account.authReady = true; if (state.continuePending) { state.account.status = ""; state.account.error = "ログイン状態を確認できませんでした。時間をおいて、もう一度お試しください。"; } }
  if (transientFailure && previousUser && state.account.user?.id === previousUser.id) { state.account.drafts = localDraftSnapshot.drafts; state.account.sets = localDraftSnapshot.sets; state.account.customCards = localDraftSnapshot.customCards; state.soloNoteDrafts = localDraftSnapshot.soloNoteDrafts; state.soloSummaryDrafts = localDraftSnapshot.soloSummaryDrafts; state.soloHistory = localDraftSnapshot.soloHistory; state.soloNoteStatuses = Object.create(null); state.soloNoteErrors = Object.create(null); state.soloSummaryStatuses = Object.create(null); state.soloSummaryErrors = Object.create(null); }
  if (!transientFailure && !state.account.user && previousUser) { state.account.drafts = []; state.account.sets = []; state.account.customCards = []; state.soloNoteDrafts = Object.create(null); state.soloNoteStatuses = Object.create(null); state.soloNoteErrors = Object.create(null); state.soloSummaryDrafts = Object.create(null); state.soloSummaryStatuses = Object.create(null); state.soloSummaryErrors = Object.create(null); state.soloHistory = []; state.soloHistoryCursor = null; state.soloHistoryHasMore = false; state.soloHistoryError = ""; }
  if (!current()) return;
  state.account.authReady = true;
  if (!transientFailure && !state.account.user) { clearR18Visible(state.account, r18Storage()); state.account.r18DisplayHydrated = false; }
      const ochiIntent = state.account.venueOnboarding || state.account.libraryReturn ? null : consumeOchiAuthIntent();
      if (ochiIntent) { if (!saveOchiAuthIntent(ochiIntent)) { state.account.status = 'オチから話しての復帰情報を保存できませんでした。'; } else { state.account.open = false; location.replace(`/ochi-room.html?create=1${ochiIntent.venueToken ? `&venue=${encodeURIComponent(ochiIntent.venueToken)}` : ''}`); return; } }
      const oneCutIntent = state.account.venueOnboarding || state.account.libraryReturn ? null : consumeOneCutAuthIntent();
      if (oneCutIntent) { if (!saveOneCutAuthIntent(oneCutIntent)) { state.account.status = 'ワンカットの復帰情報を保存できませんでした。'; } else { state.account.open = false; location.replace(`/one-cut.html?create=1${oneCutIntent.venueToken ? `&venue=${encodeURIComponent(oneCutIntent.venueToken)}` : ''}`); return; } }
      const missionIntent = state.account.venueOnboarding || state.account.libraryReturn ? null : consumeMissionAuthIntent();
      if (missionIntent) { if (!saveMissionAuthIntent(missionIntent)) { state.account.status = 'ミッション・ミングルの復帰情報を保存できませんでした。'; } else { state.account.open = false; location.replace(`/mission-mingle.html?create=1${missionIntent.venueToken ? `&venue=${encodeURIComponent(missionIntent.venueToken)}` : ''}`); return; } }
  if (intentFailed) state.account.status = "年齢の確認を保存できませんでした。アカウント設定からもう一度お試しください。";
  if (state.account.user && !state.venue && state.shared?.ageConfirmationRequired === true) refreshSharedAfterAccountChange();
  if (resumeAfterLogin) resumeSaved(resumeAfterLogin);
  else render();
  if (continueAfterLogin) continueCurrentRound();
}
async function loginWithOtp() {
  const email = state.account.email.trim();
  if (!email || state.account.busy) return;
  state.account.busy = true; state.account.error = "";
  state.account.status = ""; render();
  saveAdultIntent();
  try { if (state.account.otpSent) { await accountApi.verifyOtp(email, state.account.otp.trim()); state.account.status = "ログインしました。"; } else { await accountApi.sendOtp(email); state.account.otpSent = true; state.account.status = "確認コードをメールに送りました。";
      state.focusSelector = "[data-account-otp]";
    }
  } catch {
    state.account.error = state.account.otpSent ? "確認コードが正しくないか、有効期限が切れています。" : "確認コードを送れませんでした。"; }
  finally { state.account.busy = false; render(); }
}
async function saveProfile() {
  if (state.account.busy || !state.account.user || !validDisplayName(state.account.profileDraft)) return;
  const generation = state.account.generation; const revision = ++state.account.profileRevision; const value = state.account.profileDraft.trim();
  state.account.busy = true; state.account.error = "";
  state.account.status = ""; render();
  try { const result = await accountApi.updateProfile(value); if (generation !== state.account.generation || revision !== state.account.profileRevision) return; const user = result.user || {}; state.account.user = normalizeAccountUser({ ...state.account.user, ...user }, state.account.user); state.account.profileDraft = state.account.user.displayName || "";
    syncAccountParticipantName();
    state.account.status = "表示名を保存しました。"; }
  catch { if (generation === state.account.generation && revision === state.account.profileRevision) state.account.error = "表示名を保存できませんでした。"; }
  finally { if (generation === state.account.generation) { state.account.busy = false; render(); } }
}
function validCustomText(value) { return typeof value === "string" && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value) && Array.from(value.trim()).length >= 1 && Array.from(value.trim()).length <= 300; }
async function saveStudioDraft() {
  if (state.account.busy) return;
  const name = String(state.account.setName || '').trim();
  const items = state.account.studioItems.map((item) => ({ ...item }));
  const invalidItem = items.find((item) => item.kind === 'custom' && !validCustomText(item.text));
  if (invalidItem) { state.account.error = '空欄の質問を入力するか、質問を外してください。'; render(); return; }
  if (!name || items.length > 40) { state.account.error = 'セット名とカード数（0〜40枚）を確認してください。'; render(); return; }
  const generation = state.account.generation; const requestId = ++state.account.studioRequestId; state.account.busy = true; state.account.error = ''; render();
  try {
    const payload = { name, items, audience: state.account.studioAudience || 'group', questionOrder: state.account.studioQuestionOrder || 'shuffle', r18: state.account.studioR18 === true, design: normalizeCreatorDesign(state.account.studioDesign), ...(!state.account.editingDraftId && state.account.editingSetId ? { sourceSetId: state.account.editingSetId } : {}) };
    const result = state.account.editingDraftId ? await accountApi.updateDraft(state.account.editingDraftId, payload) : await accountApi.createDraft(payload);
    if (generation !== state.account.generation || requestId !== state.account.studioRequestId) return;
    const row = result.draft || result;
    state.account.drafts = state.account.editingDraftId ? state.account.drafts.map((draft) => draft.id === row.id ? row : draft) : [...state.account.drafts, row];
    state.account.editingDraftId = row.id || state.account.editingDraftId;
    if (items.length >= 6 && state.account.completionAvailable !== false) {
      const completed = await accountApi.completeDraft(row.id);
      if (generation !== state.account.generation || requestId !== state.account.studioRequestId) return;
      const ready = completed.set || completed;
      if (ready?.id) state.account.sets = [...state.account.sets.filter((set) => set.id !== ready.id), ready];
      state.account.drafts = state.account.drafts.filter((draft) => draft.id !== row.id);
      state.account.status = 'セットを保存しました。';
      state.account.editingDraftId = null;
      await loadAccount();
      if (generation !== state.account.generation || requestId !== state.account.studioRequestId) return;
    } else state.account.status = '下書きを保存しました。6枚以上で遊べます。';
    state.account.studioMode = 'list'; state.account.editingSetId = null; state.account.setName = undefined; state.account.selectedCards = new Set(); state.account.studioItems = [];
  } catch (error) { if (generation === state.account.generation && requestId === state.account.studioRequestId) state.account.error = error?.status === 404 ? '下書き機能を利用できません。' : 'セットを保存できませんでした。'; }
  finally { if (generation === state.account.generation && requestId === state.account.studioRequestId) { state.account.busy = false; render(); } }
}
async function generateStudioQuestions() {
  if (state.account.busy || state.account.aiGenerationAvailable !== true) return;
  state.account.busy = true; state.account.error = ''; render(); const generation = state.account.generation; const requestId = ++state.account.studioRequestId;
  try { const result = await accountApi.generateAiQuestions({ theme: (state.account.aiTheme || '').trim(), tone: (state.account.aiTone || '').trim() || '自然であたたかい', count: state.account.aiCount === 12 ? 12 : 6, r18: state.account.aiR18 === true && ageConfirmed() && r18DisplayVisible() }); if (generation !== state.account.generation || requestId !== state.account.studioRequestId) return; state.account.aiName = typeof result.name === 'string' ? result.name.trim() : ''; state.account.aiQuestions = (result.questions || []).map((question) => ({ text: question.text || '', r18: question.r18 === true, selected: true })); state.account.status = ''; }
  catch (error) { if (generation === state.account.generation && requestId === state.account.studioRequestId) state.account.error = error?.status === 404 ? 'AIセット作成は現在利用できません。' : adultErrorMessage(error, 'AI案を作成できませんでした。'); }
  finally { if (generation === state.account.generation && requestId === state.account.studioRequestId) { state.account.busy = false; render(); } }
}
async function adoptStudioQuestions() {
  if (state.account.busy) return;
  if (state.account.aiQuestions.some((question) => question.selected !== false && question.r18 === true) && !r18DisplayVisible()) { state.account.error = "R18の質問を採用するには「R18を表示する」を選んでください。"; render(); return; }
  const selected = state.account.aiQuestions.filter((question) => question.selected !== false && typeof question.text === 'string' && question.text.trim());
  if (!selected.length) return;
  const generation = state.account.generation; state.account.busy = true; state.account.error = ''; render();
  try { if (generation !== state.account.generation) return; const invalid = state.account.aiQuestions.find((question) => question.selected !== false && !validCustomText(question.text)); if (invalid) { state.account.error = '空欄の質問を入力するか、選択を外してください。'; return; } if (!state.account.setName && state.account.aiName) state.account.setName = state.account.aiName; if (state.account.studioItems.length + selected.length > 40) { state.account.error = '質問は40枚まで追加できます。'; return; } state.account.studioItems.push(...selected.map((question) => ({ kind: 'custom', text: question.text.trim(), r18: question.r18 === true, origin: 'ai' }))); state.account.studioMode = 'editor'; state.account.aiQuestions = []; state.account.status = 'AI案をセットに追加しました。保存時に質問カードとして登録します。'; }
  catch (error) { if (generation === state.account.generation) state.account.error = 'AI案を保存できませんでした。'; }
  finally { if (generation === state.account.generation) { state.account.busy = false; render(); } }
}async function saveCustomCard() {
  if (state.account.busy || !state.account.customCardsAvailable) return;
  if (!validCustomText(state.account.customDraft)) { state.account.error = "質問は1〜300文字で、改行せずに入力してください。";
    state.account.status = ""; render(); return; }
  const generation = state.account.generation; const id = state.account.editingCardId; const text = state.account.customDraft.trim(); const r18 = state.account.customDraftR18 === true && ageConfirmed() && r18DisplayVisible();
  state.account.busy = true; state.account.error = "";
  state.account.status = ""; render();
  try {
    const result = id ? await accountApi.updateCard(id, text, r18) : await accountApi.createCard(text, r18);
    if (generation !== state.account.generation) return;
    const card = result.card || result;
    const normalized = { ...card, id: typeof card.id === "string" && card.id.startsWith("custom:") ? card.id : `custom:${card.id}`,
      r18: card.r18 === true,
    };
    state.account.customCards = id ? state.account.customCards.map((item) => (item.id === id ? normalized : item)) : [...state.account.customCards, normalized];
    state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = "";
    state.account.customDraftR18 = false;
    state.account.status = "質問カードを保存しました。";
  } catch (error) {
    if (generation === state.account.generation) state.account.error = adultErrorMessage(error, "質問カードを保存できませんでした。"); }
  finally { if (generation === state.account.generation) { state.account.busy = false; render(); } }
}
async function deleteAccount() {
  if (state.account.busy || state.account.avatarBusy || !state.account.deletionAvailable || !state.account.deleteConfirmed) return;
  const requestUserId = state.account.user?.id || null;
  clearAccountShare({ close: true });
  state.shareStatus = "";
  state.shareMenuOpen = false; state.shareFallbackText = "";
  state.sharedRequestId += 1;
  state.shared = null;
  state.sharedLoading = false;
  const generation = ++state.account.generation; state.account.busy = true; state.account.error = ""; render();
  try {
    await accountApi.deleteAccount();
    if (generation !== state.account.generation && state.account.user?.id && state.account.user.id !== requestUserId) return;
    try {
      await accountApi.logout({ scope: "local" });
    } catch {
      /* server deletion succeeded; local SDK cleanup is best effort */
    }
    if (state.account.user?.id && state.account.user.id !== requestUserId) return;
    clearSession();
    state.session = null;
    state.resume = null;
    state.feedback = null;
    state.feedbackBusy = false;
    state.pendingCustomResume = null;
    state.account.user = null;
    state.soloHistory = []; state.soloHistoryCursor = null; state.soloHistoryEditing = null; state.soloHistoryOpen = false;
    state.account.ageConfirmedAt = null; state.account.adultConfirmationAvailable = false; state.account.ageRevokeOpen = false; state.account.ageConfirmChecked = false;
    state.account.favorites = new Set();
    state.account.customCards = []; state.account.drafts = []; state.account.draftsAvailable = false; state.account.completionAvailable = false; state.account.studioRequestId += 1; state.account.studioItems = []; state.account.aiTheme = ""; state.account.aiTone = ""; state.account.aiR18 = false; state.account.studioMode = "list"; state.account.editingDraftId = null; state.account.aiQuestions = [];
    state.account.customCardsAvailable = false;
    state.account.sets = [];
    state.account.selectedCards = new Set();
    state.account.editingSetId = null;
    state.account.setName = undefined;
    state.account.customEditorOpen = false;
    state.account.editingCardId = null;
    state.account.customDraft = "";
    state.account.customDraftR18 = false;
    state.account.pendingSet = null;
    state.account.profileDraft = "";
    state.account.avatarUrl = "";
    state.account.avatarDraft = "";
    state.account.avatarBusy = false;
    state.account.avatarError = "";
    state.account.deletionAvailable = false;
    state.account.status = "";
    state.account.error = "";
    state.account.otpSent = false;
    state.account.otp = ""; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.account.deleteConfirmed = false; state.account.busy = false; state.account.profileRevision += 1; state.account.email = "";
    state.account.revealAdult = false; state.account.r18DisplayEnabled = false;
    state.participantNameOrigin = null;
    state.participantNameAutoValue = "";
    state.participantNameUserEdited = false;
    state.participants = ["", ""];
    state.screen = "participants";
    state.error = ""; render();
  } catch { if (generation === state.account.generation) { state.account.busy = false; state.account.error = "退会処理の結果を確認できませんでした。しばらくしてからアカウントの状態を確認してください。"; render(); } }
}
function playSavedSet(set) {
  const ids = (Array.isArray(set?.card_ids) ? set.card_ids : Array.isArray(set?.cards) ? set.cards.map((entry) => entry.cardId || entry.card_id || entry) : []).filter((id) => typeof id === "string");
  const explicitR18 = set?.r18 === true || set?.theme_r18 === true;
  const hasR18 = explicitR18 || set?.effectiveR18 === true || ids.some((id) => canonicalCard(id, state.account.customCards)?.r18 === true);
  if (hasR18 && (!ageConfirmed() || !r18DisplayVisible())) { state.account.pendingSet = null; state.error = !ageConfirmed() ? "R18を含むセットは、アカウント設定で18歳以上の確認をすると遊べます。" : "R18を表示するを選んでから遊べます。"; state.account.error = state.error; render(); return; }
  if (hasR18 && !state.account.pendingSet?.consented) { state.account.pendingSet = { set, consented: false }; state.account.open = true; state.account.libraryOpen = true; state.account.error = ""; render(); return; }
  const solo = set?.audience === 'solo' || (set?.audience === 'both' && state.themeMode === 'solo');
  const soloName = state.participants.length === 1 && String(state.participants[0] || '').trim() ? String(state.participants[0]).trim() : '自分';
  if (solo) { if (state.participants.length >= 2) state.groupParticipants = [...state.participants]; state.participants = [soloName]; state.themeMode = 'solo'; }
  else { if (state.themeMode === 'solo' || state.participants.length < 2) state.participants = state.groupParticipants?.length >= 2 ? [...state.groupParticipants] : ['', '']; else state.groupParticipants = [...state.participants]; state.themeMode = 'single'; }
  state.session = createSavedSession({ mode: solo ? 'solo' : 'group', participants: solo ? [soloName] : state.participants, participant: soloName, cardIds: ids, setId: set?.id || null, setName: set?.name || 'マイセット', customCards: state.account.customCards, ownerUserId: state.account.user?.id || null, adultConfirmed: state.account.pendingSet?.consented === true, questionOrder: set?.questionOrder || set?.question_order || 'shuffle', r18: explicitR18, design: set?.design, participantRule: solo ? 'solo' : participantRuleForSavedSet(set, 'group'),
  });
  state.session.setName = set?.name || "マイセット";
  state.account.pendingSet = null;
  state.account.open = false;
  state.account.status = "";
  state.account.error = ""; state.account.selectedCards = new Set(); state.account.editingSetId = null; state.account.setName = undefined; state.account.revealAdult = false; state.feedback = null; state.feedbackBusy = false; state.resume = null; state.soloMemoOpen = false; state.screen = "play";
  state.error = "";
  trackThemeStart("my-set");
  recordThemeExplorerStart({ ownerId: state.account.user?.id, mode: solo ? "solo" : "group", themeIds: [set?.id || state.session?.deckId].filter(Boolean) });
  saveCurrentSession(state.session);
  render();
}
async function startSharedSet() {
  const shared = state.shared;
  const venueMode = Boolean(state.venue);
  if (!shared || state.busy || state.sharedLoading) return;
  let participants;
  try {
    participants = normalizeParticipants(state.participants.map((name, index) => venueMode ? (String(name || "").trim() || `参加者${index + 1}`) : String(name)));
  } catch (error) {
    state.error = error.message || "呼び名を確認してください。";
    render();
    return;
  }
  const adultConfirmed = state.adultConfirmed === true;
  if (!venueMode && sharedBlocked()) {
    state.error = AGE_REQUIRED_MESSAGE;
    render();
    return;
  }
  if (venueMode && shared.adultOnly === true && state.venue.ageTapped !== true) {
    state.error = "18歳以上であることの確認が必要です。";
    render();
    return;
  }
  if (shared.adultOnly === true && ((venueMode && state.venue.displayR18 !== true) || (!venueMode && !r18DisplayVisible()))) {
    state.error = "R18を表示するを選んでから開始してください。";
    render();
    return;
  }
  if (shared.adultOnly === true && !adultConfirmed) {
    state.error = "R18の話題には参加者全員の同意が必要です。";
    render();
    return;
  }
  const requestId = state.sharedRequestId;
  const token = shared.token;
  state.busy = true;
  state.error = "";
  render();
  try {
    const result = venueMode ? await accountApi.startVenue(token, state.selectedVenueSetId, participants, adultConfirmed, state.venue?.ageTapped === true) : await accountApi.startSharedSet(token, participants, adultConfirmed);
    if (shared.adultOnly === true && ((venueMode && state.venue?.displayR18 !== true) || (!venueMode && !r18DisplayVisible()))) { state.busy = false; state.error = "R18を表示するを選んでから開始してください。"; render(); return; }
    const cards = Array.isArray(result.cards) ? result.cards : [];
    const customCards = cards.filter((card) => card.id?.startsWith("custom:"));
    if (requestId !== state.sharedRequestId || !state.shared || state.shared.token !== token) {
      state.busy = false;
      return;
    }
    const sharedName = venueMode ? (result.set?.name || state.venue.venue.name) : (shared.name || result.share?.name || "共有セット");
    state.feedback = null;
    state.feedbackBusy = false;
    state.roundFavorite = null;
    state.roundLikeKey = null;
    state.roundLikeExpanded = false;
    state.shareStatus = "";
    state.shareMenuOpen = false; state.shareFallbackText = "";
    const sharedParticipantRule = shared.participantRule === 'pair' || participantRuleForDeck(shared) === 'pair' || cards.some((card) => participantRuleForDeck(card) === 'pair') ? 'pair' : 'group';
    const session = createSharedSession({
      participants: result.participants || participants,
      cards,
      customCards,
      adultConfirmed,
      questionOrder: result.share?.questionOrder || shared.questionOrder || 'shuffle',
      r18: result.set?.adultOnly === true || result.share?.adultOnly === true || shared.adultOnly === true,
      design: result.set?.design || result.share?.design || shared.design,
      participantRule: sharedParticipantRule,
    });
    session.setName = sharedName;
    if (venueMode) { session.venueSession = result.session; session.venueSetId = state.selectedVenueSetId; session.sharedGuest = true; }
    state.participants = session.participants;
    state.session = session;
    state.resume = null;
    state.shared = null;
    if (location.search.includes("share=") || location.search.includes("venue=")) history.replaceState({}, "", `${location.pathname}${location.hash}`);
    state.busy = false;
    state.screen = "play";
    state.error = "";
    trackThemeStart("shared-set");
    recordThemeExplorerStart({ ownerId: state.account.user?.id, mode: "group", themeIds: [session?.setId || shared?.setId || "shared-set"] });
    render();
  } catch (error) {
    if (requestId !== state.sharedRequestId) return;
    if (error?.status === 401 && shared.adultOnly === true && !venueMode && state.account.enabled) { state.account.open = true; state.account.status = "R18の共有セットは、ログインして18歳以上の確認をしたアカウントで遊べます。"; state.focusSelector = "[data-account-email]"; state.error = "ログインまたは新規登録してください。"; }
    else state.error = adultErrorMessage(error, error?.status === 403 ? "R18の話題には参加者全員の同意が必要です。" : "共有セットを開始できませんでした。リンクが停止された可能性があります。");
    state.busy = false;
    render();
  }
}
function submitParticipants() {
  const validationError = homeParticipantValidationError(state.participants);
  if (validationError) {
    state.error = validationError;
    const invalidIndex = state.participants.findIndex((name) => typeof name !== "string" || !name.trim() || Array.from(name.trim()).length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/u.test(name.trim()));
    state.focusSelector = `input[data-index="${Math.max(0, invalidIndex)}"]`;
    render();
    return;
  }
  try {
    if (state.participants.length === 1) {
      const name = String(state.participants[0] || "").trim() || "自分";
      if (Array.from(name).length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error("呼び名を確認してください。");
      state.participants = [name];
    } else state.participants = normalizeParticipants(state.participants);
    const nextThemeMode = state.participants.length === 1 ? "solo" : state.themeMode === "mixed" ? "mixed" : "single";
    const modeChanged = state.themeMode !== nextThemeMode;
    state.themeMode = nextThemeMode;
    state.participantTab = nextThemeMode === "solo" ? "solo" : "group";
    if (modeChanged || !state.selectedDeckIds?.length) {
      state.themeExplorerShelf = "all";
      state.selectedMySetId = null;
      state.selectedDeckId = nextThemeMode === "solo" ? "self-values" : "friends";
      state.selectedDeckIds = [state.selectedDeckId];
    }
    state.screen = "decks";
    state.error = ""; render(); } catch (error) { state.error = error.message; const invalidIndex = state.participants.findIndex((name) => typeof name !== "string" || !name.trim() || Array.from(name.trim()).length > MAX_NAME_LENGTH); state.focusSelector = `input[data-index="${Math.max(0, invalidIndex)}"]`; render(); } }
function groupRoomArgs(deck, mySet) { return { deckId: deck?.id, adultOnly: deck?.adultOnly === true, setId: mySet?.id || null, setHasR18: mySet?.hasR18 === true, offerR18: canOfferR18(deck), adultConfirmed: state.adultConfirmed, plannedParticipantCount: state.participants.length }; }
function updateGroupLink() {
  const link = root.querySelector(".group-room-link"); if (!link) return;
  const mySet = playableSavedSets(state.account.sets, state.account.customCards).find((set) => set.id === state.selectedMySetId && (!set.hasR18 || ageConfirmed())) || null;
  link.setAttribute("href", groupRoomHref(groupRoomArgs(decks.find((deck) => deck.id === state.selectedDeckId && canUseDeck(deck)) ?? decks.find((deck) => canUseDeck(deck)) ?? decks[0], mySet)));
}

function soloRoundView(session) {
  const totalCards = session.questions.length;
  const isFinal = session.cursor >= totalCards;
  const start = Math.max(0, session.roundStart ?? session.cursor);
  const seen = new Set(Array.isArray(session.revealedQuestionIds) ? session.revealedQuestionIds : []);
  const seenCards = session.questions.slice(start, Math.min(session.cursor, totalCards)).filter((card) => seen.has(card.id));
  const seenMarkup = seenCards.length ? `<details class="solo-seen-questions"><summary>このラウンドで見た質問（${seenCards.length}）</summary><ul>${seenCards.map((card) => `<li>${esc(card.text)}</li>`).join("")}</ul></details>` : "";
  const accountOverlay = (state.account.open ? accountView({ overlayOnly: true }) : "") + (state.venue?.displayR18 === true && state.session?.venueSession && sessionHasR18(state.session) ? `<label class="adult-consent venue-play-toggle"><input type="checkbox" data-venue-play-r18 checked> <span>R18を表示する</span></label>` : "");
  return frame(`<div class="round-break solo-round-break"><span class="round-badge">${session.cursor} / ${totalCards}</span><h1 tabindex="-1" data-focus>${isFinal ? "振り返りを終えました" : "ここまでの振り返り"}</h1>${roundThemeLikeView(session)}<div class="break-actions">${!isFinal ? `<button class="primary-button" data-action="continue" ${state.busy ? "disabled" : ""}>${state.busy ? "確認中…" : `${actionIcon("right")}つづける`}</button>` : ""}<button class="secondary-button" data-action="finish" aria-label="プレイを終わる" title="終わる">${actionIcon("stop")}終わる</button></div>${seenMarkup}<p class="form-error" role="alert">${esc(state.error)}</p><button class="back-link" data-action="decks" aria-label="テーマを変更" title="テーマを変更">▦ テーマ</button></div>${accountOverlay}`);
}
function updateAdultButton() { updateGroupLink(); if (state.themeMode === "mixed") return;
  const button = root.querySelector(".selected-start"); const selected = decks.find((deck) => deck.id === state.selectedDeckId); const selectedMySet = playableSavedSets(state.account.sets, state.account.customCards).find((set) => set.id === state.selectedMySetId); const requiresAdultConsent = selectedMySet ? selectedMySet.hasR18 === true : selected?.adultOnly === true; if (button && requiresAdultConsent) button.disabled = !state.adultConfirmed || state.busy; }
function ensureSession() { if (!state.session) throw new Error("セッションが始まっていません");
  return state.session;
}
function saveCurrentSession(session) {
  if (session?.sharedGuest) return;
  saveSession(session); }
function persist(previous = null) { if (!state.session) return; if (previous) trackSessionProgress(previous, state.session); if (state.session.sharedGuest) return;
  if (state.session.cursor >= state.session.questions.length) clearSession();
  else saveCurrentSession(state.session); }
function advanceGuarded(action) { ensureSession(); const now = Date.now(); if (now - state.lastAdvanceAt < 300) return false; state.lastAdvanceAt = now; const previous = state.session; state.busy = true; render(); state.session = action(state.session); if (previous?.mode === "solo") { state.soloMemoOpen = false; state.soloMemoKey = ""; } state.busy = false; persist(previous); if (isActiveVenueSession() && previous.cursor < state.session.cursor && state.session.cursor > 0 && state.session.cursor % ROUND_SIZE === 0) accountApi.venueEvent(state.venue.token, { eventType: "completed_round", setId: state.session.venueSetId, session: state.session.venueSession, roundIndex: state.session.cursor / ROUND_SIZE }).catch(() => {}); render(); return true; }
function resumeSaved(snapshot = null) { const fresh = snapshot || loadResumeForCurrentUser(); if (!fresh) { state.resume = null; state.error = "保存期限が切れています。"; render(); return; } if (!canAccessSessionContent(fresh, state.account, { activeVenue: isActiveVenueSession(fresh), venueDisplay: state.venue?.displayR18 === true })) { state.error = state.account.authReady ? "続きを再開できません。" : "ログイン状態を確認しています。少し待ってからお試しください。"; render(); return; } const needsAuth = fresh.cursor >= 6 && fresh.unlockedUntil > 6; const lockedTheme = sessionNeedsRegistration(fresh); if ((needsAuth || lockedTheme) && !state.account.authReady) { state.resume = fresh; state.error = "ログイン状態を確認しています。少し待ってからお試しください。"; render(); return; } if ((needsAuth || lockedTheme) && !state.account.user) { state.resume = fresh; if (!state.account.enabled) { state.error = "ログイン設定を利用できないため、続きを再開できません。"; render(); return; } state.continuePending = { kind: "resume", sessionId: fresh.sessionId, snapshot: fresh }; state.account.open = true; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.account.error = ""; state.account.status = lockedTheme ? "このテーマは無料登録で使えます。ログインまたは新規登録してください。" : "ログインまたは新規登録で、続きを無料で楽しめます。"; state.focusSelector = "[data-account-email]"; render(); return; } state.resume = fresh; state.session = fresh; state.participantNameOrigin = null; state.participantNameAutoValue = ""; state.participantNameUserEdited = true; state.participants = [...state.session.participants]; state.selectedDeckIds = [...(state.session.deckIds || [state.session.deckId])]; state.selectedDeckId = state.session.mixed ? state.selectedDeckIds[0] : state.session.deckId; state.themeMode = state.session.mixed ? "mixed" : "single"; state.includeChallenges = state.session.includeChallenges === true; state.adultConfirmed = state.session.adultConfirmed === true; state.screen = "play";
  state.resume = null;
  state.error = ""; render(); }

function isCurrentRoundFavorite(context, session, key) { return Boolean(context && session && state.roundFavorite === context && context.key === key && context.sessionId === session.sessionId && context.roundStart === session.roundStart && context.cursor === session.cursor); }

async function saveRoundFavorites() {
  const context = state.roundFavorite;
  const session = state.session;
  if (!context || context.saving || !session || !isCurrentRoundFavorite(context, session, context.key) || !state.account.user) return;
  const ids = [...context.selected].filter((id) => !state.account.favorites.has(id));
  if (!ids.length) return;
  const key = context.key;
  const generation = state.account.generation;
  const sessionId = session.sessionId;
  const roundStart = session.roundStart;
  const cursor = session.cursor;
  const cards = new Map(context.cards.map((card) => [card.id, card]));
  context.saving = true;
  context.error = "";
  render();
  try {
    for (const id of ids) {
      const current = state.roundFavorite;
      if (!isCurrentRoundFavorite(context, state.session, key) || state.account.generation !== generation || !state.account.user) return;
      const card = cards.get(id);
      if (!card) { current.selected.delete(id); continue; }
      try {
        await accountApi.favorite(cardPayload(card, session.mixed ? card.sourceDeckId : session.deckId), true);
      } catch {
        if (isCurrentRoundFavorite(context, state.session, key) && state.account.generation === generation) context.error = "保存できなかった質問があります。もう一度保存してください。";
        break;
      }
      if (!isCurrentRoundFavorite(context, state.session, key) || state.account.generation !== generation || !state.account.user || state.session.roundStart !== roundStart || state.session.cursor !== cursor) return;
      state.account.favorites.add(id);
      state.roundFavorite.selected.delete(id);
      render();
    }
  } finally {
    if (isCurrentRoundFavorite(context, state.session, key) && state.account.generation === generation && state.session.roundStart === roundStart && state.session.cursor === cursor) {
      state.roundFavorite.saving = false;
      render();
    }
  }
}
function clearAccountShare({ close = true } = {}) {
  state.account.shareRequestId += 1;
  state.account.shareBusy = false;
  state.account.qrBusy = false;
  state.account.qrError = "";
  state.account.share = null;
  state.account.shareOpen = close ? false : state.account.shareOpen;
  state.account.status = "";
  state.account.error = "";
}
function isContinuePendingCurrent() {
  const pending = state.continuePending;
  const session = state.session;
  return Boolean(pending && pending.kind !== "resume" && session && pending.sessionId === session.sessionId && pending.roundStart === session.roundStart && pending.cursor === session.cursor && state.screen === "play");
}
async function continueCurrentRound() {
  if (!isActiveVenueSession(state.session) && !(await canContinue(state.session, state.account))) { state.error = "ログインしてから続きを始めてください。"; render(); return; }
  state.continuePending = null;
  state.shareMenuOpen = false;
  state.shareStatus = "";
  state.shareFallbackText = "";
  state.roundFavorite = null; state.roundLikeKey = null; state.roundLikeExpanded = false; state.feedbackBusy = false; state.feedback = null; state.busy = true; state.error = ""; render();
  try {
    const previous = ensureSession();
    state.session = continueRound(state.session); persist(previous);
  } catch (error) {
    state.error = error.message || "続きを始められませんでした。";
  } finally {
    state.busy = false;
    render();
  }
}
async function confirmAge() {
  if (state.account.ageBusy || !state.account.user || state.account.ageConfirmedAt || !state.account.ageConfirmChecked) return;
  const generation = state.account.generation;
  state.account.ageBusy = true; state.account.error = ""; state.account.status = ""; render();
  try {
    const result = await accountApi.confirmAdult("settings");
    if (generation !== state.account.generation) return;
    if (typeof result?.adultConfirmedAt !== "string" || !result.adultConfirmedAt) throw new Error("age_confirmation_failed");
    state.account.ageConfirmedAt = result.adultConfirmedAt; state.account.adultConfirmationAvailable = true; state.account.ageConfirmChecked = false;
    state.account.status = "年齢の確認を保存しました。";
    if (!state.venue && state.shared?.ageConfirmationRequired === true) refreshSharedAfterAccountChange();
  } catch (error) { if (generation === state.account.generation) state.account.error = error?.message === "FEATURE_UNAVAILABLE" ? "年齢の確認は現在利用できません。" : "年齢の確認を保存できませんでした。"; }
  finally { if (generation === state.account.generation) { state.account.ageBusy = false; render(); } }
}
async function revokeAge() {
  if (state.account.ageBusy || !state.account.user || !state.account.ageConfirmedAt) return;
  const generation = state.account.generation;
  state.account.ageBusy = true; state.account.error = ""; state.account.status = ""; render();
  try {
    await accountApi.revokeAdult();
    if (generation !== state.account.generation) return;
    state.account.ageConfirmedAt = null; state.account.ageRevokeOpen = false; state.account.ageConfirmChecked = false;
    clearAccountShare({ close: true });
    state.account.libraryOpen = false;
    clearR18Visible(state.account, r18Storage()); state.account.r18DisplayHydrated = false; state.account.revealAdult = false; state.account.aiR18 = false; state.account.customDraftR18 = false; state.account.pendingSet = null;
    state.account.aiQuestions = state.account.aiQuestions.filter((question) => question.r18 !== true);
    purgeAdultSessions();
    state.account.status = "年齢の確認を取り消しました。";
  } catch { if (generation === state.account.generation) state.account.error = "確認を取り消せませんでした。"; }
  finally { if (generation === state.account.generation) { state.account.ageBusy = false; render(); } }
}
function restoreGroupHomeState() {
  const restoreStored = state.themeMode === "solo" || state.participants.length < 2;
  if (restoreStored) state.participants = state.groupParticipants?.length >= 2 ? [...state.groupParticipants] : ["", ""];
  else state.groupParticipants = [...state.participants];
  state.themeMode = "single"; state.participantTab = "group"; state.selectedDeckId = "friends"; state.selectedDeckIds = ["friends"]; state.selectedMySetId = null; state.session = null;
}
function launchSocialGame(game) {
  if (!game?.href) return;
  const gate = gameParticipantGate(game, state.participants.length);
  if (!gate.valid) {
    state.error = `「${game.title}」は${gate.label}。`; render(); return;
  }
  let names = state.participants.map((name, index) => {
    const trimmed = String(name || '').trim();
    return state.venue && !trimmed ? `参加者${index + 1}` : trimmed;
  });
  try { names = normalizeParticipants(names); }
  catch { state.error = 'ゲームを始める前に、参加者の呼び名を入力してください。'; render(); return; }
  const venueToken = state.venue?.token || '';
  if (!saveSocialGameIntent({ gameId: game.id, names, venueToken })) {
    state.error = 'ゲームを開始できませんでした。もう一度お試しください。'; render(); return;
  }
  location.assign(game.href);
}
async function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  if (action === "audio-toggle") { event.stopPropagation(); state.focusAction = "audio-toggle"; toggleCardAudio(); render(); return; }
  if (action === "theme-bookmark") { event.stopPropagation(); const id = event.currentTarget.dataset.bookmarkId; toggleThemeExplorerBookmark(id, state.account.user?.id); state.focusSelector = `[data-action="theme-bookmark"][data-bookmark-id="${CSS.escape(id)}"]`; render(); return; }
  if (action === "theme-experienced") { event.stopPropagation(); const id = event.currentTarget.dataset.experiencedId; toggleThemeExplorerExperienced(id, state.account.user?.id); state.focusSelector = `[data-action="theme-experienced"][data-experienced-id="${CSS.escape(id)}"]`; render(); return; }
  if (action === "game-launch") {
    const game = groupGames.find((item) => item.id === event.currentTarget.dataset.gameId);
    const gate = gameParticipantGate(game, state.participants.length);
    if (!game || !gate.valid) {
      if (game) state.error = `「${game.title}」は${gate.label}。`;
      render();
      return;
    }
    if (game?.id === 'match' || game?.id === 'choice') launchSocialGame(game);
    else if (game?.href) {
      const href = new URL(game.href, location.href);
      if (state.venue?.token) href.searchParams.set('venue', state.venue.token);
      location.assign(`${href.pathname}${href.search}${href.hash}`);
    }
    return;
  }
  if (state.busy && action !== "continue" && action !== "home") return;
  state.focusAction = action;
  if (action === "theme-select") {
    const id = event.currentTarget.dataset.themeId;
    const selectedDeck = state.themeMode === "solo" ? soloDecks.find((item) => item.id === id) : decks.find((item) => item.id === id);
    if (state.themeMode === "solo") {
      if (soloDecks.some((deck) => deck.id === id)) { state.selectedDeckId = id; state.selectedDeckIds = [id]; state.selectedMySetId = null; }
    } else {
      const deck = decks.find((item) => item.id === id);
      if (!deck || (state.themeMode === "mixed" && deck.adultOnly)) return;
      if (state.themeMode === "mixed") {
        const selected = new Set(state.selectedDeckIds);
        if (selected.has(id)) selected.delete(id);
        else if (selected.size < 3) selected.add(id);
        else { state.error = "テーマミックスは3テーマまでです。"; state.focusSelector = `[data-theme-key="${event.currentTarget.dataset.themeKey}"]`; render(); return; }
        state.selectedDeckIds = [...selected];
        state.selectedDeckId = state.selectedDeckIds[0] || id;
      } else { state.selectedDeckId = id; state.selectedDeckIds = [id]; state.selectedMySetId = null; state.participantTab = participantRuleForDeck(deck) === 'pair' ? 'pair' : 'group'; }
    }
    state.adultConfirmed = false; state.themeOptionsOpen = state.themeMode !== "mixed" && Boolean(selectedDeck?.adultOnly); state.error = ""; state.focusSelector = `[data-theme-key="${event.currentTarget.dataset.themeKey}"]`; render(); return;
  }
  if (action === "reveal") { playFlipSound(); const previous = ensureSession(); state.session = revealCard(previous); persist(previous); render(); return; }
  if (action === "home") {
    const keepSoloHome = state.themeMode === "solo" && !state.venue && !state.shared;
    state.continuePending = null;
    state.sharedRequestId += 1;
    state.shared = null;
    state.venue = null;
    state.selectedVenueSetId = null;
    state.sharedLoading = false;
    state.busy = false;
    if (location.search.includes("share=") || location.search.includes("venue=")) history.replaceState({}, "", `${location.pathname}${location.hash}`);
    state.adultConfirmed = false;
    state.roundFavorite = null; state.roundLikeKey = null; state.roundLikeExpanded = false; state.feedbackBusy = false; state.feedback = null;
    state.shareStatus = "";
    state.shareMenuOpen = false; state.shareFallbackText = "";
    if (state.session && !isFinished(state.session)) saveCurrentSession(state.session);
    restoreGroupHomeState();
    if (keepSoloHome) { state.themeMode = "solo"; state.selectedDeckId = "self-values"; state.selectedDeckIds = ["self-values"]; state.selectedMySetId = null; }
    state.resume = loadResumeForCurrentUser();
    state.screen = "participants";
    state.error = ""; state.includeChallenges = false; state.adultConfirmed = false; render(); return; }
  if (action === "account") { state.account.returnAfterAuth = event.currentTarget.dataset.authReturn === "true"; state.account.open = true; state.account.libraryOpen = false; state.focusAction = state.account.user ? "account-library-open" : "account-close";
    render();
    return;
  }
  if (action === "reset-otp") { if (state.account.busy) return; state.account.otpSent = false; state.account.otp = "";
    state.account.status = "";
    state.account.error = "";
    render();
    return;
  }
  if (action === "google-login") {
    try {
      saveAuthReturnIntent();
      saveAdultIntent();
      await accountApi.google();
    } catch {
      state.account.error = "Googleログインを開始できませんでした。";
      render();
    }
    return;
  }
  if (action === "account-close") {
    if (state.account.busy) return;
    state.continuePending = null;
    state.account.profileRevision += 1;
    state.account.avatarRevision += 1;
    state.account.avatarDraft = "";
    state.account.avatarError = "";
    if (state.account.venueOnboarding) clearVenueOnboardingIntent(); if (state.account.libraryReturn) clearLibraryReturnIntent(); clearMinorityAuthIntent(); clearAccountShare({ close: true }); state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.focusAction = "account";
    if (state.account.enabled && !state.account.authReady) loadAccount();
    render();
    return;
  }
  if (action === "avatar-save") {
    await saveAvatar();
    return;
  }
  if (action === "avatar-cancel") {
    if (state.account.avatarBusy) return;
    state.account.avatarRevision += 1;
    state.account.avatarDraft = "";
    state.account.avatarError = "";
    render();
    return;
  }
  if (action === "avatar-remove") {
    await removeAvatar();
    return;
  }
  if (action === "account-settings-open") {
    clearAccountShare();
    state.account.error = "";
    state.account.status = ""; state.account.ageRevokeOpen = false; state.account.ageConfirmChecked = false; state.account.settingsOpen = true; state.account.libraryOpen = false; state.account.deleteOpen = false; state.account.profileDraft = state.account.user?.displayName || "";
    state.focusSelector = "[data-profile-name]";
    render();
    return;
  }
  if (action === "account-settings") {
    if (state.account.busy) return;
    clearAccountShare();
    state.account.settingsOpen = true;
    state.account.deleteOpen = false;
    state.focusSelector = "[data-profile-name]";
    render();
    return;
  }
  if (action === "account-delete-open") { if (!state.account.deletionAvailable || state.account.busy || state.account.avatarBusy) return; state.account.error = "";
    state.account.status = "";
    state.account.deleteOpen = true;
    state.account.deleteConfirmed = false;
    state.focusAction = "account-delete-cancel";
    render();
    return;
  }
  if (action === "account-delete-cancel") { if (state.account.busy) return; state.account.deleteOpen = false; state.account.deleteConfirmed = false; state.account.error = "";
    state.focusAction = "account-delete-open";
    render();
    return;
  }
  if (action === "account-delete-confirm") {
    deleteAccount();
    return;
  }
  if (action === "age-confirm") { confirmAge(); return; }
  if (action === "age-revoke-open") { if (state.account.ageBusy) return; state.account.ageRevokeOpen = true; state.account.error = ""; state.account.status = ""; state.focusAction = "age-revoke-cancel"; render(); return; }
  if (action === "age-revoke-cancel") { if (state.account.ageBusy) return; state.account.ageRevokeOpen = false; state.focusAction = "age-revoke-open"; render(); return; }
  if (action === "age-revoke-confirm") { revokeAge(); return; }
  if (action === "age-settings-open") { if (!state.account.user) return; clearAccountShare(); state.account.open = true; state.account.settingsOpen = true; state.account.libraryOpen = false; state.account.deleteOpen = false; state.account.ageRevokeOpen = false; state.account.ageConfirmChecked = false; state.account.profileDraft = state.account.user?.displayName || ""; state.focusSelector = "[data-age-confirm]"; render(); return; }
  if (action === "account-menu") {
    if (state.account.busy) return;
    resetStudioEntryState(state.account);
    clearAccountShare();
    state.account.avatarRevision += 1;
    state.account.avatarDraft = "";
    state.account.avatarError = "";
    state.account.error = "";
    state.account.status = ""; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.focusAction = "account-settings-open";
    render();
    return;
  }
  if (action === "account-library-open") {
    clearAccountShare();
    resetStudioEntryState(state.account);
    state.account.shareOpen = false;
    state.account.libraryOpen = true;
    state.focusAction = "account-menu";
    render();
    return;
  }
  if (action === "account-overlay-close") {
    state.account.profileRevision += 1;
    state.account.avatarRevision += 1;
    state.account.avatarDraft = "";
    state.account.avatarError = "";
    clearAccountShare({ close: true });
    state.account.open = false;
    state.account.libraryOpen = false;
    state.focusAction = "account";
    render();
    return;
  }
  if (action === "logout") {
    try { sessionStorage.removeItem(AUTH_RETURN_KEY); } catch {} clearLibraryReturnIntent();
    state.continuePending = null;
    clearAccountShare({ close: true });
    state.shareStatus = "";
    state.shareMenuOpen = false; state.shareFallbackText = "";
    state.sharedRequestId += 1;
    state.shared = null;
    state.sharedLoading = false;
    const generation = ++state.account.generation; try { const privateSession = isPrivateCustomSession(state.session) || isPrivateCustomSession(state.resume) || isPrivateCustomSession(state.pendingCustomResume); if (privateSession) { clearSession(); state.session = null; state.resume = null; state.pendingCustomResume = null; if (state.screen === "play") state.screen = "participants"; } await accountApi.logout(); if (generation !== state.account.generation) return; state.account.user = null; state.account.ageConfirmedAt = null; state.account.adultConfirmationAvailable = false; state.account.ageRevokeOpen = false; state.account.ageConfirmChecked = false; purgeAdultSessions(); state.account.favorites = new Set(); state.account.customCards = []; state.account.drafts = []; state.account.draftsAvailable = false; state.account.studioMode = "list"; state.account.editingDraftId = null; state.account.aiQuestions = []; state.account.aiName = ""; state.account.aiR18 = false; state.account.studioReplaceIndex = null; state.account.customCardsAvailable = false; state.account.sets = []; state.account.selectedCards = new Set(); state.account.editingSetId = null; state.account.setName = undefined; state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = "";
      state.account.customDraftR18 = false;
      state.account.pendingSet = null;
      state.account.avatarUrl = "";
      state.account.avatarRevision += 1;
      state.account.avatarDraft = "";
      state.account.avatarBusy = false;
      state.account.avatarError = "";
      clearR18Visible(state.account, r18Storage()); state.account.r18DisplayHydrated = false; state.account.revealAdult = false;
      state.account.status = "";
      state.account.error = "";
      state.account.otpSent = false;
      state.account.otp = ""; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.account.deleteConfirmed = false; state.account.profileRevision += 1; state.account.profileDraft = ""; state.account.deletionAvailable = false; clearAccountParticipantName(); state.feedback = null; state.roundFavorite = null; state.resume = null; render(); } catch { if (generation === state.account.generation) { state.account.error = "ログアウトできませんでした。もう一度お試しください。";
        render();
      }
    }
    return;
  }
  if (action === "custom-card-new") { if (state.account.busy || !state.account.customCardsAvailable) return; state.account.customEditorOpen = true; state.account.editingCardId = null; state.account.customDraft = ""; state.account.customDraftR18 = false; state.account.error = ""; state.focusSelector = '[data-custom-text]'; render(); return; }
  if (action === "custom-card-cancel") { if (state.account.busy) return; state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = "";
    state.account.customDraftR18 = false;
    render();
    return;
  }
  if (action === "custom-card-edit") { if (state.account.busy) return; const id = String(event.currentTarget.dataset.cardId || ""); const card = state.account.customCards.find((item) => item.id === id); if (!card) return; if (card.r18 === true && (!ageConfirmed() || !r18DisplayVisible())) { state.account.error = "R18の質問を編集するには「R18を表示する」を選んでください。"; render(); return; } state.account.customEditorOpen = true; state.account.editingCardId = id; state.account.customDraft = card.text; state.account.customDraftR18 = card.r18 === true; state.focusSelector = "[data-custom-text]";
    render();
    return;
  }
  if (action === "custom-card-delete") { if (state.account.busy) return; const id = String(event.currentTarget.dataset.cardId || ""); const generation = state.account.generation; state.account.busy = true; state.account.error = ""; render(); try { await accountApi.deleteCard(id); if (generation !== state.account.generation) return; state.account.customCards = state.account.customCards.filter((card) => card.id !== id); state.account.selectedCards.delete(id); state.account.status = "質問カードを削除しました。"; } catch (error) { if (generation === state.account.generation) { const names = state.account.sets.filter((set) => Array.isArray(set.card_ids) && set.card_ids.includes(id)).map((set) => (set.hasR18 === true || set.card_ids.some((cardId) => canonicalCard(cardId, state.account.customCards)?.r18 === true)) && !r18DisplayVisible() ? "R18を含むマイセット" : set.name).filter(Boolean); state.account.error = error?.code === "CARD_IN_USE" || error?.message === "CARD_IN_USE" ? `この質問カードは「${names.join("」「") || "マイセット"}」で使用中です。先にセットから外してください。` : "質問カードを削除できませんでした。"; } } finally { if (generation === state.account.generation) { state.account.busy = false; render(); } } return; }
  if (action === "set-share") {
    if (state.account.busy || state.account.shareBusy) return;
    const id = event.currentTarget.dataset.setId;
    const set = state.account.sets.find((item) => item.id === id);
    if (!set) return;
    const generation = state.account.generation;
    const requestId = ++state.account.shareRequestId;
    state.account.shareBusy = true;
    state.account.share = {
      setId: id,
      name: set.name,
      cardCount: Array.isArray(set.card_ids) ? set.card_ids.length : 0,
    };
    state.account.shareOpen = true;
    state.account.libraryOpen = false;
    state.account.error = "";
    render();
    try {
      let result = await accountApi.getSetShare(id);
      if (generation !== state.account.generation || requestId !== state.account.shareRequestId || !state.account.shareOpen) return;
      if (result?.share === null && set.audience !== 'solo') {
        result = await accountApi.createSetShare(id);
      }
      if (generation !== state.account.generation || requestId !== state.account.shareRequestId || !state.account.shareOpen) return;
      if (result?.share === null && set.audience === 'solo') { state.account.share = { setId: id, ...set, audience: 'solo', active: false }; return; }
      if (!result?.share && !result?.token && !result?.url) throw new Error("share_unavailable");
      if (generation !== state.account.generation || requestId !== state.account.shareRequestId) return;
      state.account.share = { setId: id, ...set, ...(result.share || result) };
      if (state.account.share.token) state.account.share.url = `${location.origin}/?share=${encodeURIComponent(state.account.share.token)}`;
      if (state.account.share.url) generateShareQr(state.account.share.url, generation, requestId);
    } catch (error) {
      if (generation === state.account.generation && requestId === state.account.shareRequestId) state.account.error = error?.status === 404 ? "このセットは共有できません。" : adultErrorMessage(error, "共有リンクを発行できませんでした。");
    } finally {
      if (generation === state.account.generation && requestId === state.account.shareRequestId) {
        state.account.shareBusy = false;
        render();
      }
    }
    return;
  }
  if (action === "share-copy") {
    const url = state.account.share?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      state.account.status = "リンクをコピーしました。";
    } catch {
      state.account.error = "リンクをコピーできませんでした。";
    }
    render();
    return;
  }
  if (action === "share-native") {
    const url = state.account.share?.url;
    if (!url) return;
    try {
      if (navigator.share)
        await navigator.share({
          title: state.account.share.adultOnly === true && !r18DisplayVisible() ? "R18を含む共有セット" : (state.account.share.name || "Mingle.Cards"),
          url,
        });
      else await navigator.clipboard.writeText(url);
      state.account.status = navigator.share ? "共有しました。" : "リンクをコピーしました。";
      render();
    } catch (error) {
      if (error?.name !== "AbortError") state.account.error = "共有できませんでした。";
      render();
    }
    return;
  }
  if (action === "share-rotate") {
    const id = state.account.share?.setId;
    if (!id || state.account.shareBusy) return;
    const generation = state.account.generation;
    const requestId = ++state.account.shareRequestId;
    state.account.shareBusy = true;
    state.account.error = "";
    render();
    try {
      const result = await accountApi.rotateSetShare(id);
      if (generation !== state.account.generation || requestId !== state.account.shareRequestId) return;
      state.account.share = {
        ...state.account.share,
        active: true,
        ...(result.share || result),
      };
      if (state.account.share.token) state.account.share.url = `${location.origin}/?share=${encodeURIComponent(state.account.share.token)}`;
      if (state.account.share.url) generateShareQr(state.account.share.url, generation, requestId);
      state.account.status = "新しい共有リンクを発行しました。";
    } catch (error) {
      if (generation === state.account.generation && requestId === state.account.shareRequestId) state.account.error = adultErrorMessage(error, "共有リンクを発行できませんでした。");
    } finally {
      if (generation === state.account.generation && requestId === state.account.shareRequestId) {
        state.account.shareBusy = false;
        if (state.account.shareOpen) render();
      }
    }
    return;
  }
  if (action === "share-stop") {
    const id = state.account.share?.setId;
    if (!id || state.account.shareBusy) return;
    const generation = state.account.generation;
    const requestId = ++state.account.shareRequestId;
    state.account.shareBusy = true;
    render();
    try {
      await accountApi.revokeSetShare(id);
      if (generation !== state.account.generation || requestId !== state.account.shareRequestId) return;
      state.account.share = { ...state.account.share, active: false };
      state.account.status = "";
    } catch {
      if (generation === state.account.generation && requestId === state.account.shareRequestId) state.account.error = "共有を停止できませんでした。";
    } finally {
      if (generation === state.account.generation && requestId === state.account.shareRequestId) {
        state.account.shareBusy = false;
        if (state.account.shareOpen) render();
      }
    }
    return;
  }
  if (action === "share-close") {
    if (state.account.shareBusy) return;
    clearAccountShare({ close: true });
    state.account.libraryOpen = true;
    render();
    return;
  }
  if (action === "studio-from-favorites") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; state.account.studioMode = "picker"; state.account.editingDraftId = null; state.account.editingSetId = null; state.account.setName = ""; state.account.studioItems = []; state.account.selectedCards = new Set(); setStudioNewMetadata(); state.account.error = ""; render(); return; }
  if (action === "studio-write") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; if (state.account.studioMode === "editor") { state.account.studioItems.push({ kind: "custom", text: "", r18: false, origin: "user" }); state.focusSelector = `[data-studio-item-text][data-item-index="${state.account.studioItems.length - 1}"]`; } else { state.account.studioMode = "editor"; state.account.editingDraftId = null; state.account.editingSetId = null; state.account.setName = ""; state.account.studioItems = [{ kind: "custom", text: "", r18: false, origin: "user" }]; state.account.selectedCards = new Set(); setStudioNewMetadata(); state.account.error = ""; state.focusSelector = '[data-studio-item-text][data-item-index="0"]'; } render(); return; }
  if (action === "studio-ai") { if (state.account.busy || state.account.aiGenerationAvailable === false) return; state.account.studioRequestId += 1; state.account.aiName = ''; state.account.aiR18 = false; state.account.studioAiReturnMode = state.account.studioMode === "editor" ? "editor" : "list"; if (state.account.studioMode !== "editor") { state.account.editingDraftId = null; state.account.editingSetId = null; state.account.setName = ""; state.account.studioItems = []; state.account.selectedCards = new Set(); setStudioNewMetadata(); } state.account.studioMode = "ai"; state.account.aiQuestions = []; state.account.error = ""; render(); return; }
  if (action === "studio-favorites") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioMode = "favorites"; state.account.error = ""; render(); return; }
  if (action === "studio-custom-library") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioMode = "custom"; state.account.error = ""; render(); return; }
  if (action === "studio-picker") { state.account.studioMode = "picker"; render(); return; }
  if (action === "studio-edit-set") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; const set = state.account.sets.find((row) => row.id === event.currentTarget.dataset.setId); if (!set) return; state.account.studioMode = "editor"; state.account.customEditorOpen = false; state.account.editingSetId = set.id; state.account.editingDraftId = null; state.account.setName = set.name || ""; setStudioMetadata(set); state.account.studioItems = (set.card_ids || []).map((cardId) => ({ kind: "saved", cardId })); state.account.selectedCards = new Set(set.card_ids || []); render(); return; }
  if (action === "studio-edit-draft") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; const draft = state.account.drafts.find((row) => row.id === event.currentTarget.dataset.draftId); if (!draft) return; state.account.studioMode = "editor"; state.account.customEditorOpen = false; state.account.editingDraftId = draft.id; state.account.editingSetId = draft.sourceSetId || null; state.account.setName = draft.name || ""; setStudioMetadata(draft); state.account.studioItems = (draft.items || []).map((item) => ({ ...item })); state.account.selectedCards = new Set((draft.items || []).filter((item) => item.kind === "saved").map((item) => item.cardId)); render(); return; }
  if (action === "studio-delete-draft") { if (state.account.busy) return; const id = event.currentTarget.dataset.draftId; const generation = state.account.generation; state.account.busy = true; render(); try { await accountApi.deleteDraft(id); if (generation !== state.account.generation) return; state.account.drafts = state.account.drafts.filter((row) => row.id !== id); state.account.status = "下書きを破棄しました。"; } catch { if (generation === state.account.generation) state.account.error = "下書きを破棄できませんでした。"; } finally { if (generation === state.account.generation) { state.account.busy = false; render(); } } return; }
  if (action === "set-new") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; state.account.studioMode = "editor"; state.account.customEditorOpen = false; state.account.editingDraftId = null; state.account.editingSetId = null; state.account.setName = ""; state.account.studioItems = []; state.account.selectedCards = new Set(); setStudioNewMetadata(); state.account.error = ""; state.focusSelector = "[data-set-name]"; render(); return; }
  if (action === "set-cancel") { state.account.editingSetId = null; state.account.setName = undefined; state.account.selectedCards = new Set(); render(); return; }
  if (action === "set-edit") { if (state.account.busy) return; const set = state.account.sets.find((item) => item.id === event.currentTarget.dataset.setId); state.account.editingSetId = set?.id || null; state.account.setName = set?.name || ""; state.account.selectedCards = new Set(set?.card_ids || []); render(); return; }
  if (action === "set-delete") { if (state.account.busy) return; const id = event.currentTarget.dataset.setId; const generation = state.account.generation; state.account.busy = true; render(); try { await accountApi.deleteSet(id); if (generation !== state.account.generation) return; state.account.sets = state.account.sets.filter((set) => set.id !== id); state.account.status = "削除しました。";
    } catch {
      if (generation === state.account.generation) state.account.error = "セットを削除できませんでした。"; } finally { if (generation === state.account.generation) { state.account.busy = false; render(); } } return; }
  if (action === "remove-favorite") { if (state.account.busy) return; const id = event.currentTarget.dataset.cardId; const generation = state.account.generation; state.account.busy = true; render(); try { await accountApi.favorite({ id }, false); if (generation !== state.account.generation) return; state.account.favorites.delete(id); state.account.selectedCards.delete(id); } catch { if (generation === state.account.generation) state.account.error = "お気に入りを更新できませんでした。"; } finally { if (generation === state.account.generation) { state.account.busy = false; render(); } } return; }
  if (action === "set-play") { if (state.account.busy) return; const set = state.account.sets.find((item) => item.id === event.currentTarget.dataset.setId); state.account.pendingSet = null; try { playSavedSet(set); } catch (error) { state.account.error = error.message; render(); } return; }
  if (action === "confirm-set-play") { const pending = state.account.pendingSet; if (!pending) return; state.account.pendingSet = { ...pending, consented: true }; try { playSavedSet(pending.set); } catch (error) { state.account.error = error.message; render(); } return; }
  if (action === "favorite-card") {
    if (state.account.busy) return;
    const session = ensureSession(); const card = currentCard(session); if (!state.account.user || !card) return;
    const saved = !state.account.favorites.has(card.id); const generation = state.account.generation; state.error = ""; state.account.busy = true; render();
    try { await accountApi.favorite(cardPayload(card, session.mixed ? card.sourceDeckId : session.deckId), saved); if (generation !== state.account.generation) return; if (saved) state.account.favorites.add(card.id); else state.account.favorites.delete(card.id); }
    catch { if (state.account.generation === generation) state.error = "保存状態を更新できませんでした。"; }
    finally { if (generation === state.account.generation) { state.account.busy = false; render(); } }
    return;
  }
  if (action === "social-share") {
    state.shareDialogOpen = true;
    state.shareMenuOpen = false;
    state.focusSelector = "[data-share-x]";
    render();
    return;
  }
  if (action === "share-dialog-close") { state.shareDialogOpen = false; state.focusAction = "social-share"; render(); return; }
  if (action === "share-menu-close") { state.shareMenuOpen = false; state.focusAction = "social-share"; render(); return; }
  if (action === "social-share-native") { shareRoundResult(); return; }
  if (action === "social-share-copy") { copyRoundShare(); return; }
  if (action === "round-like-toggle") {
    state.roundLikeExpanded = !state.roundLikeExpanded;
    render();
    return;
  }
  if (action === "round-favorite-toggle") { const context = state.roundFavorite; if (!context || context.saving) return; context.expanded = !context.expanded; render(); return; }
  if (action === "round-favorite-login") {
    const context = state.roundFavorite;
    if (!context || context.saving || ![...context.selected].some((id) => !state.account.favorites.has(id)) || !state.account.enabled) return;
    state.account.open = true; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false;
    state.account.error = "";
    state.account.status = "";
    context.loginPending = true;
    state.focusSelector = "[data-account-email]";
    render();
    return;
  }
  if (action === "round-favorite-save") {
    saveRoundFavorites();
    return;
  }
  if (action === "add-person") {
    const sharedEntry = Boolean(state.shared || state.venue);
    if (state.participants.length < MAX_PARTICIPANTS) {
      const restoredName = state.groupParticipants?.[state.participants.length];
      state.participants.push(typeof restoredName === "string" ? restoredName : "");
      if (!sharedEntry && state.participants.length === 2) {
        state.themeMode = "single";
        state.participantTab = "group";
        state.selectedDeckId = "friends";
        state.selectedDeckIds = ["friends"];
        state.selectedMySetId = null;
      }
      state.focusSelector = 'button[data-action="add-person"]';
    }
    render();
    return;
  }
  if (action === "remove-person") {
    const sharedEntry = Boolean(state.shared || state.venue);
    const minimumParticipants = sharedEntry ? 2 : 1;
    if (state.participants.length > minimumParticipants) {
      const previousGroup = Array.isArray(state.groupParticipants) ? state.groupParticipants : [];
      state.groupParticipants = [...state.participants, ...previousGroup.slice(state.participants.length)];
      state.participants.pop();
      if (!sharedEntry && state.participants.length === 1) {
        state.themeMode = "solo";
        state.participantTab = "solo";
        state.selectedDeckId = "self-values";
        state.selectedDeckIds = ["self-values"];
        state.selectedMySetId = null;
      }
      state.focusSelector = (!sharedEntry && state.participants.length === 1) || (sharedEntry && state.participants.length === 2) ? 'button[data-action="add-person"]' : 'button[data-action="remove-person"]';
    }
    render();
    return;
  }
  if (action === "home-solo-mode") { if (state.participants.length >= 2) state.groupParticipants = [...state.participants]; state.themeMode = "solo"; state.participantTab = "solo"; state.themeExplorerShelf = "all"; state.selectedDeckId = "self-values"; state.selectedDeckIds = ["self-values"]; state.selectedMySetId = null; state.error = ""; render(); return; }
  if (action === "home-group-mode") { if (state.themeMode === "solo") state.participants = state.groupParticipants?.length >= 2 ? [...state.groupParticipants] : ["", ""]; state.themeMode = "single"; state.participantTab = "group"; state.themeExplorerShelf = "all"; state.selectedDeckId = "friends"; state.selectedDeckIds = ["friends"]; state.selectedMySetId = null; state.error = ""; render(); return; }
  if (action === "edit-participants") { state.screen = "participants"; state.error = ""; state.focusSelector = "input[data-index=\"0\"]"; render(); return; }
  if (action === "home-solo-start") { if (state.participants.length >= 2) state.groupParticipants = [...state.participants]; state.themeMode = "solo"; state.participantTab = "solo"; state.participants = ["自分"]; state.themeExplorerShelf = "all"; state.selectedDeckId = "self-values"; state.selectedDeckIds = ["self-values"]; state.selectedMySetId = null; state.screen = "decks"; state.error = ""; render(); return; }
  if (action === "solo-mode") { if (state.session && !isFinished(state.session)) saveCurrentSession(state.session); if (state.participants.length >= 2) state.groupParticipants = [...state.participants]; state.session = null; state.participants = ["自分"]; state.themeMode = "solo"; state.participantTab = "solo"; state.themeExplorerShelf = "all"; state.selectedDeckId = "self-values"; state.selectedDeckIds = ["self-values"]; state.selectedMySetId = null; state.screen = "decks"; state.error = ""; render(); return; }
  if (action === "group-mode") { if (state.session && !isFinished(state.session)) saveCurrentSession(state.session); const restoreGroup = state.themeMode === "solo" || state.participants.length < 2; if (restoreGroup) state.participants = state.groupParticipants?.length >= 2 ? [...state.groupParticipants] : ["", ""]; else state.groupParticipants = [...state.participants]; state.session = null; state.themeMode = "single"; state.participantTab = "group"; state.themeExplorerShelf = "all"; state.selectedDeckId = "friends"; state.selectedDeckIds = ["friends"]; state.selectedMySetId = null; state.screen = "participants"; state.error = ""; render(); return; }
  if (action === "decks") {
    state.continuePending = null;
    state.shareMenuOpen = false;
    state.shareStatus = "";
    state.shareFallbackText = "";
    const leavingVenue = Boolean(state.venue || state.session?.venueSession);
    state.roundFavorite = null; state.roundLikeKey = null; state.roundLikeExpanded = false; state.feedbackBusy = false; state.feedback = null; state.screen = "decks";
    if (leavingVenue) { state.venue = null; state.shared = null; state.selectedVenueSetId = null; state.session = null; if (location.search.includes("venue=")) history.replaceState({}, "", `${location.pathname}${location.hash}`); }
    state.error = "";
    state.busy = false;
    render();
    return;
  }
  if (action === "theme-options-toggle") {
    state.themeOptionsOpen = !state.themeOptionsOpen;
    state.focusAction = "theme-options-toggle";
    render();
    return;
  }
  if (action === "choose-deck") {
    state.continuePending = null;
    state.shareMenuOpen = false;
    state.shareStatus = "";
    state.shareFallbackText = "";
    const deck = decks.find((item) => item.id === event.currentTarget.dataset.deck); const adultConfirmed = state.adultConfirmed; const unseen = state.themeMode === "mixed" ? !state.selectedDeckIds.every((id) => canSeeDeck(decks.find((item) => item.id === id))) : !canSeeDeck(deck); if (unseen) { state.error = "このテーマは利用できません。"; render(); return; } if (state.themeMode === "mixed" ? !state.selectedDeckIds.every((id) => canUseDeck(decks.find((item) => item.id === id))) : !canUseDeck(deck)) { state.error = "このテーマは無料登録後に使えます。ログイン / 新規登録してください。"; state.account.open = true; state.account.error = ""; state.account.status = state.error; state.focusSelector = "[data-account-email]"; render(); return; } const includeR18 = Boolean(state.themeMode !== "mixed" && canOfferR18(deck) && adultConfirmed);
    const activeRule = state.themeMode === 'mixed' && state.selectedDeckIds.some((id) => participantRuleForDeck(id) === 'pair') ? 'pair' : participantRuleForDeck(deck);
    if (activeRule === 'pair' && state.participants.length !== 2) { state.error = "2人専用です。参加者を変更してください。"; render(); return; }
    if (includeR18 && !isRegisteredUser()) { state.error = "R18を含めるには無料登録が必要です。"; render(); return; }
    try {
      state.session =
        state.themeMode === "mixed"
          ? createMixedSession({ participants: state.participants, decks: state.selectedDeckIds.map((id) => decks.find((item) => item.id === id)), includeChallenges: state.includeChallenges,
              participantRule: state.selectedDeckIds.some((id) => participantRuleForDeck(id) === 'pair') ? 'pair' : 'group',
            })
          : createSession({
              participants: state.participants,
              deck,
              participantRule: activeRule,
              adultConfirmed,
              includeR18,
              includeChallenges: state.includeChallenges,
            }); state.session.feedbackSubmitted = []; state.feedback = null; state.resume = null; trackThemeStart(state.session.deckId); recordThemeExplorerStart({ ownerId: state.account.user?.id, mode: "group", themeIds: state.themeMode === "mixed" ? state.selectedDeckIds : [state.session.deckId] });
      saveCurrentSession(state.session);
      state.screen = "play";
      state.error = ""; render(); } catch (error) { state.error = error.message; render(); } return; }
  if (action === "solo-start") {
    if (state.selectedMySetId) { const set = playableSavedSets(state.account.sets, state.account.customCards).find((item) => item.id === state.selectedMySetId && ['solo', 'both'].includes(item.audience)); if (!set) { state.error = "このマイセットは一人用では利用できません。"; render(); return; } try { playSavedSet(set); } catch (error) { state.error = error.message; render(); } return; }
    const deck = soloDecks.find((item) => item.id === state.selectedDeckId) || soloDecks[0];
     try { state.session = createSoloSession({ deck, participant: state.participants[0] || "自分" }); state.session.feedbackSubmitted = []; state.feedback = null; state.resume = null; state.soloMemoOpen = false; state.soloNoteDraft = ""; state.soloNoteStatus = ""; state.soloNoteError = ""; state.soloSummaryDraft = ""; trackThemeStart(state.session.deckId); recordThemeExplorerStart({ ownerId: state.account.user?.id, mode: "solo", themeIds: [state.session.deckId] }); saveCurrentSession(state.session); state.screen = "play"; state.error = ""; render(); } catch (error) { state.error = error.message; render(); }
    return;
  }
  if (action === "solo-history-open") { state.soloHistoryOpen = true; state.soloHistory = []; state.soloHistoryCursor = null; state.soloHistoryHasMore = false; if (state.account.user) loadSoloHistory(false); else { state.account.returnAfterAuth = true; state.account.open = state.account.enabled; state.account.status = "ログイン後に保存したメモを読み込みます。"; render(); } return; }
  if (action === "solo-history-close") { state.soloHistoryOpen = false; state.soloHistoryEditing = null; render(); return; }
  if (action === "solo-history-more") { loadSoloHistory(true); return; }
  if (action === "solo-history-retry") { loadSoloHistory(false); return; }
  if (action === "solo-history-edit") { const note = state.soloHistory.find((item) => item.id === event.currentTarget.dataset.noteId); if (note) state.soloHistoryEditing = { id: note.id, note: note.note || "", generation: state.account.generation }; render(); return; }
  if (action === "solo-history-cancel") { state.soloHistoryEditing = null; render(); return; }
  if (action === "solo-history-save") {
    if (state.busy) return; const editing = state.soloHistoryEditing; const value = root.querySelector("[data-history-edit]")?.value ?? editing?.note ?? ""; if (!editing || !value.trim()) return; const generation = state.account.generation; const ownerId = state.account.user?.id; state.busy = true; state.soloHistoryError = ""; render();
    try { const result = await accountApi.updateSoloNote(editing.id, value); if (generation === state.account.generation && state.account.user?.id === ownerId) { const updated = result?.note || result || {}; state.soloHistory = state.soloHistory.map((item) => item.id === editing.id ? { ...item, ...updated, note: updated.note || value } : item); state.soloHistoryEditing = null; state.soloHistoryError = ""; } }
    catch { if (generation === state.account.generation) state.soloHistoryError = "メモを更新できませんでした。入力内容は保持されています。"; }
    finally { if (generation === state.account.generation && state.account.user?.id === ownerId) { state.busy = false; render(); } }
    return;
  }
  if (action === "solo-history-delete") {
    if (state.busy) return; const id = event.currentTarget.dataset.noteId; if (!id || !window.confirm("このメモを削除しますか？")) return; const generation = state.account.generation; const ownerId = state.account.user?.id; state.busy = true; render();
    try { await accountApi.deleteSoloNote(id); if (generation === state.account.generation && state.account.user?.id === ownerId) state.soloHistory = state.soloHistory.filter((item) => item.id !== id); }
    catch { if (generation === state.account.generation) state.soloHistoryError = "メモを削除できませんでした。"; }
    finally { if (generation === state.account.generation && state.account.user?.id === ownerId) { state.busy = false; render(); } }
    return;
  }
  if (action === "solo-note-save") {
    const session = state.session; const card = session && currentCard(session); const key = session && card ? `${session.sessionId}:${card.id}` : ""; const note = key ? (state.soloNoteDrafts[key] || "") : ""; const generation = state.account.generation; const revision = state.soloDraftRevision;
    if (state.busy) return;
    if (!session || session.mode !== "solo" || !card || !note.trim()) { if (key) { state.soloNoteErrors[key] = note.trim() ? "保存できる質問がありません。" : "メモを入力してください。"; state.soloNoteStatuses[key] = ""; } render(); return; }
    if (!state.account.user) { state.soloNoteErrors[key] = "保存するにはログインしてください。入力内容は保持されます。"; state.soloNoteStatuses[key] = ""; state.account.open = state.account.enabled; state.account.returnAfterAuth = true; state.account.error = "入力内容は保持されています。ログイン後に保存できます。"; render(); return; }
    const ownerId = state.account.user.id;
    state.busy = true; state.soloNoteErrors[key] = ""; state.soloNoteStatuses[key] = ""; render();
    try {
      await accountApi.saveSoloNote({ sessionId: session.sessionId, sourceType: session.customSet ? "set" : "deck", sourceId: session.customSet ? session.setId : session.deckId, roundNumber: Math.floor((session.roundStart ?? session.cursor) / ROUND_SIZE) + 1, slotKind: "question", questionId: card.id, note });
      if (generation === state.account.generation && state.account.user?.id === ownerId && state.session?.sessionId === session.sessionId && state.soloDraftRevision === revision) state.soloNoteStatuses[key] = "保存しました。";
    } catch (error) { if (generation === state.account.generation && state.account.user?.id === ownerId && state.session?.sessionId === session.sessionId && state.soloDraftRevision === revision) state.soloNoteErrors[key] = error?.status === 503 ? "メモ保存は現在利用できません。もう一度お試しください。" : "保存できませんでした。入力内容は保持されています。"; }
    finally { if (generation === state.account.generation && state.account.user?.id === ownerId && state.session?.sessionId === session.sessionId) { state.busy = false; render(); } }
    return;
  }
  if (action === "solo-summary-save") {
    const session = state.session; const roundNumber = session ? Math.floor((session.roundStart ?? session.cursor) / ROUND_SIZE) + 1 : 0; const key = session ? `${session.sessionId}:${roundNumber}` : ""; const note = key ? (state.soloSummaryDrafts[key] || "") : ""; const generation = state.account.generation; const revision = state.soloDraftRevision;
    if (state.busy) return;
    if (!session || session.mode !== "solo" || !note.trim()) { if (key) state.soloSummaryErrors[key] = "まとめを入力してください。"; render(); return; }
    if (!state.account.user) { state.soloSummaryErrors[key] = "保存するにはログインしてください。入力内容は保持されています。"; state.account.open = state.account.enabled; state.account.returnAfterAuth = true; state.account.error = "入力内容は保持されています。ログイン後に保存できます。"; render(); return; }
    const ownerId = state.account.user.id;
    state.busy = true; state.soloSummaryErrors[key] = ""; state.soloSummaryStatuses[key] = ""; render();
    try { await accountApi.saveSoloNote({ sessionId: session.sessionId, sourceType: session.customSet ? "set" : "deck", sourceId: session.customSet ? session.setId : session.deckId, roundNumber, slotKind: "summary", note }); if (generation === state.account.generation && state.account.user?.id === ownerId && state.session?.sessionId === session.sessionId && state.soloDraftRevision === revision) state.soloSummaryStatuses[key] = "保存しました。"; }
    catch (error) { if (generation === state.account.generation && state.account.user?.id === ownerId && state.session?.sessionId === session.sessionId && state.soloDraftRevision === revision) state.soloSummaryErrors[key] = error?.status === 503 ? "メモ保存は現在利用できません。もう一度お試しください。" : "保存できませんでした。入力内容は保持されています。"; }
    finally { if (generation === state.account.generation && state.account.user?.id === ownerId && state.session?.sessionId === session.sessionId) { state.busy = false; render(); } }
    return;
  }
  if (action === "choose-myset") {
    if (!isRegisteredUser()) return;
    const set = playableSavedSets(state.account.sets, state.account.customCards).find((item) => item.id === event.currentTarget.dataset.setId);
    if (!set) { state.error = "このマイセットは利用できません。"; render(); return; }
    state.selectedMySetId = set.id; state.participantTab = state.themeMode === 'solo' ? 'solo' : participantRuleForSavedSet(set, 'group'); state.adultConfirmed = false; state.themeOptionsOpen = set.hasR18 === true; state.error = ""; state.focusAction = "choose-myset-start"; render();
    return;
  }
  if (action === "choose-myset-start") {
    if (!isRegisteredUser()) return;
    const set = playableSavedSets(state.account.sets, state.account.customCards).find((item) => item.id === event.currentTarget.dataset.setId);
    if (!set) { state.error = "このマイセットは利用できません。"; render(); return; }
    const pendingHasR18 = set.hasR18 === true || (Array.isArray(set.card_ids) && set.card_ids.some((id) => canonicalCard(id, state.account.customCards)?.r18 === true));
    if (state.themeMode !== 'solo' && participantRuleForSavedSet(set, 'group') === 'pair' && state.participants.length !== 2) { state.error = "2人専用です。参加者を変更してください。"; render(); return; }
    state.error = ""; state.account.pendingSet = pendingHasR18 ? { set: { ...set, hasR18: true }, consented: state.adultConfirmed === true } : null;
    try { playSavedSet(set); } catch (error) { state.error = error.message; render(); }
    return;
  }
  if (action === "feedback-rating") { const feedback = feedbackState(ensureSession()); feedback.rating = feedback.rating === event.currentTarget.dataset.rating ? null : event.currentTarget.dataset.rating; feedback.error = "";
    state.focusSelector = `[data-rating="${event.currentTarget.dataset.rating}"]`;
    render();
    return;
  }
  if (action === "feedback-submit") {
    if (state.feedbackBusy) return;
    const session = ensureSession(); const feedback = feedbackState(session); let payload;
    try { payload = buildFeedbackPayload(session, session.cursor, feedback.rating, feedback.text); } catch (error) { feedback.error = error.message === "feedback-empty" ? "評価かひとことを入力してください。" : "入力内容を確認してください。"; render(); return; }
    const key = feedback.key; const capturedSessionId = session.sessionId; const capturedCursor = session.cursor; const token = ++state.feedbackRequestToken; state.feedbackBusy = true; feedback.error = ""; render();
    try {
      await submitFeedback(payload);
      if (state.feedbackRequestToken !== token) return;
      const current = state.session?.sessionId === capturedSessionId ? state.session : null;
      if (current) { current.feedbackSubmitted = [...new Set([...(current.feedbackSubmitted || []), capturedCursor])];
        saveCurrentSession(current); }
      else { const saved = loadResumeForCurrentUser(); if (saved?.sessionId === capturedSessionId) { saved.feedbackSubmitted = [...new Set([...(saved.feedbackSubmitted || []), capturedCursor])]; saveSession(saved); } }
      state.feedbackBusy = false;
      if (state.session?.sessionId === capturedSessionId && feedbackKey(state.session.sessionId, state.session.cursor) === key) render(); else if (state.screen === "participants") state.resume = loadResumeForCurrentUser();
    } catch {
      if (state.feedbackRequestToken === token && state.session?.sessionId === capturedSessionId && feedbackKey(state.session.sessionId, state.session.cursor) === key) { state.feedbackBusy = false; feedback.error = "送信できませんでした。もう一度お試しください。";
        render();
      }
    }
    return;
  }
  if (action === "like") { const previous = ensureSession(); state.session = likeCurrentAnswer(previous); persist(previous); render(); return; }
  if (action === "next-answer") { try { advanceGuarded(nextAnswer); } catch (error) { state.error = error.message; render(); } return; }
  if (action === "previous-answer") { const previous = ensureSession(); state.session = previousAnswer(previous); persist(previous); render(); return; }
  if (action === "pass") { try { advanceGuarded(passAnswer); } catch (error) { state.error = error.message; render(); } return; }
  if (action === "theme-like") {
    const themeId = String(event.currentTarget.dataset.themeId || "");
    if (!themeId || state.themeLikePending.has(themeId) || hasThemeLike(themeId)) return;
    state.themeLikePending.add(themeId); state.themeLikeStatus[themeId] = "pending"; render();
    const result = await submitThemeLike(themeId);
    state.themeLikePending.delete(themeId);
    if (result.ok) state.themeLikeStatus[themeId] = "thanks";
    else state.themeLikeStatus[themeId] = "error";
    render();
    return;
  }
  if (action === "continue") {
    if (isActiveVenueSession(state.session)) { await continueCurrentRound(); return; }
    if (!state.account.authReady || !state.account.user) {
      if (!state.account.authReady) { state.error = "ログイン状態を確認しています。少し待ってからお試しください。"; render(); return; }
      if (!state.account.enabled) { state.error = "ログイン設定を利用できないため、続きを始められません。"; render(); return; }
      const session = ensureSession();
      state.continuePending = { sessionId: session.sessionId, roundStart: session.roundStart, cursor: session.cursor };
      state.account.open = true; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false;
      state.account.error = ""; state.account.status = "ログインまたは新規登録で、続きを無料で楽しめます。"; state.focusSelector = "[data-account-email]"; render(); return;
    }
    await continueCurrentRound();
    return;
  }
  if (action === "finish") { state.continuePending = null; state.shareMenuOpen = false; state.shareFallbackText = ""; state.roundFavorite = null; state.roundLikeKey = null; state.roundLikeExpanded = false; state.feedbackBusy = false; state.feedback = null; state.shareStatus = "";
    state.resume = loadResumeForCurrentUser();
    restoreGroupHomeState();
    state.screen = "participants";
    state.venue = null; state.shared = null; state.selectedVenueSetId = null;
    if (location.search.includes("venue=")) history.replaceState({}, "", `${location.pathname}${location.hash}`);
    state.error = ""; state.includeChallenges = false; state.adultConfirmed = false; render(); }
}

let webMcpRegistered = false;
function registerWebMcp() {
  if (webMcpRegistered || !document.modelContext?.registerTool) return;
  webMcpRegistered = true;
  const lifecycle = new AbortController();
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
  const empty = { type: "object", additionalProperties: false, properties: {} };
  const register = (tool) => { try { return Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); } catch { return undefined; } };
  const tools = [
    { name: "read_state",
      description: "現在の画面とカード進行を読む", inputSchema: empty, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error("中止されました"); const session = state.session; return { screen: state.screen, participants: state.participants, cursor: session?.cursor ?? 0, unlockedUntil: session?.unlockedUntil ?? 0, deckId: session?.deckId ?? null, deckIds: session?.deckIds ?? [], mixed: session?.mixed === true, includeR18: session?.includeR18 ?? false, includeChallenges: session?.includeChallenges ?? false, revealed: session?.revealed ?? false, currentSpeaker: session?.revealed ? currentSpeaker(session) : null, answerIndex: session?.answerIndex ?? 0, likes: session?.likes ?? {},
        };
      },
    },
    {
      name: "start_session",
      description: "参加者とデッキを検証してカード裏から開始する",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          participants: {
            type: "array",
            minItems: 2,
            maxItems: 8,
            items: { type: "string" },
          },
          deckId: { type: "string" },
          deckIds: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: { type: "string" },
          },
          adultConfirmed: { type: "boolean" },
          includeR18: { type: "boolean" },
          includeChallenges: { type: "boolean" },
        },
        required: ["participants"],
      }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (payload, { signal } = {}) => { if (signal?.aborted) throw new Error("中止されました");
        if (payload?.deckId && Array.isArray(payload?.deckIds)) throw new Error("deckIdとdeckIdsは同時に指定できません"); const ids = Array.isArray(payload?.deckIds) ? payload.deckIds : []; if (ids.length && payload?.includeR18 === true) throw new Error("ミックスではR18を選べません"); const requested = (ids.length ? ids : [payload?.deckId]).map((id) => decks.find((item) => item.id === id)); if (requested.some((deck) => !deck || !canUseDeck(deck)) || (payload?.includeR18 === true && !canOfferR18(requested[0]))) throw new Error("指定されたテーマは利用できません"); const next = ids.length ? createMixedSession({ participants: payload?.participants, decks: ids.map((id) => decks.find((item) => item.id === id)), includeChallenges: payload?.includeChallenges === true, includeR18: payload?.includeR18 === true,
            }) : createSession({ participants: payload?.participants, deck: decks.find((item) => item.id === payload?.deckId), adultConfirmed: payload?.adultConfirmed === true, includeR18: payload?.includeR18 === true, includeChallenges: payload?.includeChallenges === true,
            });
        state.participants = next.participants;
        state.participantNameOrigin = null;
        state.participantNameAutoValue = ""; state.participantNameUserEdited = true; state.session = next; state.feedback = null; state.feedbackBusy = false; state.selectedDeckId = next.mixed ? next.deckIds[0] : next.deckId; state.selectedDeckIds = next.deckIds; state.themeMode = next.mixed ? "mixed" : "single"; state.includeChallenges = next.includeChallenges; state.adultConfirmed = next.adultConfirmed; state.resume = null; saveSession(next); trackThemeStart(next.deckId); state.screen = "play";
        state.error = "";
        render();
        return { ok: true };
      },
    },
    {
      name: "reveal_card",
      description: "現在のカードをめくる", inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error("中止されました"); const previous = ensureSession(); state.session = revealCard(previous); persist(previous); render(); return { ok: true, revealed: true }; },
    },
    {
      name: "like_current_answer",
      description: "現在の回答者にいいねする", inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error("中止されました"); const previous = ensureSession(); state.session = likeCurrentAnswer(previous); persist(previous); render(); return { ok: true, likes: currentAnswerLikes(state.session) }; },
    },
    {
      name: "next_answer",
      description: "同じ質問の次の回答者へ進む", inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error("中止されました"); advanceGuarded(nextAnswer); return { ok: true, cursor: state.session.cursor, answerIndex: state.session.answerIndex,
        };
      },
    },
    {
      name: "pass_answer",
      description: "現在の回答者をパスする", inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error("中止されました"); advanceGuarded(passAnswer); return { ok: true, cursor: state.session.cursor, answerIndex: state.session.answerIndex,
        };
      },
    },
    {
      name: "continue_round",
      description: "6枚区切りの続きを許可する", inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async (_input, { signal } = {}) => { if (signal?.aborted) throw new Error("中止されました"); const previous = ensureSession(); if (!isActiveVenueSession(state.session) && !(await canContinue(state.session, state.account))) throw new Error("ログインしてから続きを始めてください。"); state.feedback = null; state.feedbackBusy = false; state.session = continueRound(state.session); persist(previous); render(); return { ok: true, unlockedUntil: state.session.unlockedUntil }; },
    },
  ];
  tools.forEach(register);
}
async function loadSharedLink() {
  const token = new URL(location.href).searchParams.get("share");
  if (!token) return;
  const requestId = ++state.sharedRequestId;
  state.sharedLoading = true;
  state.shared = { token, name: "共有セット" };
  render();
  try {
    await accountConfigReady;
    if (requestId !== state.sharedRequestId) return;
    const result = await accountApi.sharedSet(token);
    if (requestId !== state.sharedRequestId) return;
    state.shared = { token, ...(result.share || result) };
    state.error = "";
    state.screen = "participants";
  } catch {
    if (requestId !== state.sharedRequestId) return;
    state.shared = null;
    state.error = "この共有リンクは無効か、停止されています。";
  } finally {
    if (requestId === state.sharedRequestId) {
      state.sharedLoading = false;
      render();
    }
  }
}
function setStudioNewMetadata() {
  setStudioMetadata(state.themeMode === 'solo' ? { audience: 'solo', questionOrder: 'fixed' } : {});
  state.account.studioDesign = { version: 1, kind: 'preset', presetId: state.themeMode === 'solo' ? 'self-reflection' : 'first-meeting' };
}
function setStudioMetadata(row) {
  state.account.studioAudience = ['group', 'solo', 'both'].includes(row?.audience) ? row.audience : 'group';
  state.account.studioQuestionOrder = ['shuffle', 'fixed'].includes(row?.questionOrder || row?.question_order) ? (row.questionOrder || row.question_order) : 'shuffle';
  state.account.studioR18 = row?.r18 === true || row?.theme_r18 === true;
  state.account.studioDesign = normalizeCreatorDesign(row?.design);
}
async function loadVenueLink() {
  const token = new URL(location.href).searchParams.get("venue");
  if (!token) return;
  const requestId = ++state.sharedRequestId;
  state.sharedLoading = true;
  try {
    const result = await accountApi.venueInfo(token);
    if (requestId !== state.sharedRequestId) return;
    if (!Array.isArray(result.sets) || !result.sets.length) throw new Error("店舗テーマが見つかりません。");
    state.venue = { token, venue: result.venue, table: result.table, sets: result.sets, ageTapped: false, displayR18: false };
    state.selectedVenueSetId = result.sets[0].id;
    state.shared = { token, name: result.venue.name, cardCount: result.sets[0].cardCount, adultOnly: result.sets[0].adultOnly };
    syncSelectedVenueSet();
    state.error = "";
  } catch { if (requestId === state.sharedRequestId) { state.venue = null; state.shared = null; state.error = "この店舗QRは無効か、停止されています。"; } }
  finally { if (requestId === state.sharedRequestId) { state.sharedLoading = false; render(); } }
}

const accountConfigReady = discoverAccountConfig();
try { const saved = loadSession(); if (saved?.customSet && saved.ownerUserId && Array.isArray(saved.customQuestions) && saved.customQuestions.length > 0) state.pendingCustomResume = saved; else state.resume = saved; } catch { state.resume = null; state.pendingCustomResume = null; }
render();
loadSharedLink();
loadVenueLink();
accountConfigReady.then(() => { state.account.enabled = accountConfig.enabled; state.account.google = accountConfig.google; if (!state.account.enabled && state.pendingCustomResume) { clearSession(); state.pendingCustomResume = null; } if (!state.account.enabled) state.account.authReady = true; if (state.account.enabled) { if (state.account.venueOnboarding) state.account.open = true; if (libraryQuery || state.account.libraryReturn) { state.account.open = true; state.account.libraryOpen = true; state.account.studioMode = "list"; if (state.account.user) state.account.libraryReturn = false; } loadAccount(); accountApi.onAuthStateChange?.((event, session) => { setTimeout(() => { const nextUser = session?.user || null; const previousId = state.account.user?.id || null; const nextId = nextUser?.id || null; const identityChanged = Boolean(previousId && nextId && previousId !== nextId); if (event === "SIGNED_OUT" || identityChanged || (event === "SIGNED_IN" && !previousId)) state.account.authReady = false; if (event === "SIGNED_OUT" || identityChanged) {
            state.roundFavorite = null; state.continuePending = null;
            clearAccountShare({ close: true });
            state.shareStatus = "";
            state.shareMenuOpen = false; state.shareFallbackText = "";
            state.sharedRequestId += 1;
            state.shared = null;
            state.venue = null;
            state.selectedVenueSetId = null;
            state.sharedLoading = false;
            state.soloHistory = []; state.soloHistoryCursor = null; state.soloHistoryHasMore = false; state.soloHistoryLoading = false; state.soloHistoryError = ""; state.soloHistoryEditing = null; state.soloHistoryOpen = false; state.soloMemoOpen = false; state.soloNoteDrafts = Object.create(null); state.soloNoteStatuses = Object.create(null); state.soloNoteErrors = Object.create(null); state.soloSummaryDrafts = Object.create(null); state.soloSummaryStatuses = Object.create(null); state.soloSummaryErrors = Object.create(null); state.busy = false;
          }
          const privateResume = isPrivateCustomSession(state.session) || isPrivateCustomSession(state.resume) || isPrivateCustomSession(state.pendingCustomResume); if (event === "SIGNED_OUT" || identityChanged) { clearAccountParticipantName(); purgeAdultSessions(); }
          if ((event === "SIGNED_OUT" || identityChanged) && privateResume) { clearSession(); state.session = null; state.resume = null; state.pendingCustomResume = null; if (state.screen === "play") state.screen = "participants";
          }
          if (previousId === nextId && event !== "SIGNED_OUT") { if (nextId) state.account.user = normalizeAccountUser(nextUser, state.account.user); return; } state.account.generation += 1; state.account.profileRevision += 1; state.account.busy = false; state.account.user = normalizeAccountUser(nextUser); if (state.account.user && state.account.libraryReturn) { state.account.open = true; state.account.libraryOpen = true; state.account.studioMode = "list"; clearLibraryReturnIntent(); } if (!state.account.user) state.account.authReady = true; state.account.favorites = new Set(); state.account.customCards = []; state.account.drafts = []; state.account.draftsAvailable = false; state.account.studioMode = "list"; state.account.editingDraftId = null; state.account.aiQuestions = []; state.account.aiName = ""; state.account.aiR18 = false; state.account.studioReplaceIndex = null; state.account.customCardsAvailable = false; state.account.sets = []; state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = ""; state.account.customDraftR18 = false; state.account.selectedCards = new Set(); state.account.editingSetId = null; state.account.setName = undefined; state.account.pendingSet = null; state.account.avatarUrl = "";
          state.account.avatarRevision += 1;
          state.account.avatarDraft = "";
          state.account.avatarBusy = false;
          state.account.avatarError = "";
          if (event === "SIGNED_OUT" || identityChanged) { clearR18Visible(state.account, r18Storage()); state.account.r18DisplayHydrated = false; state.account.revealAdult = false; }
          state.account.ageConfirmedAt = null; state.account.adultConfirmationAvailable = false; state.account.ageRevokeOpen = false; state.account.ageConfirmChecked = false;
          state.account.status = "";
          state.account.error = ""; const preserveRound = Boolean((state.roundFavorite?.loginPending || state.continuePending) && state.session && nextId && !previousId); if (!preserveRound) state.feedback = null; if (state.continuePending?.kind !== "resume") state.resume = null; if (state.account.user) { render(); loadAccount(); } else { state.account.favorites = new Set(); state.account.customCards = []; state.account.drafts = []; state.account.draftsAvailable = false; state.account.studioMode = "list"; state.account.editingDraftId = null; state.account.aiQuestions = []; state.account.aiName = ""; state.account.aiR18 = false; state.account.studioReplaceIndex = null; state.account.customCardsAvailable = false; state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = ""; state.account.customDraftR18 = false; state.account.sets = []; state.account.ageConfirmedAt = null; state.account.adultConfirmationAvailable = false; render(); } }, 0); }); } }).catch(() => { state.account.authReady = true; state.account.enabled = false; render(); });
