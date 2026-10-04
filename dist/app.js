import { decks } from "./data/decks.js";
import { trackPage, trackThemeStart, trackSessionProgress } from "./analytics.js";
import { loadSession, saveSession, clearSession } from "./session-storage.js";
import { canContinue } from "./access-policy.js";
import { ROUND_SIZE, createSession, createMixedSession, createSavedSession, createSharedSession, currentAnswerLikes, currentCard, currentParticipantIndex, currentSpeaker, isFinished, isRoundComplete, likeCurrentAnswer, nextAnswer, passAnswer, previousAnswer, remaining, revealCard, continueRound, normalizeParticipants, MAX_NAME_LENGTH, MAX_PARTICIPANTS, summarizeLikes, completedRoundFavoriteCards } from "./engine.js";
import { themeGroups, groupLabels } from "./data/theme-groups.js";
import { buildFeedbackPayload, feedbackKey, submitFeedback } from "./feedback.js";
import { accountConfig, accountApi, cardPayload, discoverAccountConfig } from "./account.js";
import { renderLibrary, canonicalCard } from "./account-library.js";
import { renderAd } from "./ad-config.js";
import { playableSavedSets } from "./my-set.js";
import { resetStudioEntryState } from "./studio-state.js";
import { buildFacebookShareUrl, buildShareText, buildXShareUrl } from "./share-text.js";
import { isCardAudioEnabled, toggleCardAudio, playFlipSound } from "./card-audio.js";
import { GUEST_THEME_IDS, canUseTheme as canUseThemeForAccount, sessionNeedsThemeAccess } from "./theme-access.js";
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
  screen: "participants",
  participants: ["", ""],
  session: null,
  continuePending: null,
  pendingCustomResume: null,
  error: "", busy: false, feedbackBusy: false, feedbackRequestToken: 0, feedback: null, roundFeedbackExpanded: false, roundFavorite: null, roundLikeExpanded: false, roundLikeKey: null, lastAdvanceAt: 0, focusAction: null, focusSelector: null, shareDialogOpen: false, selectedDeckId: "friends", selectedMySetId: null,
  selectedDeckIds: ["friends"],
  themeMode: "single",
  filter: "all", adultConfirmed: false, includeChallenges: false, resume: null, account: { enabled: accountConfig.enabled, authReady: false, google: accountConfig.google, user: null, favorites: new Set(), customCards: [], customCardsAvailable: false, sets: [], open: false, libraryOpen: false, settingsOpen: false, deleteOpen: false, deleteConfirmed: false,
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
    drafts: [], draftsAvailable: false, completionAvailable: false, aiGenerationAvailable: false, studioMode: "list", studioAiReturnMode: "list", editingDraftId: null, studioItems: [], studioRequestId: 0, studioReplaceIndex: null, aiQuestions: [], aiName: "", aiTheme: "", aiTone: "", aiCount: 6, aiR18: false,
    revealAdult: false,
    status: "", returnAfterAuth: false,
    error: "",
    busy: false,
    generation: 0,
    profileRevision: 0,
    guestNormalizedGeneration: -1,
  },
};
const AUTH_RETURN_KEY = "mingle.cards.auth-return.v1";
function saveAuthReturnIntent() {
  if (state.screen !== "decks" && state.screen !== "participants") return;
  const createdAt = Date.now();
  try { sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify({ createdAt, expiresAt: createdAt + 30 * 60 * 1000, screen: state.screen, participants: state.participants.slice(0, 8), selectedDeckId: state.selectedDeckId, selectedDeckIds: state.selectedDeckIds.slice(0, 3), themeMode: state.themeMode, filter: state.filter })); } catch {}
}
function restoreAuthReturnIntent() {
  let intent = null;
  try { intent = JSON.parse(sessionStorage.getItem(AUTH_RETURN_KEY) || "null"); sessionStorage.removeItem(AUTH_RETURN_KEY); } catch { return; }
  if (!intent || !["decks", "participants"].includes(intent.screen)) return;
  const now = Date.now();
  if (!Number.isFinite(intent.createdAt) || !Number.isFinite(intent.expiresAt) || intent.expiresAt < now || intent.createdAt > now || intent.expiresAt - intent.createdAt > 30 * 60 * 1000) return;
  if (!Array.isArray(intent.participants) || intent.participants.length < 2 || intent.participants.length > 8 || !intent.participants.every((name) => typeof name === "string" && name.length <= MAX_NAME_LENGTH && !/[\u0000-\u001f\u007f]/u.test(name))) return;
  state.participants = intent.participants;
  if (intent.screen === "participants") { state.screen = "participants"; return; }
  const validIds = new Set(decks.map((deck) => deck.id));
  const ids = Array.isArray(intent.selectedDeckIds) ? intent.selectedDeckIds.filter((id) => validIds.has(id)).slice(0, 3) : [];
  state.selectedDeckIds = ids.length ? ids : ["date"];
  state.selectedDeckId = validIds.has(intent.selectedDeckId) ? intent.selectedDeckId : state.selectedDeckIds[0];
  state.themeMode = intent.themeMode === "mixed" ? "mixed" : "single";
  state.filter = typeof intent.filter === "string" && Object.hasOwn(groupLabels, intent.filter) ? intent.filter : "all";
  state.adultConfirmed = false;
  state.screen = "decks";
}
// Guests can start a small set of non-adult themes.  Keep the full deck list
// visible so registration can be discovered without making locked themes
// selectable.
function accountAccessReady() { return state.account.enabled && state.account.authReady; }
function isRegisteredUser() { return Boolean(accountAccessReady() && state.account.user?.id); }
function canUseDeck(deck) { return canUseThemeForAccount(deck, state.account); }
function sessionNeedsRegistration(session) {
  if (isActiveVenueSession(session)) return false;
  return sessionNeedsThemeAccess(session, state.account);
}
function isActiveVenueSession(session = state.session) {
  return Boolean(state.venue?.token && session?.sharedGuest && session.venueSession && session.venueSetId && state.venue.sets?.some((set) => set.id === session.venueSetId));
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
function isPrivateCustomSession(session) { return Boolean(session?.ownerUserId && Array.isArray(session.customQuestions) && session.customQuestions.length); }
function loadResumeForCurrentUser() {
  const candidate = loadSession();
  if (!isPrivateCustomSession(candidate)) return candidate;
  if (state.account.user?.id && state.account.customCardsAvailable && candidate.ownerUserId === state.account.user.id) return candidate;
  clearSession(); return null;
}

function accountSurface(rootNode) {
  const overlay = rootNode?.querySelector?.("[data-account-overlay]");
  if (!overlay) return null;
  const dialog = overlay.querySelector(".account-dialog");
  const kind = dialog?.classList.contains("account-dialog-library") ? "library" : dialog?.classList.contains("account-dialog-settings") ? "settings" : dialog?.classList.contains("account-dialog-delete") ? "delete" : dialog?.classList.contains("account-dialog-menu") ? "menu" : "login";
  return `${kind}:${Boolean(dialog?.querySelector(".library-editor"))}`;
}
function accountScrollSnapshot() {
  const overlay = root.querySelector("[data-account-overlay]");
  if (!overlay) return null;
  const dialog = overlay.querySelector(".account-dialog");
  const grid = overlay.querySelector(".library-card-grid");
  const favorites = overlay.querySelector(".library-favorites");
  return { surface: accountSurface(root), dialogTop: dialog?.scrollTop || 0, dialogLeft: dialog?.scrollLeft || 0, gridTop: grid?.scrollTop || 0, gridLeft: grid?.scrollLeft || 0, favoritesTop: favorites?.scrollTop || 0, favoritesLeft: favorites?.scrollLeft || 0,
  };
}
function restoreAccountScroll(snapshot) {
  if (!snapshot || snapshot.surface !== accountSurface(root)) return;
  const overlay = root.querySelector("[data-account-overlay]");
  const dialog = overlay?.querySelector(".account-dialog");
  const grid = overlay?.querySelector(".library-card-grid");
  const favorites = overlay?.querySelector(".library-favorites");
  if (dialog) { dialog.scrollTop = snapshot.dialogTop; dialog.scrollLeft = snapshot.dialogLeft; }
  if (grid) { grid.scrollTop = snapshot.gridTop; grid.scrollLeft = snapshot.gridLeft; }
  if (favorites) { favorites.scrollTop = snapshot.favoritesTop; favorites.scrollLeft = snapshot.favoritesLeft; }
}
function render() {
  if (state.account.authReady && !state.account.user && state.account.guestNormalizedGeneration !== state.account.generation) {
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
  restoreAccountScroll(accountScroll);
  root.dataset.screen = state.screen;
  document.body.classList.toggle("account-open", state.account.open);
  document.body.classList.toggle("share-open", state.shareDialogOpen);
  trackPage(state.screen);
  root.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", handleAction));
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
      if (submit) submit.disabled = state.sharedLoading || state.busy || (state.shared?.adultOnly === true && !state.adultConfirmed);
    }),
  );
  root.querySelector("[data-venue-set]")?.addEventListener("change", (event) => { state.selectedVenueSetId = event.currentTarget.value; state.adultConfirmed = false; state.error = ""; syncSelectedVenueSet(); render(); });
  root.querySelector("[data-venue-count]")?.addEventListener("change", (event) => { const count = Math.max(2, Math.min(MAX_PARTICIPANTS, Number(event.currentTarget.value) || 2)); while (state.participants.length < count) state.participants.push(""); state.participants.length = count; render(); });
  root.querySelectorAll('input[name="participant"]').forEach((input) => {
    input.addEventListener("input", (event) => { const index = Number(event.target.dataset.index); if (index === 0) { state.participantNameUserEdited = true; if (state.participantNameOrigin === "account" && event.target.value !== state.participantNameAutoValue) {
          state.participantNameOrigin = null;
          state.participantNameAutoValue = "";
        }
      }
      state.participants[index] = event.target.value;
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
  root.querySelectorAll("[data-mode]").forEach((input) =>
    input.addEventListener("change", (event) => { state.themeMode = event.target.value; state.adultConfirmed = false; if (state.themeMode === "mixed") { const regular = new Set(decks.filter((deck) => !deck.adultOnly).map((deck) => deck.id)); state.selectedDeckIds = state.selectedDeckIds.filter((id) => regular.has(id)); if (!state.selectedDeckIds.length && regular.has(state.selectedDeckId)) state.selectedDeckIds = [state.selectedDeckId]; if (state.filter === "adult") state.filter = "all";
      }
      if (state.themeMode === "single") state.selectedDeckId = state.selectedDeckIds[0] || state.selectedDeckId; state.selectedMySetId = null; state.focusSelector = `input[data-mode][value="${event.target.value}"]`; state.error = "";
      render();
    }),
  );
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
  root.querySelector("[data-library-adult]")?.addEventListener("change", (event) => {
    state.account.revealAdult = event.currentTarget.checked;
    state.focusSelector = "[data-library-adult]";
    render();
  });
  root.querySelector("[data-delete-confirm]")?.addEventListener("change", (event) => { state.account.deleteConfirmed = event.currentTarget.checked; const button = root.querySelector('[data-action="account-delete-confirm"]'); if (button) button.disabled = state.account.busy || !state.account.deletionAvailable || !state.account.deleteConfirmed; });
  const setNameInput = root.querySelector("[data-set-name]");
  const updateSetValidity = () => {
    const form = setNameInput?.closest("form"); const button = form?.querySelector('button[type=\"submit\"]') || root.querySelector('.studio-save-footer button[type=\"submit\"]'); if (!button || !setNameInput) return; const count = state.account.studioItems.length; button.disabled = state.account.busy || !setNameInput.value.trim() || Array.from(setNameInput.value.trim()).length > 80 || count > 40 || state.account.draftsAvailable === false; }; setNameInput?.addEventListener("input", (event) => { state.account.setName = event.currentTarget.value; if (!event.isComposing) updateSetValidity(); }); setNameInput?.addEventListener("compositionend", updateSetValidity);
  root.querySelectorAll('[data-action="studio-back"]').forEach((button) => button.addEventListener('click', () => { const mode = state.account.studioMode; state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; state.account.busy = false; if (mode === 'picker') state.account.studioMode = 'editor'; else if (mode === 'ai') state.account.studioMode = state.account.studioAiReturnMode === 'editor' ? 'editor' : 'list'; else { state.account.studioMode = 'list'; state.account.studioItems = []; state.account.selectedCards = new Set(); state.account.setName = undefined; state.account.editingDraftId = null; state.account.editingSetId = null; } if (mode !== 'ai' || state.account.studioMode === 'list') { state.account.aiQuestions = []; state.account.aiName = ''; state.account.aiTheme = ''; state.account.aiTone = ''; } render(); }));
  root.querySelector('[data-action="studio-picker"]')?.addEventListener('click', () => { state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; state.account.studioMode = 'picker'; render(); });
  root.querySelectorAll('[data-action="studio-remove-card"]').forEach((button) => button.addEventListener('click', () => { state.account.selectedCards.delete(button.dataset.cardId); state.account.studioItems = state.account.studioItems.filter((item) => item.cardId !== button.dataset.cardId); state.focusAction = 'studio-picker'; render(); }));
  root.querySelectorAll('[data-action="studio-remove-item"]').forEach((button) => button.addEventListener('click', () => { state.account.studioRequestId += 1; const index = Number(button.dataset.itemIndex); const item = state.account.studioItems[index]; if (item?.kind === 'saved') state.account.selectedCards.delete(item.cardId); state.account.studioItems.splice(index, 1); render(); }));
  root.querySelectorAll('[data-studio-item-text], [data-studio-custom-text]').forEach((input) => input.addEventListener('input', (event) => { const index = Number(event.currentTarget.dataset.itemIndex); const item = state.account.studioItems[index]; if (!item || item.kind !== 'custom') return; const value = event.currentTarget.value; item.text = value; }));
  root.querySelectorAll('[data-action="studio-replace-item"]').forEach((button) => button.addEventListener('click', () => { const index = Number(button.dataset.itemIndex); if (!Number.isInteger(index) || !state.account.studioItems[index]) return; state.account.studioReplaceIndex = index; state.account.studioMode = 'picker'; state.focusAction = 'studio-back'; render(); }));
  root.querySelectorAll('[data-ai-select]').forEach((input) => input.addEventListener('change', (event) => { const index = Number(event.currentTarget.dataset.aiIndex); if (state.account.aiQuestions[index]) state.account.aiQuestions[index].selected = event.currentTarget.checked; }));
  root.querySelectorAll('[data-ai-text]').forEach((input) => input.addEventListener('input', (event) => { const index = Number(event.currentTarget.dataset.aiIndex); if (state.account.aiQuestions[index]) state.account.aiQuestions[index].text = event.currentTarget.value; }));
  root.querySelector('[data-ai-r18]')?.addEventListener('change', (event) => { state.account.aiR18 = event.currentTarget.checked === true; });
  root.querySelector('[data-form="ai"]')?.addEventListener('submit', (event) => { event.preventDefault(); state.account.aiTheme = root.querySelector('[data-ai-theme]')?.value || ''; state.account.aiTone = root.querySelector('[data-ai-tone]')?.value || ''; state.account.aiCount = Number(root.querySelector('[data-ai-count]')?.value || 6); state.account.aiR18 = root.querySelector('[data-ai-r18]')?.checked === true; generateStudioQuestions(); });
  root.querySelector('[data-action="studio-ai-adopt"]')?.addEventListener('click', adoptStudioQuestions);
  root.querySelector('[data-action="studio-ai-discard"]')?.addEventListener('click', () => { state.account.studioRequestId += 1; state.account.busy = false; state.account.aiQuestions = []; state.account.aiName = ''; state.account.aiTheme = ''; state.account.aiTone = ''; state.account.aiR18 = false; state.account.studioMode = state.account.studioAiReturnMode === 'editor' ? 'editor' : 'list'; render(); });
  root.querySelector('form[data-form="studio"]')?.addEventListener('submit', (event) => { event.preventDefault(); state.account.setName = root.querySelector('[data-set-name]')?.value || ''; saveStudioDraft(); });
  root.querySelector('.studio-save-footer button[type="submit"]')?.addEventListener('click', (event) => { event.preventDefault(); state.account.setName = root.querySelector('[data-set-name]')?.value || ''; saveStudioDraft(); });
  root.querySelector(".card-back")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === ' ') { event.preventDefault(); playFlipSound(); const previous = ensureSession(); state.session = revealCard(previous); persist(previous); render(); } });
  updateAdultButton();
  const shareDialog = root.querySelector("[data-share-overlay]");
  const background = root.querySelectorAll(".topbar, .round-break");
  background.forEach((element) => { element.inert = Boolean(state.shareDialogOpen); });
  const pendingFocusSelector = state.focusSelector;
  const focusTarget = pendingFocusSelector ? root.querySelector(pendingFocusSelector) : state.focusAction ? root.querySelector(`[data-action="${state.focusAction}"]`) : null;
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
  registerWebMcp();
}
function frame(content, eyebrow = "Mingle.Cards", withHeader = true) { const quietText = state.session?.revealed && currentCard(state.session)?.kind === "challenge" ? "やりたくないお題はパスしてOK" : "話したくない質問はパスしてOK"; return `${withHeader ? `<header class="topbar"><button class="brand" data-action="home" aria-label="最初に戻る"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M6 7.5A3.5 3.5 0 0 1 9.5 4h9A3.5 3.5 0 0 1 22 7.5v7a3.5 3.5 0 0 1-3.5 3.5H14l-5 5v-5h-.5A3.5 3.5 0 0 1 5 14.5v-7Z" fill="currentColor"/><path d="M13 15.5A3.5 3.5 0 0 1 16.5 12h6A3.5 3.5 0 0 1 26 15.5v5a3.5 3.5 0 0 1-3.5 3.5H20l-3.5 3v-3h-.5a3.5 3.5 0 0 1-3.5-3.5v-5Z" fill="var(--coral)"/></svg></span><span>${eyebrow}</span></button><span class="quiet">${quietText}</span></header>` : ""}<section class="content">${content}</section>`;
}
function sharedView() {
  const shared = state.shared || {};
  const venueSet = syncSelectedVenueSet();
  const consent = state.venue ? venueSet?.adultOnly === true : shared.adultOnly === true;
  const registered = state.venue ? true : isRegisteredUser();
  const registrationNotice = consent && !registered ? `<p class="guest-theme-note">R18の共有セットは無料登録後に使えます。<button type="button" class="text-button" data-action="account" data-auth-return="true">ログイン / 新規登録</button></p>` : "";
  const consentControl = consent ? `<label class="adult-consent"><input type="checkbox" data-shared-adult ${state.adultConfirmed ? "checked" : ""} ${!registered ? "disabled" : ""} aria-disabled="${!registered}" /> ${registered ? "参加者全員が18歳以上で、R18の話題に同意します" : "登録後に参加者全員の同意を確認します"}</label>` : "";
  const venuePicker = state.venue ? `<label class="venue-picker"><span>店舗のおすすめテーマ</span><select data-venue-set aria-label="店舗のおすすめテーマ">${state.venue.sets.map((set) => `<option value="${esc(set.id)}" ${set.id === (venueSet?.id || '') ? 'selected' : ''}>${esc(set.name)}（${set.cardCount}枚${set.adultOnly ? '・R18' : ''}）</option>`).join('')}</select></label>` : '';
  const participantFields = `<div class="participant-list">${state.participants.map((name, index) => `<label class="name-field"><span class="name-avatar participant-color-${index}">${participantAvatar(name)}</span><input name="participant" data-index="${index}" value="${esc(name)}" maxlength="80" placeholder="${state.venue ? '呼び名（任意）' : '呼び名'}" aria-label="${index + 1}人目の呼び名" /></label>`).join("")}</div>`;
  const participantInput = state.venue ? `<label class="venue-count"><span>参加人数</span><select data-venue-count aria-label="参加人数">${Array.from({ length: MAX_PARTICIPANTS - 1 }, (_, index) => index + 2).map((count) => `<option value="${count}" ${count === state.participants.length ? "selected" : ""}>${count}人</option>`).join("")}</select></label><details class="venue-names"><summary>呼び名をつける（任意）</summary>${participantFields}</details>` : `${participantFields}<div class="inline-actions"><button type="button" class="text-button add-person" data-action="add-person" ${state.participants.length >= MAX_PARTICIPANTS ? "disabled" : ""}>＋ 参加者を追加</button>${state.participants.length > 2 ? '<button type="button" class="text-button muted" data-action="remove-person">最後の人を削除</button>' : ""}</div>`;
  const title = state.venue ? state.venue.venue.name : '共有されたマイセット';
  const welcome = state.venue?.venue.welcomeText ? `<p class="account-hint venue-welcome">${esc(state.venue.venue.welcomeText)}</p>` : "";
  const store = state.venue?.venue.storeUrl ? `<a class="text-button venue-store-link" href="${esc(state.venue.venue.storeUrl)}" target="_blank" rel="noopener noreferrer">店舗の公式サイト</a>` : "";
  const footer = state.venue ? `<div class="venue-footer-links">${store}<button type="button" class="back-link" data-action="home">通常のMingle.Cardsへ</button></div>` : `<button type="button" class="back-link" data-action="home">通常のMingle.Cardsへ</button>`;
  const landingHint = state.venue ? "テーマと人数を選んで、会話をはじめましょう。" : "質問内容は、参加者を入力して始めるまで表示されません。";
  return frame(`<div class="shared-landing${state.venue ? ' venue-landing' : ''}"><div class="shared-brand">${state.venue?.venue.logoUrl ? `<img src="${esc(state.venue.venue.logoUrl)}" alt="${esc(title)}" width="160" height="60" />` : '<img src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards" width="160" height="113" />'}</div><p class="eyebrow">${state.venue ? '店舗のおすすめカード' : '共有されたマイセット'}</p><h1 tabindex="-1" data-focus>${esc(state.venue ? title : (shared.name || "共有セット"))}</h1><p class="shared-meta">${state.venue ? esc(state.venue.table.label) : ''} ${Number.isFinite(shared.cardCount) ? `${shared.cardCount}枚` : ""}${consent ? " · R18を含みます" : ""}</p>${welcome}<p class="account-hint">${landingHint}</p>${registrationNotice}<form class="panel form-panel" data-form="shared-participants">${venuePicker}${participantInput}${consentControl}<p class="form-error" role="alert">${esc(state.error)}</p><button type="submit" class="primary-button" ${state.busy || state.sharedLoading || (consent && (!registered || !state.adultConfirmed)) ? "disabled" : ""}>${state.busy ? "開始中…" : "このセットで遊ぶ"}</button></form>${footer}${state.account.open ? accountView({ overlayOnly: true }) : ""}</div>`, state.venue ? "店舗カード" : "共有セット", false); }

function participantsView() {
  syncAccountParticipantName();
  const atLimit = state.participants.length >= MAX_PARTICIPANTS;
  const resumeCard = state.resume ? `<aside class="resume-card" aria-label="前回の続き"><strong>前回の続き</strong><span>${esc(state.resume.mixed ? "テーマミックス" : state.resume.customSet ? "マイセット" : decks.find((deck) => deck.id === state.resume.deckId)?.title || "会話カード")} · ${state.resume.cursor}/${state.resume.questions?.length || 40}</span><div><button type="button" class="primary-button" data-action="resume">続きから</button><button type="button" class="text-button muted" data-action="discard-resume">削除</button></div></aside>` : "";
  return frame(`<div class="home-screen">${accountView()}<div class="masthead-slot"><img class="masthead-image" src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards。やっぱり人って面白い。" width="1493" height="1054" /><h1 class="visually-hidden" tabindex="-1" data-focus>Mingle.Cards</h1></div>${resumeCard}<form class="panel form-panel" data-form="participants"><div class="participant-list">${state.participants.map((name, index) => `<label class="name-field"><span class="name-avatar participant-color-${index}">${participantAvatar(name)}</span><input name="participant" data-index="${index}" value="${esc(name)}" maxlength="80" placeholder="呼び名" aria-label="${index + 1}人目の呼び名" autocomplete="off" enterkeyhint="${index === state.participants.length - 1 ? "done" : "next"}" /></label>`).join("")}</div><div class="inline-actions"><button type="button" class="text-button add-person" data-action="add-person" ${atLimit ? "disabled" : ""}>＋ 参加者を追加</button>${state.participants.length > 2 ? '<button type="button" class="text-button muted" data-action="remove-person">最後の人を削除</button>' : ""}<span class="limit-note">${atLimit ? "8人まで" : ""}</span></div><p class="form-error" role="alert">${esc(state.error)}</p><button type="submit" class="primary-button">質問テーマを選ぶ</button></form><img class="home-illustration" src="/assets/friends-conversation-closeup.png" alt="会話を楽しむ人たちのイラスト" width="1611" height="976" loading="eager" />${renderAd("top")}<footer class="home-footer"><p><span>α版</span><span>開発：株式会社ErudAite</span></p><nav aria-label="ご案内"><a href="/terms.html">利用規約</a><a href="/privacy.html">プライバシーポリシー</a><a href="/personal-information.html">個人情報保護法に基づく公表事項</a></nav></footer></div>`, "Mingle.Cards", false);
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
  return accountDialog(`<div class="account-panel-head"><button type="button" class="text-button account-back" data-action="account-menu">戻る</button><strong id="account-dialog-title">マイセット</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div>${a.pendingSet ? '<p class="account-status">このセットにはR18カードが含まれます。参加者全員の同意が必要です。</p><button type="button" class="primary-button" data-action="confirm-set-play">同意して遊ぶ</button>' : ""}${renderLibrary({ ...a, replaceItemIndex: a.studioReplaceIndex, hideTitle: true })}`, "account-dialog-library");
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
  const url = typeof share.url === "string" ? share.url : "";
  const qr = a.qrBusy ? '<p class="account-hint" role="status">QRコードを作成中…</p>' : share.active === false ? '<p class="account-hint" role="status">この共有は停止中です。リンクを作り直してください。</p>' : typeof share.qrDataUrl === "string" && share.qrDataUrl.startsWith("data:image/") ? `<img class="share-qr" src="${esc(share.qrDataUrl)}" alt="共有リンクのQRコード" />` : `<p class="account-hint" role="status">${esc(a.qrError || "QRコードを作成できませんでした。リンクをコピーして共有できます。")}</p>`;
  return accountDialog(`<div class="account-panel-head"><button type="button" class="text-button account-back" data-action="share-close">戻る</button><strong id="account-dialog-title">セットを共有</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div><p class="account-share-title">${esc(share.name || "マイセット")}</p><p class="account-hint">${Number.isFinite(share.cardCount) ? `${share.cardCount}枚` : ""}${share.adultOnly === true ? " · R18を含む" : ""}。リンクを知っている人は、最初の6枚を登録なしで遊べます。</p>${url ? `<label class="account-share-url">共有リンク<input readonly value="${esc(url)}" data-share-url /></label>${share.active === false ? "" : `<div class="share-actions"><button type="button" class="primary-button" data-action="share-copy">リンクをコピー</button><button type="button" class="secondary-button" data-action="share-native">端末で共有</button></div>`}${qr}` : '<p class="account-hint">共有リンクはまだ発行されていません。</p>'}<div class="share-actions"><button type="button" class="secondary-button" data-action="share-rotate" ${a.shareBusy ? "disabled" : ""}>${url ? "リンクを作り直す" : "リンクを発行"}</button>${url && share.active !== false ? `<button type="button" class="text-button" data-action="share-stop" ${a.shareBusy ? "disabled" : ""}>共有を停止</button>` : ""}</div>${a.error ? `<p class="form-error" role="alert">${esc(a.error)}</p>` : ""}${a.status ? `<p class="account-status" role="status">${esc(a.status)}</p>` : ""}`, "account-dialog-share");
}
function accountSettingsView(a) {
  if (a.deleteOpen) return accountDialog(`<div class="account-panel-head"><button type="button" class="text-button" data-action="account-settings">戻る</button><strong id="account-dialog-title">退会の確認</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div><div class="account-delete-warning"><p>退会すると、このアカウントの表示名・お気に入り・自作質問カード・非公開マイセットを削除します。</p><p>このアカウントが所有する店舗設定・提供テーマ・卓上QR・利用集計も削除されます。</p><p>この端末の呼び名と途中データも削除されます。</p><p>削除後は取り消せません。</p><label class="account-delete-confirm-label"><input type="checkbox" data-delete-confirm ${a.deleteConfirmed ? "checked" : ""} ${a.busy ? "disabled" : ""}/> 内容を確認しました</label></div>${a.error ? `<p class="form-error" role="alert">${esc(a.error)}</p>` : ""}<div class="account-delete-actions"><button type="button" class="text-button" data-action="account-delete-cancel" ${a.busy ? "disabled" : ""}>キャンセル</button><button type="button" class="danger-button" data-action="account-delete-confirm" ${a.busy || !a.deletionAvailable || !a.deleteConfirmed ? "disabled" : ""}>${a.busy ? "削除中…" : "退会して削除"}</button></div>`, "account-dialog-delete");
  const valid = validDisplayName(a.profileDraft);
  return accountDialog(`<div class="account-panel-head"><button type="button" class="text-button" data-action="account-menu">戻る</button><strong id="account-dialog-title">アカウント設定</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div>${avatarSettingsView(a)}<form class="account-settings-form" data-form="profile"><label>表示名<input type="text" data-profile-name value="${esc(a.profileDraft)}" maxlength="80" autocomplete="nickname" ${a.busy ? "disabled" : ""}/></label><p class="account-hint">1人目の呼び名に自動入力されます。遊ぶときに変更できます。</p><p class="account-email">${esc(a.user?.email || "")}</p><button type="submit" class="primary-button" ${a.busy || !valid ? "disabled" : ""}>${a.busy ? "保存中…" : "表示名を保存"}</button></form>${a.status ? `<p class="account-status" role="status">${esc(a.status)}</p>` : ""}${a.error ? `<p class="form-error" role="alert">${esc(a.error)}</p>` : ""}<section class="account-delete-section"><h2>退会</h2>${a.deletionAvailable ? `<button type="button" class="danger-button" data-action="account-delete-open" ${a.avatarBusy ? "disabled" : ""}>アカウントを削除</button>` : '<p class="account-hint">退会手続きは現在利用できません。</p><a class="account-support" href="mailto:inquiry@erudaite.ai">問い合わせる</a>'}</section>`, "account-dialog-settings");
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
  if (a.user) return wrap(accountDialog(`<div class="account-panel-head"><strong id="account-dialog-title">アカウント</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div><div class="account-menu-avatar"><span class="account-avatar">${accountAvatar(a.user)}</span></div>${a.user.displayName ? `<p class="account-display-name">${esc(a.user.displayName)}</p>` : ""}<p class="account-email">${esc(a.user.email || a.user.name || "ログイン中")}</p><button type="button" class="secondary-button account-menu-action" data-action="account-settings-open">アカウント設定</button><button type="button" class="secondary-button account-menu-action" data-action="account-library-open">保存したカード・マイセット</button><a class="secondary-button account-menu-action" href="/venue.html">店舗管理</a><button type="button" class="text-button account-menu-action" data-action="logout">ログアウト</button>${a.error ? `<p class="form-error" role="alert">${esc(a.error)}</p>` : ""}`, "account-dialog-menu"));
  return wrap(accountDialog(`<div class="account-panel-head"><strong id="account-dialog-title">${state.continuePending ? "ログイン / 新規登録" : "ログインする"}</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div>${a.google ? '<button type="button" class="secondary-button account-provider" data-action="google-login">Googleで続ける</button>' : ""}<form class="account-otp" data-form="account"><label>メールアドレス<input type="email" data-account-email value="${esc(a.email)}" required autocomplete="email" /></label>${a.otpSent ? '<label>確認コード<input inputmode="numeric" data-account-otp value="' + esc(a.otp) + '" required autocomplete="one-time-code" /></label><button type="button" class="text-button muted" data-action="reset-otp"' + (a.busy ? " disabled" : "") + ">メールアドレスを変更／コードを再送</button>" : ""}<button type="submit" class="primary-button">${a.busy ? "処理中…" : a.otpSent ? "ログインする" : "確認コードを送る"}</button></form><p class="account-status" role="status">${esc(a.status || "ログインすると質問を保存できます")}</p><p class="form-error" role="alert">${esc(a.error)}</p>`, "account-dialog-login"));
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
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[deck.id] ?? paths.team}</svg>`;
}
function decksView() {
  const mixed = state.themeMode === "mixed";
  const mySets = !mixed && isRegisteredUser() ? playableSavedSets(state.account.sets, state.account.customCards) : [];
  const selectedMySet = mySets.find((set) => set.id === state.selectedMySetId) || null;
  const selected = (decks.find((deck) => deck.id === state.selectedDeckId && canUseDeck(deck)) ?? decks.find((deck) => canUseDeck(deck)) ?? decks.find((deck) => deck.id === state.selectedDeckId) ?? decks.find((deck) => !deck.adultOnly) ?? decks[0]);
  const regularDecks = decks.filter((deck) => !deck.adultOnly), r18Decks = decks.filter((deck) => deck.adultOnly);
  const visible = (deck) => state.filter === "all" || (state.filter === "adult" ? deck.adultOnly || deck.r18Available : !deck.adultOnly && themeGroups[deck.id]?.includes(state.filter));
  const option = (deck) => { const checked = mixed ? state.selectedDeckIds.includes(deck.id) : !selectedMySet && deck.id === selected.id; const available = canUseDeck(deck); const locked = !available; const control = mixed ? `<input type="checkbox" name="deck" value="${esc(deck.id)}" data-deck-select ${checked ? "checked" : ""} ${locked ? "disabled" : ""} aria-disabled="${locked}" />` : `<input type="radio" name="deck" value="${esc(deck.id)}" data-deck-select ${checked ? "checked" : ""} ${locked ? "disabled" : ""} aria-disabled="${locked}" />`;
    return `<label class="deck-option theme-card-${esc(deck.id)} ${checked ? "is-selected" : ""} ${locked ? "is-locked" : ""}" aria-disabled="${locked}">${control}<span class="topic-icon topic-${esc(deck.id)}">${topicIcon(deck)}</span><span class="deck-option-copy"><strong>${esc(deck.title)}</strong><small>${esc(deck.subtitle)}</small></span><span class="deck-count">${locked ? '🔒 登録で解放' : '40枚'}</span></label>`; };
  const filters = Object.entries(groupLabels).filter(([id]) => !(mixed && id === "adult"))
    .map(([id, label]) => `<button type="button" class="filter-chip ${state.filter === id ? "is-active" : ""}" data-filter="${id}">${label}</button>`)
    .join("");
  const chips = state.selectedDeckIds.map((id) => { const deck = decks.find((item) => item.id === id); return deck ? `<span class="selected-theme-chip">${esc(deck.title)}<button type="button" data-remove-deck="${esc(id)}" aria-label="${esc(deck.title)}を外す">×</button></span>` : "";
    })
    .join("");
  const consent = !mixed && (selected.r18Available || selected.adultOnly), consentCopy = selected.r18Available ? "R18を含めていい" : "参加者全員が18歳以上で、R18の話題に同意しています";
  const description = selected.adultOnly ? `<p class="deck-description">${esc(selected.description)}</p>` : "";
  const pool = (mixed ? regularDecks : state.filter === "adult" ? r18Decks : regularDecks).filter(visible).sort((a, b) => Number(canUseDeck(b)) - Number(canUseDeck(a)));
  const adultPool = !mixed && state.filter === "all" ? r18Decks.filter(visible) : [];
  const availablePool = pool.filter((deck) => canUseDeck(deck));
  const lockedPool = pool.filter((deck) => !canUseDeck(deck));
  const regularIds = new Set(regularDecks.map((deck) => deck.id));
  const canStart = mixed ? state.selectedDeckIds.length >= 2 && state.selectedDeckIds.length <= 3 && new Set(state.selectedDeckIds).size === state.selectedDeckIds.length && state.selectedDeckIds.every((id) => regularIds.has(id) && canUseDeck(decks.find((deck) => deck.id === id))) : Boolean(selected && canUseDeck(selected));
  const registrationNotice = !isRegisteredUser() ? `<p class="guest-theme-note">無料登録ですべてのテーマが使えます。<button type="button" class="text-button" data-action="account" data-auth-return="true">ログイン / 新規登録</button></p>` : "";
  const mySetConsent = selectedMySet?.hasR18 ? `<label class="consent selected-consent"><input type="checkbox" data-adult="my-set" ${state.adultConfirmed ? "checked" : ""} ${!isRegisteredUser() ? "disabled" : ""} /> <span><strong>参加者全員が18歳以上で、R18の話題に同意しています</strong><small>このマイセットにはR18の質問が含まれています。</small></span></label>` : "";
  const themeControls = `<div class="theme-options">${selectedMySet ? "" : `<label class="consent challenge-toggle"><input type="checkbox" data-challenges ${state.includeChallenges ? "checked" : ""} /> <span><strong>「やってみて」を入れる</strong><small>6枚につき1枚、みんなで楽しむお題が入ります。</small></span></label>`}${selectedMySet ? mySetConsent : `${description}${consent ? `<label class="consent selected-consent"><input type="checkbox" data-adult="${esc(selected.id)}" ${state.adultConfirmed ? "checked" : ""} ${!isRegisteredUser() ? "disabled" : ""} aria-disabled="${!isRegisteredUser()}" /> <span><strong>${isRegisteredUser() ? consentCopy : "R18の話題に同意しています"}</strong><small>${isRegisteredUser() ? (selected.r18Available ? "6枚につき1問。全員が18歳以上で、話題に同意できるときに。" : "全員が18歳以上で、話題に同意できるときに。") : "ログイン / 新規登録後に、年齢と参加者全員の同意を確認できます。"}</small></span></label>` : ""}`}<p class="form-error" role="alert">${esc(state.error)}</p><button class="primary-button deck-start selected-start" data-action="${selectedMySet ? "choose-myset-start" : "choose-deck"}" ${selectedMySet ? `data-set-id="${esc(selectedMySet.id)}"` : `data-deck="${esc(selected.id)}"`} ${selectedMySet ? (selectedMySet.hasR18 && !state.adultConfirmed ? "disabled" : "") : (!canStart || (!mixed && selected.adultOnly && !state.adultConfirmed) ? "disabled" : "")}>${selectedMySet ? "このマイセットで始める" : mixed ? "ミックスで始める" : "このテーマで始める"}</button></div>`;
  const lockedSection = !isRegisteredUser() && lockedPool.length ? `<p class="theme-group-label guest-locked-label">無料登録で使えるテーマ</p>${lockedPool.map(option).join("")}` : lockedPool.map(option).join("");
  const groupLabel = `<p class="theme-group-label">${mixed ? "通常テーマ" : state.filter === "adult" ? "18歳以上のテーマ" : "テーマ"}</p>`;
  const adultMarkup = adultPool.length ? `<p class="theme-group-label">R18のテーマ</p>${adultPool.map(option).join("")}` : "";
  const deckMarkup = isRegisteredUser()
    ? `${groupLabel}${pool.map(option).join("") || '<p class="limit-note">この絞り込みに合うテーマはありません。</p>'}${adultMarkup}`
    : `${groupLabel}${availablePool.map(option).join("") || '<p class="limit-note">この絞り込みに合うテーマはありません。</p>'}`;
  const guestLockedMarkup = !isRegisteredUser() && lockedPool.length ? `<div class="deck-list guest-locked-list" role="group" aria-label="登録で使える質問テーマ">${lockedSection}${adultMarkup}</div>` : "";
  const mySetsMarkup = mySets.length ? `<section class="my-set-section" aria-labelledby="my-set-heading"><div class="my-set-section-head"><h2 id="my-set-heading">マイセット</h2><span>${mySets.length}件</span></div><div class="my-set-grid">${mySets.map((set) => `<article class="my-set-option ${selectedMySet?.id === set.id ? "is-selected" : ""}"><div><strong>${esc(set.name || "名前のないセット")}</strong><small>${set.cardCount}枚${set.hasR18 ? " · R18を含む" : ""}</small></div><button type="button" class="secondary-button" data-action="choose-myset" data-set-id="${esc(set.id)}">${selectedMySet?.id === set.id ? "選択中" : "選択"}</button></article>`).join("")}</div></section>` : "";
  return frame(`<div class="theme-screen"><div class="screen-brand"><button class="back-link" data-action="home" aria-label="参加者を変更する">‹</button><strong>Mingle.Cards</strong></div><div class="intro compact"><h1 tabindex="-1" data-focus>質問テーマを選ぶ</h1></div>${registrationNotice}<div class="mode-switch" role="radiogroup" aria-label="テーマモード"><label><input type="radio" name="theme-mode" value="single" data-mode ${!mixed ? "checked" : ""}/> 1つのテーマ</label><label><input type="radio" name="theme-mode" value="mixed" data-mode ${mixed ? "checked" : ""}/> テーマミックス</label></div>${mixed ? `<p class="mode-hint">通常テーマから2〜3個を選びます。${state.selectedDeckIds.length}/3</p><div class="selected-theme-chips">${chips || '<span class="limit-note">テーマを2つ選んでください</span>'}</div>` : `<p class="selected-single-theme">選択中：${esc(selectedMySet ? selectedMySet.name || "マイセット" : selected.title)}</p>`}${mySetsMarkup}${selectedMySet ? themeControls : ""}<div class="filter-chips" role="toolbar" aria-label="テーマを絞り込む">${filters}</div><div class="deck-list" role="group" aria-label="質問テーマ">${deckMarkup}</div>${!isRegisteredUser() && !selectedMySet ? themeControls : ""}${guestLockedMarkup}${isRegisteredUser() && !selectedMySet ? themeControls : ""}${state.account.open ? accountView({ overlayOnly: true }) : ""}</div>`, "Mingle.Cards", false);
}

function participantChips(session) { return session.participants.map((name, index) => { const initial = Array.from(name.trim())[0] ?? '・'; return `<span class="participant-chip participant-color-${index} ${index === currentParticipantIndex(session) ? "is-current" : ""}"><i aria-hidden="true">${esc(initial)}</i>${esc(name)}</span>`;
    })
    .join(""); }
function cardAudioButton() { return `<button type="button" class="card-audio-toggle" data-action="audio-toggle" aria-label="カードをめくる音を${isCardAudioEnabled() ? "オフ" : "オン"}にする" aria-pressed="${isCardAudioEnabled()}">${isCardAudioEnabled() ? "🔊" : "🔇"}</button>`; }

function playView() {
  const session = state.session;
  if (isFinished(session)) return finishView();
  if (isRoundComplete(session) && !session.revealed) return roundView();
  if (!session.revealed) return backView(session);
  const card = currentCard(session);
  const currentIndex = currentParticipantIndex(session);
  const progress = Math.round((session.cursor / session.questions.length) * 100);
  const roundPosition = session.cursor % ROUND_SIZE;
  const roundTotal = Math.min(ROUND_SIZE, remaining(session) + roundPosition);
  const segments = Array.from({ length: roundTotal }, (_, index) => `<span class="round-segment ${index < roundPosition ? "is-done" : ""} ${index === roundPosition ? "is-current" : ""}"></span>`).join("");
  const isChallenge = card.kind === "challenge";
  const playTitle = session.sharedGuest
    ? session.setName || "共有セット"
    : session.customSet
      ? "マイセット"
      : session.mixed
        ? `テーマミックス · ${session.deckIds
            .map((id) => decks.find((deck) => deck.id === id)?.title)
            .filter(Boolean)
            .join("・")}`
        : (decks.find((deck) => deck.id === session.deckId)?.title ?? "会話カード");
  const favorite = state.account.user && state.account.enabled && card.kind !== "challenge" && !card.custom ? `<button type="button" class="favorite-card-button ${state.account.favorites.has(card.id) ? "is-saved" : ""}" data-action="favorite-card" aria-pressed="${state.account.favorites.has(card.id)}" ${state.account.busy ? "disabled" : ""}>${state.account.favorites.has(card.id) ? "★ 保存済み" : "☆ 保存"}</button>` : "";
  return frame(`<div class="play-head"><div><p class="play-deck">${esc(playTitle)}</p><p class="progress-copy" aria-label="全${session.questions.length}枚中${session.cursor + 1}枚目">${roundPosition + 1} / ${roundTotal}</p></div><button class="quiet-button" data-action="decks">テーマを変える</button></div><div class="round-progress" aria-label="今回の進み具合">${segments}</div><article class="question-card active-card ${isChallenge ? "challenge-card" : ""}" aria-live="polite">${isChallenge ? '<span class="challenge-badge">やってみて</span>' : ""}${favorite}${cardAudioButton()}<p>${esc(card.text)}</p></article><div class="speaker-pill"><strong>${esc(currentSpeaker(session))}の番</strong><span>${session.answerIndex + 1} / ${session.participants.length}</span></div><div class="participant-strip" aria-label="参加者">${participantChips(session)}</div><div class="answer-actions" role="group" aria-label="回答操作"><button class="secondary-button" data-action="previous-answer" ${session.answerIndex === 0 || state.busy ? "disabled" : ""}>前の人へ</button><button class="like-button" data-action="like" ${state.busy ? "disabled" : ""}>♡ <span>${esc(currentSpeaker(session))}${isChallenge ? "にいいね！" : "の回答にいいね！"}</span> <strong>${currentAnswerLikes(session)}</strong></button><button class="primary-button" data-action="next-answer" ${state.busy ? "disabled" : ""}>${session.answerIndex === session.participants.length - 1 ? "次のカードへ" : "次の人へ"}</button><button class="pass-button" data-action="pass" ${state.busy ? "disabled" : ""}>パスする</button></div><p class="form-error" role="alert">${esc(state.error)}</p>`);
}

function backView(session) { const roundPosition = session.cursor % ROUND_SIZE; const roundTotal = Math.min(ROUND_SIZE, remaining(session) + roundPosition); return frame(`<div class="card-back-wrap"><div class="card-back" data-action="reveal" role="button" tabindex="0" aria-label="カードをめくる"><span class="round-badge">${roundPosition + 1} / ${roundTotal}</span><div class="back-brand"><span class="back-brand-mark" aria-hidden="true"><svg viewBox="0 0 56 56"><path d="M9 12A6 6 0 0 1 15 6h16a6 6 0 0 1 6 6v13a6 6 0 0 1-6 6H24L14 35v-4h-1a6 6 0 0 1-6-6V12Z" fill="currentColor"/><path d="M23 28a6 6 0 0 1 6-6h10a6 6 0 0 1 6 6v9a6 6 0 0 1-6 6h-4l-6 6v-6h-0a6 6 0 0 1-6-6v-9Z" fill="var(--coral)"/></svg></span><strong>Mingle.Cards</strong></div><h1 tabindex="-1" data-focus>タップしてめくる</h1></div>${cardAudioButton()}</div>`); }

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
  if (session.sharedGuest) return session.setName || "共有セット";
  if (session.customSet) return session.setName || state.account.sets.find((set) => set.id === session.setId)?.name || "マイセット";
  if (session.mixed) return session.deckIds.map((id) => decks.find((item) => item.id === id)?.title).filter(Boolean).join("・") || "テーマミックス";
  return decks.find((item) => item.id === session.deckId)?.title || "会話テーマ";
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
  const totalCards = session.questions.length; const isFinal = session.cursor >= totalCards; const feedback = feedbackState(session); const submitted = feedbackSubmitted(session);
  const favoriteContext = roundFavoriteContext(session); const favoriteBusy = Boolean(favoriteContext?.saving);
  const endingLink = isActiveVenueSession() && state.venue?.venue.endingUrl ? `<a class="venue-ending-link" href="${esc(state.venue.venue.endingUrl)}" target="_blank" rel="noopener noreferrer">店舗の公式SNS/サイトを見る</a>` : "";
  const feedbackForm = submitted ? '<p class="feedback-success" role="status">フィードバック送信済み。ありがとう！</p>' : `<details class="round-feedback-details" data-round-feedback ${state.roundFeedbackExpanded ? "open" : ""}><summary>α版アンケート <span>ご意見をお聞かせください</span></summary><div class="feedback-box" aria-labelledby="feedback-title"><h2 id="feedback-title" class="feedback-survey-title">α版アンケート</h2><p id="feedback-survey-description" class="feedback-survey-description">今回のミングルについて意見をきかせてください。どうすればもっと楽しめますか？</p><div class="feedback-ratings" role="group" aria-label="評価"><button type="button" class="feedback-rating ${feedback.rating === "positive" ? "is-selected" : ""}" data-action="feedback-rating" data-rating="positive" aria-pressed="${feedback.rating === "positive"}" ${state.feedbackBusy ? "disabled" : ""}>いいね！</button><button type="button" class="feedback-rating ${feedback.rating === "needs_improvement" ? "is-selected" : ""}" data-action="feedback-rating" data-rating="needs_improvement" aria-pressed="${feedback.rating === "needs_improvement"}" ${state.feedbackBusy ? "disabled" : ""}>改善余地大きい！</button></div><label class="feedback-label" for="feedback-text">ひとこと（任意）</label><textarea id="feedback-text" data-feedback-text maxlength="1000" rows="3" placeholder="気づいたことがあれば" ${state.feedbackBusy ? "disabled" : ""}>${esc(feedback.text)}</textarea><p class="form-error" role="alert">${esc(feedback.error)}</p><button type="button" class="secondary-button feedback-submit" data-action="feedback-submit" ${state.feedbackBusy || (!feedback.rating && !feedback.text.trim()) ? "disabled" : ""}>${state.feedbackBusy ? "送信中…" : "送信する"}</button></div></details>`;
  const accountOverlay = state.account.open ? accountView({ overlayOnly: true }) : "";
  return frame(`<div class="round-break">${renderAd("round")}<img class="round-hero" src="/assets/friends-conversation-closeup.png" alt="会話を楽しむ人たち" width="1611" height="976" /><span class="round-badge">${session.cursor} / ${totalCards}</span><h1 tabindex="-1" data-focus>今回のミングルは<br>どうだった？</h1><div class="break-actions">${!isFinal ? `<button class="primary-button" data-action="continue" ${state.busy || favoriteBusy ? "disabled" : ""}>${state.busy ? "確認中…" : "続きを遊ぶ"}</button>` : ""}<button class="secondary-button" data-action="finish" ${favoriteBusy ? "disabled" : ""}>今日はここまで</button><button class="secondary-button social-share-button" data-action="social-share" ${favoriteBusy ? "disabled" : ""}>SNSでシェア</button></div>${likeTotalsView(session)}${roundFavoriteView(session)}${feedbackForm}${endingLink}${state.shareStatus ? `<p class="account-status" role="status">${esc(state.shareStatus)}</p>` : ""}${state.shareFallbackText ? `<label class="share-fallback-label">共有文<textarea readonly data-share-fallback rows="4">${esc(state.shareFallbackText)}</textarea></label>` : ""}<p class="form-error" role="alert">${esc(state.error)}</p><button class="back-link" data-action="decks" ${favoriteBusy ? "disabled" : ""}>テーマを選び直す</button></div>${state.shareDialogOpen ? roundShareDialogView() : ""}${accountOverlay}`);
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
  let continueAfterLogin = false;
  let resumeAfterLogin = null;
  const current = () => generation === state.account.generation && profileRevision === state.account.profileRevision && avatarRevision === state.account.avatarRevision;
  try {
    const me = await accountApi.me();
    if (!current()) return;
    state.account.user = normalizeAccountUser(me.user || null, state.account.user);
    state.account.avatarUrl = avatarImageSrc(state.account.user?.avatarUrl);
    if (!state.account.avatarBusy && !state.account.avatarDraft) state.account.avatarError = "";
    state.account.deletionAvailable = me.account?.deletionAvailable === true;
    state.account.customCardsAvailable = me.customCardsAvailable === true;
    state.account.draftsAvailable = me.draftsAvailable === true; state.account.completionAvailable = me.account?.completionAvailable === true; state.account.aiGenerationAvailable = me.aiGenerationAvailable === true; state.account.drafts = Array.isArray(me.drafts) ? me.drafts : [];
    state.account.customCards = state.account.customCardsAvailable && Array.isArray(me.customCards) ? me.customCards.map((card) => ({ ...card, id: typeof card.id === "string" && card.id.startsWith("custom:") ? card.id : `custom:${card.id}`,
          }))
        : [];
    state.account.profileDraft = state.account.user?.displayName || "";
    syncAccountParticipantName();
    if (state.account.user) {
      restoreAuthReturnIntent();
      if (!current()) return;
      state.account.favorites = new Set((me.favorites || []).map((item) => item.cardId || item.card_id || item.id || item));
      state.account.sets = (me.sets || []).map((set) => ({ ...set, cards: set.cards || (set.card_ids || []).map((cardId) => ({ cardId })),
      }));
      const loginContext = state.roundFavorite;
      if (loginContext?.loginPending && state.session && isCurrentRoundFavorite(loginContext, state.session, loginContext.key)) { loginContext.loginPending = false; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.focusAction = "round-favorite-save"; }
      if (isContinuePendingCurrent()) { continueAfterLogin = true; state.continuePending = null; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.account.status = ""; state.focusAction = "continue"; }
      if (state.account.returnAfterAuth) { state.account.returnAfterAuth = false; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.account.status = ""; }
      if (state.continuePending?.kind === "resume" && state.continuePending.sessionId === state.resume?.sessionId) { resumeAfterLogin = state.continuePending.snapshot; state.continuePending = null; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.account.status = ""; state.focusAction = "resume"; }
      const pending = state.pendingCustomResume;
      if (pending) {
        if (state.account.customCardsAvailable && pending.ownerUserId === state.account.user.id) state.resume = pending;
        else clearSession();
        state.pendingCustomResume = null;
      }
    }
  } catch { if (!current()) return; state.account.user = null; state.account.authReady = true; if (state.continuePending) { state.account.status = ""; state.account.error = "ログイン状態を確認できませんでした。時間をおいて、もう一度お試しください。"; } }
  if (!current()) return;
  state.account.authReady = true;
  if (resumeAfterLogin) resumeSaved(resumeAfterLogin);
  else render();
  if (continueAfterLogin) continueCurrentRound();
}
async function loginWithOtp() {
  const email = state.account.email.trim();
  if (!email || state.account.busy) return;
  state.account.busy = true; state.account.error = "";
  state.account.status = ""; render();
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
    const payload = { name, items, ...(!state.account.editingDraftId && state.account.editingSetId ? { sourceSetId: state.account.editingSetId } : {}) };
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
  try { const result = await accountApi.generateAiQuestions({ theme: (state.account.aiTheme || '').trim(), tone: (state.account.aiTone || '').trim() || '自然であたたかい', count: state.account.aiCount === 12 ? 12 : 6, r18: state.account.aiR18 === true }); if (generation !== state.account.generation || requestId !== state.account.studioRequestId) return; state.account.aiName = typeof result.name === 'string' ? result.name.trim() : ''; state.account.aiQuestions = (result.questions || []).map((question) => ({ text: question.text || '', r18: question.r18 === true, selected: true })); state.account.status = ''; }
  catch (error) { if (generation === state.account.generation && requestId === state.account.studioRequestId) state.account.error = error?.status === 404 ? 'AIセット作成は現在利用できません。' : 'AI案を作成できませんでした。'; }
  finally { if (generation === state.account.generation && requestId === state.account.studioRequestId) { state.account.busy = false; render(); } }
}
async function adoptStudioQuestions() {
  if (state.account.busy) return;
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
  const generation = state.account.generation; const id = state.account.editingCardId; const text = state.account.customDraft.trim(); const r18 = state.account.customDraftR18 === true;
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
  } catch {
    if (generation === state.account.generation) state.account.error = "質問カードを保存できませんでした。"; }
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
    state.account.revealAdult = false;
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
  const hasR18 = ids.some((id) => canonicalCard(id, state.account.customCards)?.r18 === true);
  if (hasR18 && !state.account.pendingSet?.consented) { state.account.pendingSet = { set, consented: false }; state.account.open = true; state.account.libraryOpen = true; state.account.error = ""; render(); return; }
  state.session = createSavedSession({ participants: state.participants, cardIds: ids, customCards: state.account.customCards, ownerUserId: state.account.user?.id || null, adultConfirmed: state.account.pendingSet?.consented === true,
  });
  state.session.setName = set?.name || "マイセット";
  state.account.pendingSet = null;
  state.account.open = false;
  state.account.status = "";
  state.account.error = ""; state.account.selectedCards = new Set(); state.account.editingSetId = null; state.account.setName = undefined; state.account.revealAdult = false; state.feedback = null; state.feedbackBusy = false; state.resume = null; state.screen = "play";
  state.error = "";
  trackThemeStart("my-set");
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
  if (!venueMode && shared.adultOnly === true && !isRegisteredUser()) {
    state.error = "R18の共有セットは無料登録後に使えます。";
    state.account.open = true;
    state.account.status = state.error;
    state.focusSelector = "[data-account-email]";
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
    const result = venueMode ? await accountApi.startVenue(token, state.selectedVenueSetId, participants, adultConfirmed) : await accountApi.startSharedSet(token, participants, adultConfirmed);
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
    const session = createSharedSession({
      participants: result.participants || participants,
      cards,
      customCards,
      adultConfirmed,
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
    render();
  } catch (error) {
    if (requestId !== state.sharedRequestId) return;
    if (error?.status === 401 && shared.adultOnly === true && state.account.enabled) { state.account.open = true; state.account.status = "R18の共有セットは、無料登録後に年齢同意を確認して遊べます。"; state.focusSelector = "[data-account-email]"; state.error = "ログインまたは新規登録してください。"; }
    else state.error = error?.status === 403 ? "R18の話題には参加者全員の同意が必要です。" : "共有セットを開始できませんでした。リンクが停止された可能性があります。";
    state.busy = false;
    render();
  }
}
function submitParticipants() {
  try {
    state.participants = normalizeParticipants(state.participants);
    state.screen = "decks";
    state.error = ""; render(); } catch (error) { state.error = error.message; const invalidIndex = state.participants.findIndex((name) => typeof name !== "string" || !name.trim() || Array.from(name.trim()).length > MAX_NAME_LENGTH); state.focusSelector = `input[data-index="${Math.max(0, invalidIndex)}"]`; render(); } }
function updateAdultButton() { if (state.themeMode === "mixed") return;
  const button = root.querySelector(".selected-start"); const selected = decks.find((deck) => deck.id === state.selectedDeckId); const selectedMySet = playableSavedSets(state.account.sets, state.account.customCards).find((set) => set.id === state.selectedMySetId); if (button && (selected?.adultOnly || selectedMySet?.hasR18)) button.disabled = !state.adultConfirmed || state.busy; }
function ensureSession() { if (!state.session) throw new Error("セッションが始まっていません");
  return state.session;
}
function saveCurrentSession(session) {
  if (session?.sharedGuest) return;
  saveSession(session); }
function persist(previous = null) { if (!state.session) return; if (previous) trackSessionProgress(previous, state.session); if (state.session.sharedGuest) return;
  if (state.session.cursor >= state.session.questions.length) clearSession();
  else saveCurrentSession(state.session); }
function advanceGuarded(action) { ensureSession(); const now = Date.now(); if (now - state.lastAdvanceAt < 300) return false; state.lastAdvanceAt = now; const previous = state.session; state.busy = true; render(); state.session = action(state.session); state.busy = false; persist(previous); if (isActiveVenueSession() && previous.cursor < state.session.cursor && state.session.cursor > 0 && state.session.cursor % ROUND_SIZE === 0) accountApi.venueEvent(state.venue.token, { eventType: "completed_round", setId: state.session.venueSetId, session: state.session.venueSession, roundIndex: state.session.cursor / ROUND_SIZE }).catch(() => {}); render(); return true; }
function resumeSaved(snapshot = null) { const fresh = snapshot || loadResumeForCurrentUser(); if (!fresh) { state.resume = null; state.error = "保存期限が切れています。"; render(); return; } const needsAuth = fresh.cursor >= 6 && fresh.unlockedUntil > 6; const lockedTheme = sessionNeedsRegistration(fresh); if ((needsAuth || lockedTheme) && !state.account.authReady) { state.resume = fresh; state.error = "ログイン状態を確認しています。少し待ってからお試しください。"; render(); return; } if ((needsAuth || lockedTheme) && !state.account.user) { state.resume = fresh; if (!state.account.enabled) { state.error = "ログイン設定を利用できないため、続きを再開できません。"; render(); return; } state.continuePending = { kind: "resume", sessionId: fresh.sessionId, snapshot: fresh }; state.account.open = true; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.account.error = ""; state.account.status = lockedTheme ? "このテーマは無料登録で使えます。ログインまたは新規登録してください。" : "ログインまたは新規登録で、続きを無料で楽しめます。"; state.focusSelector = "[data-account-email]"; render(); return; } state.resume = fresh; state.session = fresh; state.participantNameOrigin = null; state.participantNameAutoValue = ""; state.participantNameUserEdited = true; state.participants = [...state.session.participants]; state.selectedDeckIds = [...(state.session.deckIds || [state.session.deckId])]; state.selectedDeckId = state.session.mixed ? state.selectedDeckIds[0] : state.session.deckId; state.themeMode = state.session.mixed ? "mixed" : "single"; state.includeChallenges = state.session.includeChallenges === true; state.adultConfirmed = state.session.adultConfirmed === true; state.screen = "play";
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
async function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  if (action === "audio-toggle") { event.stopPropagation(); state.focusAction = "audio-toggle"; toggleCardAudio(); render(); return; }
  if (state.busy && action !== "continue" && action !== "home") return;
  state.focusAction = action;
  if (action === "reveal") { playFlipSound(); const previous = ensureSession(); state.session = revealCard(previous); persist(previous); render(); return; }
  if (action === "home") {
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
    state.resume = loadResumeForCurrentUser();
    state.screen = "participants";
    state.session = null;
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
    clearAccountShare({ close: true }); state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.focusAction = "account";
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
    state.account.status = ""; state.account.settingsOpen = true; state.account.libraryOpen = false; state.account.deleteOpen = false; state.account.profileDraft = state.account.user?.displayName || "";
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
    state.continuePending = null;
    clearAccountShare({ close: true });
    state.shareStatus = "";
    state.shareMenuOpen = false; state.shareFallbackText = "";
    state.sharedRequestId += 1;
    state.shared = null;
    state.sharedLoading = false;
    const generation = ++state.account.generation; try { const privateSession = isPrivateCustomSession(state.session) || isPrivateCustomSession(state.resume) || isPrivateCustomSession(state.pendingCustomResume); if (privateSession) { clearSession(); state.session = null; state.resume = null; state.pendingCustomResume = null; if (state.screen === "play") state.screen = "participants"; } await accountApi.logout(); if (generation !== state.account.generation) return; state.account.user = null; state.account.favorites = new Set(); state.account.customCards = []; state.account.drafts = []; state.account.draftsAvailable = false; state.account.studioMode = "list"; state.account.editingDraftId = null; state.account.aiQuestions = []; state.account.aiName = ""; state.account.aiR18 = false; state.account.studioReplaceIndex = null; state.account.customCardsAvailable = false; state.account.sets = []; state.account.selectedCards = new Set(); state.account.editingSetId = null; state.account.setName = undefined; state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = "";
      state.account.customDraftR18 = false;
      state.account.pendingSet = null;
      state.account.avatarUrl = "";
      state.account.avatarRevision += 1;
      state.account.avatarDraft = "";
      state.account.avatarBusy = false;
      state.account.avatarError = "";
      state.account.revealAdult = false;
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
  if (action === "custom-card-edit") { if (state.account.busy) return; const id = String(event.currentTarget.dataset.cardId || ""); const card = state.account.customCards.find((item) => item.id === id); if (!card) return; state.account.customEditorOpen = true; state.account.editingCardId = id; state.account.customDraft = card.text; state.account.customDraftR18 = card.r18 === true; state.focusSelector = "[data-custom-text]";
    render();
    return;
  }
  if (action === "custom-card-delete") { if (state.account.busy) return; const id = String(event.currentTarget.dataset.cardId || ""); const generation = state.account.generation; state.account.busy = true; state.account.error = ""; render(); try { await accountApi.deleteCard(id); if (generation !== state.account.generation) return; state.account.customCards = state.account.customCards.filter((card) => card.id !== id); state.account.selectedCards.delete(id); state.account.status = "質問カードを削除しました。"; } catch (error) { if (generation === state.account.generation) { const names = state.account.sets.filter((set) => Array.isArray(set.card_ids) && set.card_ids.includes(id)).map((set) => set.name).filter(Boolean); state.account.error = error?.code === "CARD_IN_USE" || error?.message === "CARD_IN_USE" ? `この質問カードは「${names.join("」「") || "マイセット"}」で使用中です。先にセットから外してください。` : "質問カードを削除できませんでした。"; } } finally { if (generation === state.account.generation) { state.account.busy = false; render(); } } return; }
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
      if (result?.share === null) {
        result = await accountApi.createSetShare(id);
      }
      if (generation !== state.account.generation || requestId !== state.account.shareRequestId || !state.account.shareOpen) return;
      if (!result?.share && !result?.token && !result?.url) throw new Error("share_unavailable");
      if (generation !== state.account.generation || requestId !== state.account.shareRequestId) return;
      state.account.share = { setId: id, ...set, ...(result.share || result) };
      if (state.account.share.token) state.account.share.url = `${location.origin}/?share=${encodeURIComponent(state.account.share.token)}`;
      if (state.account.share.url) generateShareQr(state.account.share.url, generation, requestId);
    } catch (error) {
      if (generation === state.account.generation && requestId === state.account.shareRequestId) state.account.error = error?.status === 404 ? "このセットは共有できません。" : "共有リンクを発行できませんでした。";
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
          title: state.account.share.name || "Mingle.Cards",
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
    } catch {
      if (generation === state.account.generation && requestId === state.account.shareRequestId) state.account.error = "共有リンクを発行できませんでした。";
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
  if (action === "studio-from-favorites") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; state.account.studioMode = "picker"; state.account.editingDraftId = null; state.account.editingSetId = null; state.account.setName = ""; state.account.studioItems = []; state.account.selectedCards = new Set(); state.account.error = ""; render(); return; }
  if (action === "studio-write") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; if (state.account.studioMode === "editor") { state.account.studioItems.push({ kind: "custom", text: "", r18: false, origin: "user" }); state.focusSelector = `[data-studio-item-text][data-item-index="${state.account.studioItems.length - 1}"]`; } else { state.account.studioMode = "editor"; state.account.editingDraftId = null; state.account.editingSetId = null; state.account.setName = ""; state.account.studioItems = [{ kind: "custom", text: "", r18: false, origin: "user" }]; state.account.selectedCards = new Set(); state.account.error = ""; state.focusSelector = '[data-studio-item-text][data-item-index="0"]'; } render(); return; }
  if (action === "studio-ai") { if (state.account.busy || state.account.aiGenerationAvailable === false) return; state.account.studioRequestId += 1; state.account.aiName = ''; state.account.aiR18 = false; state.account.studioAiReturnMode = state.account.studioMode === "editor" ? "editor" : "list"; if (state.account.studioMode !== "editor") { state.account.editingDraftId = null; state.account.editingSetId = null; state.account.setName = ""; state.account.studioItems = []; state.account.selectedCards = new Set(); } state.account.studioMode = "ai"; state.account.aiQuestions = []; state.account.error = ""; render(); return; }
  if (action === "studio-favorites") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioMode = "favorites"; state.account.error = ""; render(); return; }
  if (action === "studio-custom-library") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioMode = "custom"; state.account.error = ""; render(); return; }
  if (action === "studio-picker") { state.account.studioMode = "picker"; render(); return; }
  if (action === "studio-edit-set") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; const set = state.account.sets.find((row) => row.id === event.currentTarget.dataset.setId); if (!set) return; state.account.studioMode = "editor"; state.account.editingSetId = set.id; state.account.editingDraftId = null; state.account.setName = set.name || ""; state.account.studioItems = (set.card_ids || []).map((cardId) => ({ kind: "saved", cardId })); state.account.selectedCards = new Set(set.card_ids || []); render(); return; }
  if (action === "studio-edit-draft") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; const draft = state.account.drafts.find((row) => row.id === event.currentTarget.dataset.draftId); if (!draft) return; state.account.studioMode = "editor"; state.account.editingDraftId = draft.id; state.account.editingSetId = draft.sourceSetId || null; state.account.setName = draft.name || ""; state.account.studioItems = (draft.items || []).map((item) => ({ ...item })); state.account.selectedCards = new Set((draft.items || []).filter((item) => item.kind === "saved").map((item) => item.cardId)); render(); return; }
  if (action === "studio-delete-draft") { if (state.account.busy) return; const id = event.currentTarget.dataset.draftId; const generation = state.account.generation; state.account.busy = true; render(); try { await accountApi.deleteDraft(id); if (generation !== state.account.generation) return; state.account.drafts = state.account.drafts.filter((row) => row.id !== id); state.account.status = "下書きを破棄しました。"; } catch { if (generation === state.account.generation) state.account.error = "下書きを破棄できませんでした。"; } finally { if (generation === state.account.generation) { state.account.busy = false; render(); } } return; }
  if (action === "set-new") { if (state.account.busy) return; state.account.studioRequestId += 1; state.account.studioReplaceIndex = null; state.account.studioMode = "editor"; state.account.editingDraftId = null; state.account.editingSetId = null; state.account.setName = ""; state.account.studioItems = []; state.account.selectedCards = new Set(); state.account.error = ""; state.focusSelector = "[data-set-name]"; render(); return; }
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
    if (state.participants.length < MAX_PARTICIPANTS) {
      state.participants.push("");
      state.focusSelector = `input[data-index="${state.participants.length - 1}"]`;
    }
    render();
    return;
  }
  if (action === "remove-person") { if (state.participants.length > 2) { state.participants.pop(); state.focusSelector = `input[data-index="${state.participants.length - 1}"]`; } render(); return; }
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
  if (action === "choose-deck") {
    state.continuePending = null;
    state.shareMenuOpen = false;
    state.shareStatus = "";
    state.shareFallbackText = "";
    const deck = decks.find((item) => item.id === event.currentTarget.dataset.deck); const adultConfirmed = state.adultConfirmed; if (state.themeMode === "mixed" ? !state.selectedDeckIds.every((id) => canUseDeck(decks.find((item) => item.id === id))) : !canUseDeck(deck)) { state.error = "このテーマは無料登録後に使えます。ログイン / 新規登録してください。"; state.account.open = true; state.account.error = ""; state.account.status = state.error; state.focusSelector = "[data-account-email]"; render(); return; } const includeR18 = Boolean(state.themeMode !== "mixed" && deck?.r18Available && adultConfirmed);
    if (includeR18 && !isRegisteredUser()) { state.error = "R18を含めるには無料登録が必要です。"; render(); return; }
    try {
      state.session =
        state.themeMode === "mixed"
          ? createMixedSession({ participants: state.participants, decks: state.selectedDeckIds.map((id) => decks.find((item) => item.id === id)), includeChallenges: state.includeChallenges,
            })
          : createSession({
              participants: state.participants,
              deck,
              adultConfirmed,
              includeR18,
              includeChallenges: state.includeChallenges,
            }); state.session.feedbackSubmitted = []; state.feedback = null; state.resume = null; trackThemeStart(state.session.deckId);
      saveCurrentSession(state.session);
      state.screen = "play";
      state.error = ""; render(); } catch (error) { state.error = error.message; render(); } return; }
  if (action === "choose-myset") {
    if (!isRegisteredUser()) return;
    const set = playableSavedSets(state.account.sets, state.account.customCards).find((item) => item.id === event.currentTarget.dataset.setId);
    if (!set) { state.error = "このマイセットは利用できません。"; render(); return; }
    state.selectedMySetId = set.id; state.adultConfirmed = false; state.error = ""; state.focusAction = "choose-myset-start"; render();
    return;
  }
  if (action === "choose-myset-start") {
    if (!isRegisteredUser()) return;
    const set = playableSavedSets(state.account.sets, state.account.customCards).find((item) => item.id === event.currentTarget.dataset.setId);
    if (!set) { state.error = "このマイセットは利用できません。"; render(); return; }
    state.error = ""; state.account.pendingSet = set.hasR18 ? { set, consented: state.adultConfirmed === true } : null;
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
    state.screen = "participants";
    state.session = null;
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
        if (payload?.deckId && Array.isArray(payload?.deckIds)) throw new Error("deckIdとdeckIdsは同時に指定できません"); const ids = Array.isArray(payload?.deckIds) ? payload.deckIds : []; if (ids.length && payload?.includeR18 === true) throw new Error("ミックスではR18を選べません"); const next = ids.length ? createMixedSession({ participants: payload?.participants, decks: ids.map((id) => decks.find((item) => item.id === id)), includeChallenges: payload?.includeChallenges === true, includeR18: payload?.includeR18 === true,
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
async function loadVenueLink() {
  const token = new URL(location.href).searchParams.get("venue");
  if (!token) return;
  const requestId = ++state.sharedRequestId;
  state.sharedLoading = true;
  try {
    const result = await accountApi.venueInfo(token);
    if (requestId !== state.sharedRequestId) return;
    if (!Array.isArray(result.sets) || !result.sets.length) throw new Error("店舗テーマが見つかりません。");
    state.venue = { token, venue: result.venue, table: result.table, sets: result.sets };
    state.selectedVenueSetId = result.sets[0].id;
    state.shared = { token, name: result.venue.name, cardCount: result.sets[0].cardCount, adultOnly: result.sets[0].adultOnly };
    syncSelectedVenueSet();
    state.error = "";
  } catch { if (requestId === state.sharedRequestId) { state.venue = null; state.shared = null; state.error = "この店舗QRは無効か、停止されています。"; } }
  finally { if (requestId === state.sharedRequestId) { state.sharedLoading = false; render(); } }
}

try { const saved = loadSession(); if (saved?.customSet && saved.ownerUserId) state.pendingCustomResume = saved; else state.resume = saved; } catch { state.resume = null; state.pendingCustomResume = null; }
render();
loadSharedLink();
loadVenueLink();
discoverAccountConfig().then(() => { state.account.enabled = accountConfig.enabled; state.account.google = accountConfig.google; if (!state.account.enabled && state.pendingCustomResume) { clearSession(); state.pendingCustomResume = null; } if (!state.account.enabled) state.account.authReady = true; if (state.account.enabled) { loadAccount(); accountApi.onAuthStateChange?.((event, session) => { setTimeout(() => { const nextUser = session?.user || null; const previousId = state.account.user?.id || null; const nextId = nextUser?.id || null; const identityChanged = Boolean(previousId && nextId && previousId !== nextId); if (event === "SIGNED_OUT" || identityChanged || (event === "SIGNED_IN" && !previousId)) state.account.authReady = false; if (event === "SIGNED_OUT" || identityChanged) {
            state.roundFavorite = null; state.continuePending = null;
            clearAccountShare({ close: true });
            state.shareStatus = "";
            state.shareMenuOpen = false; state.shareFallbackText = "";
            state.sharedRequestId += 1;
            state.shared = null;
            state.venue = null;
            state.selectedVenueSetId = null;
            state.sharedLoading = false;
          }
          const privateResume = isPrivateCustomSession(state.session) || isPrivateCustomSession(state.resume) || isPrivateCustomSession(state.pendingCustomResume); if (event === "SIGNED_OUT" || identityChanged) clearAccountParticipantName();
          if ((event === "SIGNED_OUT" || identityChanged) && privateResume) { clearSession(); state.session = null; state.resume = null; state.pendingCustomResume = null; if (state.screen === "play") state.screen = "participants";
          }
          if (previousId === nextId && event !== "SIGNED_OUT") { if (nextId) state.account.user = normalizeAccountUser(nextUser, state.account.user); return; } state.account.generation += 1; state.account.profileRevision += 1; state.account.busy = false; state.account.user = normalizeAccountUser(nextUser); if (!state.account.user) state.account.authReady = true; state.account.favorites = new Set(); state.account.customCards = []; state.account.drafts = []; state.account.draftsAvailable = false; state.account.studioMode = "list"; state.account.editingDraftId = null; state.account.aiQuestions = []; state.account.aiName = ""; state.account.aiR18 = false; state.account.studioReplaceIndex = null; state.account.customCardsAvailable = false; state.account.sets = []; state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = ""; state.account.customDraftR18 = false; state.account.selectedCards = new Set(); state.account.editingSetId = null; state.account.setName = undefined; state.account.pendingSet = null; state.account.avatarUrl = "";
          state.account.avatarRevision += 1;
          state.account.avatarDraft = "";
          state.account.avatarBusy = false;
          state.account.avatarError = "";
          state.account.revealAdult = false;
          state.account.status = "";
          state.account.error = ""; const preserveRound = Boolean((state.roundFavorite?.loginPending || state.continuePending) && state.session && nextId && !previousId); if (!preserveRound) state.feedback = null; if (state.continuePending?.kind !== "resume") state.resume = null; if (state.account.user) { render(); loadAccount(); } else { state.account.favorites = new Set(); state.account.customCards = []; state.account.drafts = []; state.account.draftsAvailable = false; state.account.studioMode = "list"; state.account.editingDraftId = null; state.account.aiQuestions = []; state.account.aiName = ""; state.account.aiR18 = false; state.account.studioReplaceIndex = null; state.account.customCardsAvailable = false; state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = ""; state.account.customDraftR18 = false; state.account.sets = []; render(); } }, 0); }); } }).catch(() => { state.account.authReady = true; state.account.enabled = false; render(); });
