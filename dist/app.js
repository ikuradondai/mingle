import { decks } from './data/decks.js';
import { trackPage, trackThemeStart, trackSessionProgress } from './analytics.js';
import { loadSession, saveSession, clearSession } from './session-storage.js';
import { canContinue } from './access-policy.js';
import { ROUND_SIZE, createSession, createMixedSession, createSavedSession, currentAnswerLikes, currentCard, currentParticipantIndex, currentSpeaker, isFinished, isRoundComplete, likeCurrentAnswer, nextAnswer, passAnswer, previousAnswer, remaining, revealCard, continueRound, normalizeParticipants, MAX_NAME_LENGTH, MAX_PARTICIPANTS, summarizeLikes, completedRoundFavoriteCards } from './engine.js';
import { themeGroups, groupLabels } from './data/theme-groups.js';
import { buildFeedbackPayload, feedbackKey, submitFeedback } from './feedback.js';
import { accountConfig, accountApi, cardPayload, discoverAccountConfig } from './account.js';
import { renderLibrary, canonicalCard } from './account-library.js';

const root = document.querySelector('#app');
const state = { participantNameOrigin: null, participantNameAutoValue: '', participantNameUserEdited: false, screen: 'participants', participants: ['', ''], session: null, pendingCustomResume: null, error: '', busy: false, feedbackBusy: false, feedbackRequestToken: 0, feedback: null, roundFavorite: null, roundLikeExpanded: false, roundLikeKey: null, lastAdvanceAt: 0, focusAction: null, focusSelector: null, selectedDeckId: 'friends', selectedDeckIds: ['friends'], themeMode: 'single', filter: 'all', adultConfirmed: false, includeChallenges: false, resume: null, account: { enabled: accountConfig.enabled, google: accountConfig.google, user: null, favorites: new Set(), customCards: [], customCardsAvailable: false, sets: [], open: false, libraryOpen: false, settingsOpen: false, deleteOpen: false, deleteConfirmed: false, profileDraft: '', deletionAvailable: false, email: '', otp: '', otpSent: false, pendingSet: null, selectedCards: new Set(), editingSetId: null, setName: undefined, customEditorOpen: false, editingCardId: null, customDraft: '', customDraftR18: false, revealAdult: false, status: '', error: '', busy: false, generation: 0, profileRevision: 0 } };

function esc(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function accountParticipantName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  return name && !/[\u0000-\u001f\u007f]/u.test(name) && Array.from(name).length <= MAX_NAME_LENGTH ? name : '';
}
function syncAccountParticipantName() {
  if (state.screen !== 'participants') return;
  const next = accountParticipantName(state.account.user?.displayName);
  if (state.participantNameOrigin === 'account') {
    if (state.participants[0] === state.participantNameAutoValue || !state.participants[0]) state.participants[0] = next;
    if (next) state.participantNameAutoValue = next; else state.participantNameOrigin = null;
    return;
  }
  if (!state.participantNameUserEdited && !state.participants[0] && next) { state.participants[0] = next; state.participantNameOrigin = 'account'; state.participantNameAutoValue = next; }
}
function clearAccountParticipantName() {
  if (state.participantNameOrigin === 'account' && state.participants[0] === state.participantNameAutoValue) state.participants[0] = '';
  state.participantNameOrigin = null; state.participantNameAutoValue = '';
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
  const overlay = rootNode?.querySelector?.('[data-account-overlay]');
  if (!overlay) return null;
  const dialog = overlay.querySelector('.account-dialog');
  const kind = dialog?.classList.contains('account-dialog-library') ? 'library' : dialog?.classList.contains('account-dialog-settings') ? 'settings' : dialog?.classList.contains('account-dialog-delete') ? 'delete' : dialog?.classList.contains('account-dialog-menu') ? 'menu' : 'login';
  return `${kind}:${Boolean(dialog?.querySelector('.library-editor'))}`;
}
function accountScrollSnapshot() {
  const overlay = root.querySelector('[data-account-overlay]');
  if (!overlay) return null;
  const dialog = overlay.querySelector('.account-dialog');
  const grid = overlay.querySelector('.library-card-grid');
  const favorites = overlay.querySelector('.library-favorites');
  return { surface: accountSurface(root), dialogTop: dialog?.scrollTop || 0, dialogLeft: dialog?.scrollLeft || 0, gridTop: grid?.scrollTop || 0, gridLeft: grid?.scrollLeft || 0, favoritesTop: favorites?.scrollTop || 0, favoritesLeft: favorites?.scrollLeft || 0 };
}
function restoreAccountScroll(snapshot) {
  if (!snapshot || snapshot.surface !== accountSurface(root)) return;
  const overlay = root.querySelector('[data-account-overlay]');
  const dialog = overlay?.querySelector('.account-dialog');
  const grid = overlay?.querySelector('.library-card-grid');
  const favorites = overlay?.querySelector('.library-favorites');
  if (dialog) { dialog.scrollTop = snapshot.dialogTop; dialog.scrollLeft = snapshot.dialogLeft; }
  if (grid) { grid.scrollTop = snapshot.gridTop; grid.scrollLeft = snapshot.gridLeft; }
  if (favorites) { favorites.scrollTop = snapshot.favoritesTop; favorites.scrollLeft = snapshot.favoritesLeft; }
}
function render() {
  const accountScroll = accountScrollSnapshot();
  root.innerHTML = state.screen === 'participants' ? participantsView() : state.screen === 'decks' ? decksView() : playView();
  restoreAccountScroll(accountScroll);
  root.dataset.screen = state.screen;
  document.body.classList.toggle('account-open', state.account.open);
  trackPage(state.screen);
  root.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', handleAction));
  root.querySelector('form[data-form="participants"]')?.addEventListener('submit', (event) => { event.preventDefault(); submitParticipants(); });
  root.querySelectorAll('input[name="participant"]').forEach((input) => {
    input.addEventListener('input', (event) => { const index = Number(event.target.dataset.index); if (index === 0) { state.participantNameUserEdited = true; if (state.participantNameOrigin === 'account' && event.target.value !== state.participantNameAutoValue) { state.participantNameOrigin = null; state.participantNameAutoValue = ''; } } state.participants[index] = event.target.value; });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.nativeEvent?.isComposing) return;
      event.preventDefault();
      const fields = [...root.querySelectorAll('input[name="participant"]')];
      const index = fields.indexOf(event.currentTarget);
      if (fields[index + 1]) { fields[index + 1].focus({ preventScroll: false }); fields[index + 1].scrollIntoView({ block: 'nearest' }); }
      else event.currentTarget.form?.requestSubmit();
    });
  });
  root.querySelector('[data-feedback-text]')?.addEventListener('input', (event) => { const current = feedbackState(state.session); if (current) { current.text = event.target.value; const button = root.querySelector('[data-action="feedback-submit"]'); if (button) button.disabled = state.feedbackBusy || (!current.rating && !current.text.trim()); } });
  root.querySelectorAll('[data-adult]').forEach((input) => input.addEventListener('change', (event) => { state.adultConfirmed = event.target.checked; updateAdultButton(); }));
  root.querySelector('[data-challenges]')?.addEventListener('change', (event) => { state.includeChallenges = event.target.checked; });
  root.querySelectorAll('[data-deck-select]').forEach((input) => input.addEventListener('change', (event) => {
    const id = event.target.value;
    if (state.themeMode === 'mixed') {
      if (event.target.checked && !state.selectedDeckIds.includes(id)) {
        if (state.selectedDeckIds.length >= 3) { state.error = 'ミックスは3テーマまでです'; render(); return; }
        state.selectedDeckIds = [...state.selectedDeckIds, id];
      } else if (!event.target.checked) state.selectedDeckIds = state.selectedDeckIds.filter((item) => item !== id);
      state.selectedDeckId = state.selectedDeckIds[0] || id;
    } else { state.selectedDeckId = id; state.selectedDeckIds = [id]; }
    state.adultConfirmed = false; state.error = ''; state.focusSelector = `[data-deck-select][value="${id}"]`; render();
  }));
  root.querySelectorAll('[data-mode]').forEach((input) => input.addEventListener('change', (event) => { state.themeMode = event.target.value; state.adultConfirmed = false; if (state.themeMode === 'mixed') { const regular = new Set(decks.filter((deck) => !deck.adultOnly).map((deck) => deck.id)); state.selectedDeckIds = state.selectedDeckIds.filter((id) => regular.has(id)); if (!state.selectedDeckIds.length && regular.has(state.selectedDeckId)) state.selectedDeckIds = [state.selectedDeckId]; if (state.filter === 'adult') state.filter = 'all'; } if (state.themeMode === 'single') state.selectedDeckId = state.selectedDeckIds[0] || state.selectedDeckId; state.focusSelector = `input[data-mode][value="${event.target.value}"]`; state.error = ''; render(); }));
  root.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.filter = state.themeMode === 'mixed' && button.dataset.filter === 'adult' ? 'all' : button.dataset.filter; state.focusSelector = `[data-filter="${state.filter}"]`; render(); }));
  root.querySelectorAll('[data-remove-deck]').forEach((button) => button.addEventListener('click', () => { state.selectedDeckIds = state.selectedDeckIds.filter((id) => id !== button.dataset.removeDeck); state.selectedDeckId = state.selectedDeckIds[0] || state.selectedDeckId; state.error = ''; render(); }));
  root.querySelector('[data-action="resume"]')?.addEventListener('click', resumeSaved);
  root.querySelector('[data-action="discard-resume"]')?.addEventListener('click', () => { clearSession(); state.resume = null; render(); });
  root.querySelector('[data-account-email]')?.addEventListener('input', (event) => { state.account.email = event.target.value; });
  root.querySelector('[data-profile-name]')?.addEventListener('input', (event) => { state.account.profileDraft = event.target.value; const button = root.querySelector('form[data-form="profile"] button[type="submit"]'); if (button) button.disabled = state.account.busy || !validDisplayName(state.account.profileDraft); });
  root.querySelector('[data-custom-text]')?.addEventListener('input', (event) => { state.account.customDraft = event.target.value; const count = root.querySelector('[data-custom-count]'); if (count) count.textContent = `文字数 ${Array.from(event.target.value.trim()).length} / 300。改行や制御文字は使えません。`; });
  root.querySelector('[data-custom-r18]')?.addEventListener('change', (event) => { state.account.customDraftR18 = event.currentTarget.checked; if (!event.currentTarget.checked) { const text = root.querySelector('[data-custom-text]'); if (text) text.value = state.account.customDraft; } });
  root.querySelector('[data-account-otp]')?.addEventListener('input', (event) => { state.account.otp = event.target.value; });
  root.querySelector('form[data-form="account"]')?.addEventListener('submit', (event) => { event.preventDefault(); loginWithOtp(); });
  root.querySelector('form[data-form="profile"]')?.addEventListener('submit', (event) => { event.preventDefault(); saveProfile(); });
  root.querySelector('form[data-form="custom-card"]')?.addEventListener('submit', (event) => { event.preventDefault(); saveCustomCard(); });
  const accountOverlay = root.querySelector('[data-account-overlay]');
  accountOverlay?.addEventListener('click', (event) => { if (event.target === event.currentTarget && !state.account.busy) { state.account.open = false; state.account.libraryOpen = false; state.focusAction = 'account'; render(); } });
  accountOverlay?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.account.open && !state.account.busy) { event.preventDefault(); state.account.open = false; state.account.libraryOpen = false; state.focusAction = 'account'; render(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...accountOverlay.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]')].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  root.querySelectorAll('[data-select-card]').forEach((input) => input.addEventListener('change', (event) => { const id = event.currentTarget.dataset.cardId; if (event.currentTarget.checked) state.account.selectedCards.add(id); else state.account.selectedCards.delete(id); state.focusSelector = `[data-select-card][data-card-id=\"${id}\"]`; render(); }));
  root.querySelectorAll('[data-round-favorite]').forEach((input) => input.addEventListener('change', (event) => {
    const context = state.roundFavorite;
    if (!context || context.saving) return;
    const id = event.currentTarget.dataset.cardId;
    if (event.currentTarget.checked) context.selected.add(id); else context.selected.delete(id);
    state.focusSelector = `[data-round-favorite][data-card-id="${id}"]`;
    render();
  }));
  root.querySelector('[data-library-adult]')?.addEventListener('change', (event) => { state.account.revealAdult = event.currentTarget.checked; state.focusSelector = '[data-library-adult]'; render(); });
  root.querySelector('[data-delete-confirm]')?.addEventListener('change', (event) => { state.account.deleteConfirmed = event.currentTarget.checked; const button = root.querySelector('[data-action="account-delete-confirm"]'); if (button) button.disabled = state.account.busy || !state.account.deletionAvailable || !state.account.deleteConfirmed; });
  const setNameInput = root.querySelector('[data-set-name]'); const updateSetValidity = () => { const form = setNameInput?.closest('form'); const button = form?.querySelector('button[type=\"submit\"]'); if (!button || !setNameInput) return; const count = state.account.selectedCards.size; button.disabled = state.account.busy || !setNameInput.value.trim() || count < 6 || count > 40; }; setNameInput?.addEventListener('input', (event) => { state.account.setName = event.currentTarget.value; if (!event.isComposing) updateSetValidity(); }); setNameInput?.addEventListener('compositionend', updateSetValidity);
  root.querySelector('form[data-form="set"]')?.addEventListener('submit', async (event) => { event.preventDefault(); if (state.account.busy) return; const name = new FormData(event.currentTarget).get('set-name')?.toString().trim(); const cardIds = [...state.account.selectedCards]; if (!name || cardIds.length < 6 || cardIds.length > 40 || cardIds.some((id) => !canonicalCard(id, state.account.customCards))) { state.account.error = '名前とカード数（6〜40枚）を確認してください。'; render(); return; } const generation = state.account.generation; const editingId = state.account.editingSetId; state.account.busy = true; render(); try { const payload = { name, cardIds }; const result = editingId ? await accountApi.updateSet(editingId, payload) : await accountApi.createSet(name, cardIds); if (generation !== state.account.generation) return; const row = result.set || result; state.account.sets = editingId ? state.account.sets.map((set) => set.id === row.id ? row : set) : [...state.account.sets, row]; state.account.editingSetId = null; state.account.setName = undefined; state.account.selectedCards = new Set(); state.account.status = '保存しました。'; } catch { if (generation !== state.account.generation) return; state.account.error = 'セットを保存できませんでした。'; } finally { if (generation === state.account.generation) { state.account.busy = false; render(); } } });
  root.querySelector('.card-back')?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const previous = ensureSession(); state.session = revealCard(previous); persist(previous); render(); } });
  updateAdultButton();
  const pendingFocusSelector = state.focusSelector;
  const focusTarget = pendingFocusSelector ? root.querySelector(pendingFocusSelector) : state.focusAction ? root.querySelector(`[data-action="${state.focusAction}"]`) : null;
  const shouldScrollToInput = Boolean(pendingFocusSelector?.includes('participant') || pendingFocusSelector?.includes('data-index'));
  state.focusSelector = null;
  state.focusAction = null;
  const overlayFocus = root.querySelector('.account-overlay button:not([disabled]), .account-overlay input:not([disabled]), .account-overlay [href]');
  const focusElement = focusTarget || overlayFocus || root.querySelector('[data-focus]');
  focusElement?.focus({ preventScroll: Boolean(focusTarget && !shouldScrollToInput) });
  if (focusTarget && shouldScrollToInput) focusTarget.scrollIntoView({ block: 'nearest' });
  registerWebMcp();
}

function frame(content, eyebrow = 'Mingle.Cards', withHeader = true) { const quietText = state.session?.revealed && currentCard(state.session)?.kind === 'challenge' ? 'やりたくないお題はパスしてOK' : '話したくない質問はパスしてOK'; return `${withHeader ? `<header class="topbar"><button class="brand" data-action="home" aria-label="最初に戻る"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M6 7.5A3.5 3.5 0 0 1 9.5 4h9A3.5 3.5 0 0 1 22 7.5v7a3.5 3.5 0 0 1-3.5 3.5H14l-5 5v-5h-.5A3.5 3.5 0 0 1 5 14.5v-7Z" fill="currentColor"/><path d="M13 15.5A3.5 3.5 0 0 1 16.5 12h6A3.5 3.5 0 0 1 26 15.5v5a3.5 3.5 0 0 1-3.5 3.5H20l-3.5 3v-3h-.5a3.5 3.5 0 0 1-3.5-3.5v-5Z" fill="var(--coral)"/></svg></span><span>${eyebrow}</span></button><span class="quiet">${quietText}</span></header>` : ''}<section class="content">${content}</section>`; }

function participantsView() {
  syncAccountParticipantName();
  const atLimit = state.participants.length >= MAX_PARTICIPANTS;
  const resumeCard = state.resume ? `<aside class="resume-card" aria-label="前回の続き"><strong>前回の続き</strong><span>${esc(state.resume.mixed ? 'テーマミックス' : (state.resume.customSet ? 'マイセット' : (decks.find((deck) => deck.id === state.resume.deckId)?.title || '会話カード')))} · ${state.resume.cursor}/${state.resume.questions?.length || 40}</span><small>このブラウザに24時間保存</small><div><button type="button" class="primary-button" data-action="resume">続きから</button><button type="button" class="text-button muted" data-action="discard-resume">削除</button></div></aside>` : '';
  return frame(`<div class="home-screen">${accountView()}<div class="masthead-slot"><img class="masthead-image" src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards。やっぱり人って面白い。" width="1493" height="1054" /><h1 class="visually-hidden" tabindex="-1" data-focus>Mingle.Cards</h1></div><img class="home-illustration" src="/assets/friends-conversation-closeup.png" alt="会話を楽しむ人たちのイラスト" width="1611" height="976" />${resumeCard}<form class="panel form-panel" data-form="participants"><div class="participant-list">${state.participants.map((name, index) => `<label class="name-field"><span class="name-avatar participant-color-${index}">${participantAvatar(name)}</span><input name="participant" data-index="${index}" value="${esc(name)}" maxlength="80" placeholder="呼び名" aria-label="${index + 1}人目の呼び名" autocomplete="off" enterkeyhint="${index === state.participants.length - 1 ? 'done' : 'next'}" /></label>`).join('')}</div><div class="inline-actions"><button type="button" class="text-button add-person" data-action="add-person" ${atLimit ? 'disabled' : ''}>＋ 参加者を追加</button>${state.participants.length > 2 ? '<button type="button" class="text-button muted" data-action="remove-person">最後の人を削除</button>' : ''}<span class="limit-note">${atLimit ? '8人まで' : ''}</span></div><p class="form-error" role="alert">${esc(state.error)}</p><button type="submit" class="primary-button">質問テーマを選ぶ</button></form><footer class="home-footer"><p><span>α版</span><span>開発：株式会社ErudAite</span></p><nav aria-label="ご案内"><a href="/terms.html">利用規約</a><a href="/privacy.html">プライバシーポリシー</a><a href="/personal-information.html">個人情報保護法に基づく公表事項</a></nav></footer></div>`, 'Mingle.Cards', false);
}

function accountAvatar() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.25"/><path d="M5.5 20c.6-3.7 2.8-5.8 6.5-5.8s5.9 2.1 6.5 5.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
}
function accountDialog(content, className = '') {
  return `<div class="account-overlay" data-account-overlay><div id="account-dialog" class="account-dialog ${className}" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">${content}</div></div>`;
}
function accountButton(a) {
  const label = a.user ? 'アカウントメニュー' : 'ログインして保存';
  return `<div class="account-bar"><button type="button" class="account-button" data-action="account" aria-label="${label}" aria-expanded="${a.open}" aria-controls="account-dialog" title="${label}"><span class="account-avatar">${accountAvatar()}</span><span class="visually-hidden">${label}</span></button></div>`;
}
function libraryAccountView(a) {
  return accountDialog(`<div class="account-panel-head"><button type="button" class="text-button account-back" data-action="account-menu">戻る</button><strong id="account-dialog-title">保存したカード</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div>${a.pendingSet ? '<p class="account-status">このセットにはR18カードが含まれます。参加者全員の同意が必要です。</p><button type="button" class="primary-button" data-action="confirm-set-play">同意して遊ぶ</button>' : ''}${renderLibrary({ ...a, hideTitle: true })}`, 'account-dialog-library');
}
function validDisplayName(value) {
  return typeof value === 'string' && !/[\u0000-\u001f\u007f]/u.test(value) && Array.from(value.trim()).length <= 40;
}
function accountSettingsView(a) {
  if (a.deleteOpen) return accountDialog(`<div class="account-panel-head"><button type="button" class="text-button" data-action="account-settings">戻る</button><strong id="account-dialog-title">退会の確認</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div><div class="account-delete-warning"><p>退会すると、このアカウントの表示名・お気に入り・自作質問カード・非公開マイセットを削除します。</p><p>この端末の呼び名と途中データも削除されます。</p><p>削除後は取り消せません。</p><label class="account-delete-confirm-label"><input type="checkbox" data-delete-confirm ${a.deleteConfirmed ? 'checked' : ''} ${a.busy ? 'disabled' : ''}/> 内容を確認しました</label></div>${a.error ? `<p class="form-error" role="alert">${esc(a.error)}</p>` : ''}<div class="account-delete-actions"><button type="button" class="text-button" data-action="account-delete-cancel" ${a.busy ? 'disabled' : ''}>キャンセル</button><button type="button" class="danger-button" data-action="account-delete-confirm" ${a.busy || !a.deletionAvailable || !a.deleteConfirmed ? 'disabled' : ''}>${a.busy ? '削除中…' : '退会して削除'}</button></div>`, 'account-dialog-delete');
  const valid = validDisplayName(a.profileDraft);
  return accountDialog(`<div class="account-panel-head"><button type="button" class="text-button" data-action="account-menu">戻る</button><strong id="account-dialog-title">アカウント設定</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div><form class="account-settings-form" data-form="profile"><label>表示名<input type="text" data-profile-name value="${esc(a.profileDraft)}" maxlength="80" autocomplete="nickname" ${a.busy ? 'disabled' : ''}/></label><p class="account-hint">1人目の呼び名に自動入力されます。遊ぶときに変更できます。</p><p class="account-email">${esc(a.user?.email || '')}</p><button type="submit" class="primary-button" ${a.busy || !valid ? 'disabled' : ''}>${a.busy ? '保存中…' : '表示名を保存'}</button></form>${a.status ? `<p class="account-status" role="status">${esc(a.status)}</p>` : ''}${a.error ? `<p class="form-error" role="alert">${esc(a.error)}</p>` : ''}<section class="account-delete-section"><h2>退会</h2>${a.deletionAvailable ? '<button type="button" class="danger-button" data-action="account-delete-open">アカウントを削除</button>' : '<p class="account-hint">退会手続きは現在利用できません。</p><a class="account-support" href="mailto:inquiry@erudaite.ai">問い合わせる</a>'}</section>`, 'account-dialog-settings');
}
function accountView(options = {}) {
  if (!state.account.enabled) return '';
  const a = state.account;
  const overlayOnly = options.overlayOnly === true;
  const bar = accountButton(a);
  const wrap = (dialog) => overlayOnly ? dialog : `${bar}${dialog}`;
  if (!a.open) return overlayOnly ? '' : bar;
  if (a.user && a.settingsOpen) return wrap(accountSettingsView(a));
  if (a.user && a.libraryOpen) return wrap(libraryAccountView(a));
  if (a.user) return wrap(accountDialog(`<div class="account-panel-head"><strong id="account-dialog-title">アカウント</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div>${a.user.displayName ? `<p class="account-display-name">${esc(a.user.displayName)}</p>` : ''}<p class="account-email">${esc(a.user.email || a.user.name || 'ログイン中')}</p><button type="button" class="secondary-button account-menu-action" data-action="account-settings-open">アカウント設定</button><button type="button" class="secondary-button account-menu-action" data-action="account-library-open">保存したカード・マイセット</button><button type="button" class="text-button account-menu-action" data-action="logout">ログアウト</button>${a.error ? `<p class="form-error" role="alert">${esc(a.error)}</p>` : ''}`, 'account-dialog-menu'));
  return wrap(accountDialog(`<div class="account-panel-head"><strong id="account-dialog-title">ログインする</strong><button type="button" class="icon-button" data-action="account-close" aria-label="閉じる">×</button></div>${a.google ? '<button type="button" class="secondary-button account-provider" data-action="google-login">Googleで続ける</button>' : ''}<form class="account-otp" data-form="account"><label>メールアドレス<input type="email" data-account-email value="${esc(a.email)}" required autocomplete="email" /></label>${a.otpSent ? '<label>確認コード<input inputmode="numeric" data-account-otp value="' + esc(a.otp) + '" required autocomplete="one-time-code" /></label><button type="button" class="text-button muted" data-action="reset-otp"' + (a.busy ? ' disabled' : '') + '>メールアドレスを変更／コードを再送</button>' : ''}<button type="submit" class="primary-button">${a.busy ? '処理中…' : (a.otpSent ? 'ログインする' : '確認コードを送る')}</button></form><p class="account-status" role="status">${esc(a.status || 'ログインすると質問を保存できます')}</p><p class="form-error" role="alert">${esc(a.error)}</p>`, 'account-dialog-login'));
}

function topicIcon(deck) {
const paths = { 'acquaintance-date': '<path d="m12 20-1.7-1.55C4.25 12.93 1 9.9 1 6.2A5.2 5.2 0 0 1 6.2 1c1.7 0 3.32.8 4.3 2.06A5.57 5.57 0 0 1 14.8 1 5.2 5.2 0 0 1 20 6.2c0 3.7-3.25 6.73-9.3 12.25L12 20Z"/>', date: '<path d="m12 20-1.7-1.55C4.25 12.93 1 9.9 1 6.2A5.2 5.2 0 0 1 6.2 1c1.7 0 3.32.8 4.3 2.06A5.57 5.57 0 0 1 14.8 1 5.2 5.2 0 0 1 20 6.2c0 3.7-3.25 6.73-9.3 12.25L12 20Z"/>', couples: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>', intimacy: '<path d="M12 2c3.8 2.4 5.5 5.3 5.5 8.2A5.5 5.5 0 0 1 12 15.7a5.5 5.5 0 0 1-5.5-5.5C6.5 7.3 8.2 4.4 12 2Zm0 13.7c3.1 0 5.5 1.2 5.5 2.8S15.1 21 12 21s-5.5-1.1-5.5-2.5 2.4-2.8 5.5-2.8Z"/>', friends: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 19c.5-3 2.5-4.5 6-4.5S13.5 16 14 19M10 19c.5-3 2.5-4.5 6-4.5 2.4 0 4 .8 5 2.5"/>', founders: '<path d="M12 2 14.8 8l6.2.6-4.7 4.1 1.4 6.1-5.7-3.3-5.7 3.3 1.4-6.1-4.7-4.1L9.2 8 12 2Z"/>', team: '<path d="M4 18V7h16v11M8 7V4h8v3M2 20h20M9 12h6M9 15h6"/>', 'sports-teammates': '<circle cx="12" cy="12" r="8"/><path d="m4.8 8.3 5.1 1.4 3.1-4.3M10 9.7l2.6 4.2 5.1 1.5M12.6 13.9l-4.2 2.6"/>', 'parent-50plus': '<path d="m3 11 9-7 9 7v9H3v-9Zm5 9v-5h8v5M7 11h10"/>', 'parent-under12': '<path d="M12 3v18M3 12h18"/>', reunion: '<path d="M4 5h16v11H8l-4 4V5Z"/><path d="M8 9h8M8 12h5"/>', siblings: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 19c.5-3 2.5-5 6-5s5.5 2 6 5M10 19c.5-3 2.5-5 6-5 3.5 0 5.5 2 6 5"/>', 'new-couple': '<path d="M12 20S3 14.8 3 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 9 2.5C21 14.8 12 20 12 20Z"/>', 'moving-in': '<path d="m3 11 9-8 9 8v9H3v-9Z"/><path d="M9 20v-6h6v6M7 11h10"/>', 'first-intimacy': '<path d="M12 20S4 15.5 4 9a4 4 0 0 1 8-2 4 4 0 0 1 8 2c0 6.5-8 11-8 11Z"/><path d="M12 10v4M10 12h4"/>', 'intimacy-refresh': '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 5v5h5"/><path d="M12 8v4l3 2"/>', 'intimacy-distance': '<circle cx="8" cy="12" r="3"/><circle cx="16" cy="12" r="3"/><path d="M11 12h2M8 9V6M16 15v3"/>', 'family-reunion': '<path d="M3 10 12 3l9 7v10H3V10Z"/><path d="M8 20v-6h8v6M7 10h10"/>', 'new-colleagues': '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 20c.5-4 2.5-6 5-6s4.5 2 5 6M13 14h8M17 10v8"/>' };
  paths.omiai = '<path d="M3 10.5 12 3l9 7.5v9H3v-9Z"/><path d="M8 20v-5h8v5M7 10h10"/>';
  paths['party-first-meeting'] = '<circle cx="12" cy="8" r="4"/><path d="M4 21c.7-4 3.3-6 8-6s7.3 2 8 6M18 4l1 2 2 .3-1.5 1.5.4 2.2L18 9l-1.9 1M6 4 5 6l-2 .3 1.5 1.5-.4 2.2L6 9l1.9 1"/>';
  paths['business-meetup'] = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5V3h8v2M7 11h10M12 11v3"/>';
  paths['bar-first-meeting'] = '<path d="M4 4h16l-6 7v6l3 2H7l3-2v-6L4 4Z"/><path d="M8 8h8"/>';
  paths['promotion-rivals'] = '<path d="M4 20V9h5v11M10 20V4h5v16M16 20v-7h4v7M2 20h20"/>';
  paths['love-rivals'] = '<path d="M12 20S3 14.8 3 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 9 2.5C21 14.8 12 20 12 20Z"/><path d="M5 4l.7 1.4L7 6l-1.3.6L5 8l-.7-1.4L3 6l1.3-.6L5 4Z"/>';
  paths['arch-enemies'] = '<path d="m5 5 14 14M19 5 5 19"/><circle cx="12" cy="12" r="9"/>';
  paths['hero-and-demon-king'] = '<path d="M12 3 14 8l5 1-4 3 1 6-4-3-4 3 1-6-4-3 5-1 2-5Z"/><path d="M4 21h16"/>';
  paths['assassin-and-target'] = '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="m4 4 5 5"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[deck.id] ?? paths.team}</svg>`;
}

function decksView() {
  const mixed = state.themeMode === 'mixed';
  const selected = decks.find((deck) => deck.id === state.selectedDeckId) ?? decks.find((deck) => !deck.adultOnly) ?? decks[0];
  const regularDecks = decks.filter((deck) => !deck.adultOnly), r18Decks = decks.filter((deck) => deck.adultOnly);
  const visible = (deck) => state.filter === 'all' || (state.filter === 'adult' ? deck.adultOnly || deck.r18Available : !deck.adultOnly && themeGroups[deck.id]?.includes(state.filter));
  const option = (deck) => { const checked = mixed ? state.selectedDeckIds.includes(deck.id) : deck.id === selected.id; const control = mixed ? `<input type="checkbox" name="deck" value="${esc(deck.id)}" data-deck-select ${checked ? 'checked' : ''} />` : `<input type="radio" name="deck" value="${esc(deck.id)}" data-deck-select ${checked ? 'checked' : ''} />`; return `<label class="deck-option theme-card-${esc(deck.id)} ${checked ? 'is-selected' : ''}">${control}<span class="topic-icon topic-${esc(deck.id)}">${topicIcon(deck)}</span><span class="deck-option-copy"><strong>${esc(deck.title)}</strong><small>${esc(deck.subtitle)}</small></span><span class="deck-count">40枚</span></label>`; };
  const filters = Object.entries(groupLabels).filter(([id]) => !(mixed && id === 'adult')).map(([id, label]) => `<button type="button" class="filter-chip ${state.filter === id ? 'is-active' : ''}" data-filter="${id}">${label}</button>`).join('');
  const chips = state.selectedDeckIds.map((id) => { const deck = decks.find((item) => item.id === id); return deck ? `<span class="selected-theme-chip">${esc(deck.title)}<button type="button" data-remove-deck="${esc(id)}" aria-label="${esc(deck.title)}を外す">×</button></span>` : ''; }).join('');
  const consent = !mixed && (selected.r18Available || selected.adultOnly), consentCopy = selected.r18Available ? 'R18を含めていい' : '参加者全員が18歳以上で、R18の話題に同意しています';
  const description = selected.adultOnly ? `<p class="deck-description">${esc(selected.description)}</p>` : '';
  const pool = (mixed ? regularDecks : state.filter === 'adult' ? r18Decks : regularDecks).filter(visible);
  const adultPool = !mixed && state.filter === 'all' ? r18Decks.filter(visible) : [];
  const regularIds = new Set(regularDecks.map((deck) => deck.id));
  const canStart = mixed ? state.selectedDeckIds.length >= 2 && state.selectedDeckIds.length <= 3 && new Set(state.selectedDeckIds).size === state.selectedDeckIds.length && state.selectedDeckIds.every((id) => regularIds.has(id)) : Boolean(selected);
  return frame(`<div class="theme-screen"><div class="screen-brand"><button class="back-link" data-action="home" aria-label="参加者を変更する">‹</button><strong>Mingle.Cards</strong></div><div class="intro compact"><h1 tabindex="-1" data-focus>質問テーマを選ぶ</h1></div><div class="mode-switch" role="radiogroup" aria-label="テーマモード"><label><input type="radio" name="theme-mode" value="single" data-mode ${!mixed ? 'checked' : ''}/> 1つのテーマ</label><label><input type="radio" name="theme-mode" value="mixed" data-mode ${mixed ? 'checked' : ''}/> テーマミックス</label></div>${mixed ? `<p class="mode-hint">通常テーマから2〜3個を選びます。${state.selectedDeckIds.length}/3</p><div class="selected-theme-chips">${chips || '<span class="limit-note">テーマを2つ選んでください</span>'}</div>` : `<p class="selected-single-theme">選択中：${esc(selected.title)}</p>`}<div class="filter-chips" role="toolbar" aria-label="テーマを絞り込む">${filters}</div><div class="deck-list" role="group" aria-label="質問テーマ"><p class="theme-group-label">${mixed ? '通常テーマ' : (state.filter === 'adult' ? '18歳以上のテーマ' : 'テーマ')}</p>${pool.map(option).join('') || '<p class="limit-note">この絞り込みに合うテーマはありません。</p>'}${adultPool.length ? `<p class="theme-group-label">R18のテーマ</p>${adultPool.map(option).join('')}` : ''}</div><div class="theme-options"><label class="consent challenge-toggle"><input type="checkbox" data-challenges ${state.includeChallenges ? 'checked' : ''} /> <span><strong>「やってみて」を入れる</strong><small>6枚につき1枚、みんなで楽しむお題が入ります。</small></span></label>${description}${consent ? `<label class="consent selected-consent"><input type="checkbox" data-adult="${esc(selected.id)}" ${state.adultConfirmed ? 'checked' : ''} /> <span><strong>${consentCopy}</strong><small>${selected.r18Available ? '6枚につき1問。全員が18歳以上で、話題に同意できるときに。' : '全員が18歳以上で、話題に同意できるときに。'}</small></span></label>` : ''}<p class="form-error" role="alert">${esc(state.error)}</p><button class="primary-button deck-start selected-start" data-action="choose-deck" data-deck="${esc(selected.id)}" ${!canStart || (!mixed && selected.adultOnly && !state.adultConfirmed) ? 'disabled' : ''}>${mixed ? 'ミックスで始める' : 'このテーマで始める'}</button></div></div>`, 'Mingle.Cards', false);
}

function participantChips(session) { return session.participants.map((name, index) => { const initial = Array.from(name.trim())[0] ?? '・'; return `<span class="participant-chip participant-color-${index} ${index === currentParticipantIndex(session) ? 'is-current' : ''}"><i aria-hidden="true">${esc(initial)}</i>${esc(name)}</span>`; }).join(''); }

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
  const segments = Array.from({ length: roundTotal }, (_, index) => `<span class="round-segment ${index < roundPosition ? 'is-done' : ''} ${index === roundPosition ? 'is-current' : ''}"></span>`).join('');
  const isChallenge = card.kind === 'challenge';
  const playTitle = session.customSet ? 'マイセット' : session.mixed ? `テーマミックス · ${session.deckIds.map((id) => decks.find((deck) => deck.id === id)?.title).filter(Boolean).join('・')}` : (decks.find((deck) => deck.id === session.deckId)?.title ?? '会話カード');
  const favorite = state.account.user && state.account.enabled && card.kind !== 'challenge' && !card.custom ? `<button type="button" class="favorite-card-button ${state.account.favorites.has(card.id) ? 'is-saved' : ''}" data-action="favorite-card" aria-pressed="${state.account.favorites.has(card.id)}" ${state.account.busy ? 'disabled' : ''}>${state.account.favorites.has(card.id) ? '★ 保存済み' : '☆ 保存'}</button>` : '';
  return frame(`<div class="play-head"><div><p class="play-deck">${esc(playTitle)}</p><p class="progress-copy" aria-label="全${session.questions.length}枚中${session.cursor + 1}枚目">${roundPosition + 1} / ${roundTotal}</p></div><button class="quiet-button" data-action="decks">テーマを変える</button></div><div class="round-progress" aria-label="今回の進み具合">${segments}</div><article class="question-card active-card ${isChallenge ? 'challenge-card' : ''}" aria-live="polite">${isChallenge ? '<span class="challenge-badge">やってみて</span>' : ''}${favorite}<p>${esc(card.text)}</p></article><div class="speaker-pill"><strong>${esc(currentSpeaker(session))}の番</strong><span>${session.answerIndex + 1} / ${session.participants.length}</span></div><div class="participant-strip" aria-label="参加者">${participantChips(session)}</div><div class="answer-actions" role="group" aria-label="回答操作"><button class="secondary-button" data-action="previous-answer" ${session.answerIndex === 0 || state.busy ? 'disabled' : ''}>前の人へ</button><button class="like-button" data-action="like" ${state.busy ? 'disabled' : ''}>♡ <span>${esc(currentSpeaker(session))}${isChallenge ? 'にいいね！' : 'の回答にいいね！'}</span> <strong>${currentAnswerLikes(session)}</strong></button><button class="primary-button" data-action="next-answer" ${state.busy ? 'disabled' : ''}>${session.answerIndex === session.participants.length - 1 ? '次のカードへ' : '次の人へ'}</button><button class="pass-button" data-action="pass" ${state.busy ? 'disabled' : ''}>パスする</button></div><p class="form-error" role="alert">${esc(state.error)}</p>`);
}

function backView(session) { const roundPosition = session.cursor % ROUND_SIZE; const roundTotal = Math.min(ROUND_SIZE, remaining(session) + roundPosition); return frame(`<div class="card-back" data-action="reveal" role="button" tabindex="0" aria-label="カードをめくる"><span class="round-badge">${roundPosition + 1} / ${roundTotal}</span><div class="back-brand"><span class="back-brand-mark" aria-hidden="true"><svg viewBox="0 0 56 56"><path d="M9 12A6 6 0 0 1 15 6h16a6 6 0 0 1 6 6v13a6 6 0 0 1-6 6H24L14 35v-4h-1a6 6 0 0 1-6-6V12Z" fill="currentColor"/><path d="M23 28a6 6 0 0 1 6-6h10a6 6 0 0 1 6 6v9a6 6 0 0 1-6 6h-4l-6 6v-6h-0a6 6 0 0 1-6-6v-9Z" fill="var(--coral)"/></svg></span><strong>Mingle.Cards</strong></div><h1 tabindex="-1" data-focus>タップしてめくる</h1></div>`); }

function feedbackState(session) {
  if (!session) return null;
  const key = feedbackKey(session.sessionId, session.cursor);
  if (!state.feedback || state.feedback.key !== key) state.feedback = { key, rating: null, text: '', status: '', error: '' };
  return state.feedback;
}
function feedbackSubmitted(session) { return Array.isArray(session?.feedbackSubmitted) && session.feedbackSubmitted.includes(session.cursor); }
function likeTotalsView(session) {
  const all = summarizeLikes(session, 0, session.cursor);
  const currentStart = Math.max(0, Math.min(session.cursor, session.roundStart ?? 0));
  const current = summarizeLikes(session, currentStart, session.cursor);
  const duplicateNames = new Set(session.participants.filter((name, index, names) => names.indexOf(name) !== index));
  const rows = (totals) => totals.map((item) => `<li class="like-total-row participant-color-${item.index}"><span class="like-total-person"><i aria-hidden="true">${esc(Array.from(item.name.trim())[0] || '・')}</i>${esc(item.name)}${duplicateNames.has(item.name) ? `（${item.index + 1}人目）` : ''}</span><strong>${Number.isSafeInteger(item.likes) && item.likes >= 0 ? item.likes : 0}</strong><span aria-hidden="true">いいね</span></li>`).join('');
  const total = session.questions.length; const isFinal = session.cursor >= total;
  const body = isFinal
    ? `<p class="like-total-label">今回の全${total}枚</p><ul>${rows(all)}</ul>${currentStart < session.cursor ? `<p class="like-total-label">最後の${session.cursor - currentStart}枚</p><ul>${rows(current)}</ul>` : ''}`
    : `<p class="like-total-label">今回の${session.cursor - currentStart}枚</p><ul>${rows(current)}</ul>${currentStart > 0 ? `<p class="like-total-label">これまでの合計（${session.cursor}枚）</p><ul>${rows(all)}</ul>` : ''}`;
  const key = `${session.sessionId}:${session.cursor}`;
  if (state.roundLikeKey !== key) { state.roundLikeKey = key; state.roundLikeExpanded = false; }
  const displayCount = isFinal ? total : session.cursor - currentStart;
  const compact = session.participants.length <= 2 ? `<ul>${rows(isFinal ? all : current)}</ul>` : `<p class="round-collapsed-copy">${session.participants.length}人分の集計</p>`;
  const hasDetails = session.participants.length > 2 || currentStart > 0;
  const detailsAction = hasDetails ? `<button type="button" class="round-section-toggle" data-action="round-like-toggle" aria-expanded="${state.roundLikeExpanded}">${state.roundLikeExpanded ? '閉じる' : '詳しく見る'}</button>` : '';
  return `<section class="like-totals" aria-labelledby="like-totals-title"><div class="round-section-head"><h2 id="like-totals-title">いいね！の集計</h2><span class="round-section-count">${displayCount}枚</span></div>${state.roundLikeExpanded && hasDetails ? body : compact}${detailsAction}</section>`;
}
function roundFavoriteContext(session) {
  const cards = completedRoundFavoriteCards(session);
  if (!cards.length) {
    if (state.roundFavorite?.sessionId === session.sessionId) state.roundFavorite = null;
    return null;
  }
  const key = `${session.sessionId}:${session.roundStart}:${session.cursor}`;
  if (!state.roundFavorite || state.roundFavorite.key !== key) state.roundFavorite = { key, sessionId: session.sessionId, roundStart: session.roundStart, cursor: session.cursor, cards, selected: new Set(), saving: false, error: '', loginPending: false, expanded: false };
  else state.roundFavorite.cards = cards;
  return state.roundFavorite;
}
function roundFavoriteView(session) {
  const context = roundFavoriteContext(session);
  if (!context) return '';
  const selectable = context.cards.filter((card) => !state.account.favorites.has(card.id));
  const selectedCount = [...context.selected].filter((id) => selectable.some((card) => card.id === id)).length;
  const rows = context.cards.map((card) => {
    const saved = state.account.favorites.has(card.id);
    const checked = saved || context.selected.has(card.id);
    const label = card.r18 === true && !session.adultConfirmed ? 'R18のテーマ' : card.text;
    return `<label class="round-favorite-row"><input type="checkbox" data-round-favorite data-card-id="${esc(card.id)}" ${checked ? 'checked' : ''} ${saved || context.saving ? 'disabled' : ''}/><span>${esc(label)}</span>${saved ? '<small>保存済み</small>' : ''}</label>`;
  }).join('');
  const action = state.account.user
    ? `<button type="button" class="secondary-button" data-action="round-favorite-save" ${context.saving || !selectedCount ? 'disabled' : ''}>${context.saving ? '保存中…' : '選択した質問を保存'}</button>`
    : state.account.enabled ? `<button type="button" class="secondary-button" data-action="round-favorite-login" ${context.saving || !selectedCount ? 'disabled' : ''}>ログインして保存</button>` : '<p class="account-muted">現在、質問を保存できません。</p>';
  const savedCount = context.cards.length - selectable.length;
  const list = context.expanded ? `<div class="round-favorite-list">${rows}</div>${action}` : `<p class="round-collapsed-copy">${selectedCount}件選択中 · ${savedCount}件保存済み</p>`;
  return `<section class="round-favorites" aria-labelledby="round-favorites-title"><div class="round-section-head"><h2 id="round-favorites-title">気に入った質問を保存</h2><span class="round-section-count">${context.cards.length}件</span></div><button type="button" class="round-section-toggle" data-action="round-favorite-toggle" aria-expanded="${context.expanded}">${context.expanded ? '閉じる' : '質問を選ぶ'}</button>${list}<p class="form-error" role="alert">${esc(context.error || '')}</p></section>`;
}
function roundView() {
  const session = state.session;
  const totalCards = session.questions.length; const isFinal = session.cursor >= totalCards; const feedback = feedbackState(session); const submitted = feedbackSubmitted(session);
  const favoriteContext = roundFavoriteContext(session); const favoriteBusy = Boolean(favoriteContext?.saving);
  const feedbackForm = submitted ? '<p class="feedback-success" role="status">フィードバック送信済み。ありがとう！</p>' : `<div class="feedback-box" aria-labelledby="feedback-title"><h2 id="feedback-title" class="feedback-heading-visually-hidden">今回のミングルはどうだった？</h2><div class="feedback-ratings" role="group" aria-label="評価"><button type="button" class="feedback-rating ${feedback.rating === 'positive' ? 'is-selected' : ''}" data-action="feedback-rating" data-rating="positive" aria-pressed="${feedback.rating === 'positive'}" ${state.feedbackBusy ? 'disabled' : ''}>いいね！</button><button type="button" class="feedback-rating ${feedback.rating === 'needs_improvement' ? 'is-selected' : ''}" data-action="feedback-rating" data-rating="needs_improvement" aria-pressed="${feedback.rating === 'needs_improvement'}" ${state.feedbackBusy ? 'disabled' : ''}>改善余地大きい！</button></div><label class="feedback-label" for="feedback-text">ひとこと（任意）</label><textarea id="feedback-text" data-feedback-text maxlength="1000" rows="3" placeholder="気づいたことがあれば" ${state.feedbackBusy ? 'disabled' : ''}>${esc(feedback.text)}</textarea><p class="form-error" role="alert">${esc(feedback.error)}</p><button type="button" class="secondary-button feedback-submit" data-action="feedback-submit" ${state.feedbackBusy || (!feedback.rating && !feedback.text.trim()) ? 'disabled' : ''}>${state.feedbackBusy ? '送信中…' : '送信する'}</button></div>`;
  const accountOverlay = state.account.open ? accountView({ overlayOnly: true }) : '';
  return frame(`<div class="round-break"><img class="round-hero" src="/assets/friends-conversation-closeup.png" alt="会話を楽しむ人たち" width="1611" height="976" /><span class="round-badge">${session.cursor} / ${totalCards}</span><h1 tabindex="-1" data-focus>今回のミングルは<br>どうだった？</h1>${likeTotalsView(session)}${roundFavoriteView(session)}${feedbackForm}<p class="form-error" role="alert">${esc(state.error)}</p><div class="break-actions">${!isFinal ? `<button class="primary-button" data-action="continue" ${state.busy || favoriteBusy ? 'disabled' : ''}>${state.busy ? '確認中…' : '続きを遊ぶ'}</button>` : ''}<button class="secondary-button" data-action="finish" ${favoriteBusy ? 'disabled' : ''}>今日はここまで</button></div><button class="back-link" data-action="decks" ${favoriteBusy ? 'disabled' : ''}>テーマを選び直す</button></div>${accountOverlay}`);
}

function finishView() { return roundView(); }


function normalizeAccountUser(user, previous = null) { if (!user) return null; const sameUser = previous?.id && user.id && previous.id === user.id; const hasDisplayName = Object.prototype.hasOwnProperty.call(user, 'displayName'); const displayName = hasDisplayName ? user.displayName : (sameUser ? previous.displayName : user.user_metadata?.display_name ?? null); return { ...user, displayName }; }
async function loadAccount() {
  if (!state.account.enabled) return;
  const generation = state.account.generation; const profileRevision = state.account.profileRevision;
  try {
    const me = await accountApi.me();
    if (generation !== state.account.generation || profileRevision !== state.account.profileRevision) return;
    state.account.user = normalizeAccountUser(me.user || null, state.account.user);
    state.account.deletionAvailable = me.account?.deletionAvailable === true;
    state.account.customCardsAvailable = me.customCardsAvailable === true;
    state.account.customCards = state.account.customCardsAvailable && Array.isArray(me.customCards) ? me.customCards.map((card) => ({ ...card, id: typeof card.id === 'string' && card.id.startsWith('custom:') ? card.id : `custom:${card.id}` })) : [];
    state.account.profileDraft = state.account.user?.displayName || '';
    syncAccountParticipantName();
    if (state.account.user) {
      if (generation !== state.account.generation || profileRevision !== state.account.profileRevision) return;
      state.account.favorites = new Set((me.favorites || []).map((item) => item.cardId || item.card_id || item.id || item));
      state.account.sets = (me.sets || []).map((set) => ({ ...set, cards: set.cards || (set.card_ids || []).map((cardId) => ({ cardId })) }));
      const loginContext = state.roundFavorite;
      if (loginContext?.loginPending && state.session && isCurrentRoundFavorite(loginContext, state.session, loginContext.key)) { loginContext.loginPending = false; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.focusAction = 'round-favorite-save'; }
      const pending = state.pendingCustomResume;
      if (pending) {
        if (state.account.customCardsAvailable && pending.ownerUserId === state.account.user.id) state.resume = pending;
        else clearSession();
        state.pendingCustomResume = null;
      }
    }
  } catch { if (generation !== state.account.generation || profileRevision !== state.account.profileRevision) return; state.account.user = null; }
  if (generation !== state.account.generation || profileRevision !== state.account.profileRevision) return;
  render();
}
async function loginWithOtp() {
  const email = state.account.email.trim();
  if (!email || state.account.busy) return;
  state.account.busy = true; state.account.error = ''; state.account.status = ''; render();
  try { if (state.account.otpSent) { await accountApi.verifyOtp(email, state.account.otp.trim()); state.account.status = 'ログインしました。'; } else { await accountApi.sendOtp(email); state.account.otpSent = true; state.account.status = '確認コードをメールに送りました。'; state.focusSelector = '[data-account-otp]'; } }
  catch { state.account.error = state.account.otpSent ? '確認コードが正しくないか、有効期限が切れています。' : '確認コードを送れませんでした。'; }
  finally { state.account.busy = false; render(); }
}
async function saveProfile() {
  if (state.account.busy || !state.account.user || !validDisplayName(state.account.profileDraft)) return;
  const generation = state.account.generation; const revision = ++state.account.profileRevision; const value = state.account.profileDraft.trim();
  state.account.busy = true; state.account.error = ''; state.account.status = ''; render();
  try { const result = await accountApi.updateProfile(value); if (generation !== state.account.generation || revision !== state.account.profileRevision) return; const user = result.user || {}; state.account.user = normalizeAccountUser({ ...state.account.user, ...user }, state.account.user); state.account.profileDraft = state.account.user.displayName || ''; syncAccountParticipantName(); state.account.status = '表示名を保存しました。'; }
  catch { if (generation === state.account.generation && revision === state.account.profileRevision) state.account.error = '表示名を保存できませんでした。'; }
  finally { if (generation === state.account.generation) { state.account.busy = false; render(); } }
}
function validCustomText(value) { return typeof value === 'string' && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value) && Array.from(value.trim()).length >= 1 && Array.from(value.trim()).length <= 300; }
async function saveCustomCard() {
  if (state.account.busy || !state.account.customCardsAvailable) return;
  if (!validCustomText(state.account.customDraft)) { state.account.error = '質問は1〜300文字で、改行せずに入力してください。'; state.account.status = ''; render(); return; }
  const generation = state.account.generation; const id = state.account.editingCardId; const text = state.account.customDraft.trim(); const r18 = state.account.customDraftR18 === true;
  state.account.busy = true; state.account.error = ''; state.account.status = ''; render();
  try {
    const result = id ? await accountApi.updateCard(id, text, r18) : await accountApi.createCard(text, r18);
    if (generation !== state.account.generation) return;
    const card = result.card || result;
    const normalized = { ...card, id: typeof card.id === 'string' && card.id.startsWith('custom:') ? card.id : `custom:${card.id}`, r18: card.r18 === true };
    state.account.customCards = id ? state.account.customCards.map((item) => item.id === id ? normalized : item) : [...state.account.customCards, normalized];
    state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = ''; state.account.customDraftR18 = false; state.account.status = '質問カードを保存しました。';
  } catch { if (generation === state.account.generation) state.account.error = '質問カードを保存できませんでした。'; }
  finally { if (generation === state.account.generation) { state.account.busy = false; render(); } }
}
async function deleteAccount() {
  if (state.account.busy || !state.account.deletionAvailable || !state.account.deleteConfirmed) return;
  const requestUserId = state.account.user?.id || null; const generation = ++state.account.generation; state.account.busy = true; state.account.error = ''; render();
  try {
    await accountApi.deleteAccount();
    if (generation !== state.account.generation && state.account.user?.id && state.account.user.id !== requestUserId) return;
    // The account is already deleted server-side. Local SDK cleanup may emit SIGNED_OUT
    // and advance generation, so it must never prevent clearing this device's game state.
    try { await accountApi.logout({ scope: 'local' }); } catch { /* server deletion succeeded; local SDK cleanup is best effort */ }
    if (state.account.user?.id && state.account.user.id !== requestUserId) return;
    clearSession(); state.session = null; state.resume = null; state.feedback = null; state.feedbackBusy = false;
    state.pendingCustomResume = null; state.account.user = null; state.account.favorites = new Set(); state.account.customCards = []; state.account.customCardsAvailable = false; state.account.sets = []; state.account.selectedCards = new Set(); state.account.editingSetId = null; state.account.setName = undefined; state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = ''; state.account.customDraftR18 = false; state.account.pendingSet = null; state.account.profileDraft = ''; state.account.deletionAvailable = false; state.account.status = ''; state.account.error = ''; state.account.otpSent = false; state.account.otp = ''; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.account.deleteConfirmed = false; state.account.busy = false; state.account.profileRevision += 1; state.account.email = ''; state.account.revealAdult = false; state.participantNameOrigin = null; state.participantNameAutoValue = ''; state.participantNameUserEdited = false; state.participants = ['', '']; state.screen = 'participants'; state.error = ''; render();
  } catch { if (generation === state.account.generation) { state.account.busy = false; state.account.error = '退会処理の結果を確認できませんでした。しばらくしてからアカウントの状態を確認してください。'; render(); } }
}
function playSavedSet(set) {
  const ids = (Array.isArray(set?.card_ids) ? set.card_ids : Array.isArray(set?.cards) ? set.cards.map((entry) => entry.cardId || entry.card_id || entry) : []).filter((id) => typeof id === 'string');
  const hasR18 = ids.some((id) => canonicalCard(id, state.account.customCards)?.r18 === true);
  if (hasR18 && !state.account.pendingSet?.consented) { state.account.pendingSet = { set, consented: false }; state.account.error = ''; render(); return; }
  state.session = createSavedSession({ participants: state.participants, cardIds: ids, customCards: state.account.customCards, ownerUserId: state.account.user?.id || null, adultConfirmed: state.account.pendingSet?.consented === true });
  state.account.pendingSet = null; state.account.open = false; state.account.status = ''; state.account.error = ''; state.account.selectedCards = new Set(); state.account.editingSetId = null; state.account.setName = undefined; state.account.revealAdult = false; state.feedback = null; state.feedbackBusy = false; state.resume = null; state.screen = 'play'; state.error = ''; trackThemeStart('my-set'); saveSession(state.session); render();
}

function submitParticipants() { try { state.participants = normalizeParticipants(state.participants); state.screen = 'decks'; state.error = ''; render(); } catch (error) { state.error = error.message; const invalidIndex = state.participants.findIndex((name) => typeof name !== 'string' || !name.trim() || Array.from(name.trim()).length > MAX_NAME_LENGTH); state.focusSelector = `input[data-index="${Math.max(0, invalidIndex)}"]`; render(); } }
function updateAdultButton() { if (state.themeMode === 'mixed') return; const button = root.querySelector('.selected-start'); const selected = decks.find((deck) => deck.id === state.selectedDeckId); if (button && selected?.adultOnly) button.disabled = !state.adultConfirmed || state.busy; }
function ensureSession() { if (!state.session) throw new Error('セッションが始まっていません'); return state.session; }
function persist(previous = null) { if (!state.session) return; if (previous) trackSessionProgress(previous, state.session); if (state.session.cursor >= state.session.questions.length) clearSession(); else saveSession(state.session); }
function advanceGuarded(action) { ensureSession(); const now = Date.now(); if (now - state.lastAdvanceAt < 300) return false; state.lastAdvanceAt = now; const previous = state.session; state.busy = true; render(); state.session = action(state.session); state.busy = false; persist(previous); render(); return true; }
function resumeSaved() { const fresh = loadResumeForCurrentUser(); if (!fresh) { state.resume = null; state.error = '保存期限が切れています。'; render(); return; } state.resume = fresh; state.session = fresh; state.participantNameOrigin = null; state.participantNameAutoValue = ''; state.participantNameUserEdited = true; state.participants = [...state.session.participants]; state.selectedDeckIds = [...(state.session.deckIds || [state.session.deckId])]; state.selectedDeckId = state.session.mixed ? state.selectedDeckIds[0] : state.session.deckId; state.themeMode = state.session.mixed ? 'mixed' : 'single'; state.includeChallenges = state.session.includeChallenges === true; state.adultConfirmed = state.session.adultConfirmed === true; state.screen = 'play'; state.resume = null; state.error = ''; render(); }

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
  context.error = '';
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
        if (isCurrentRoundFavorite(context, state.session, key) && state.account.generation === generation) context.error = '保存できなかった質問があります。もう一度保存してください。';
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

async function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  if (state.busy && action !== 'continue') return;
  state.focusAction = action;
  if (action === 'reveal') { const previous = ensureSession(); state.session = revealCard(previous); persist(previous); render(); return; }
  if (action === 'home') { state.roundFavorite = null; state.roundLikeKey = null; state.roundLikeExpanded = false; state.feedbackBusy = false; state.feedback = null; if (state.session && !isFinished(state.session)) saveSession(state.session); state.resume = loadResumeForCurrentUser(); state.screen = 'participants'; state.session = null; state.error = ''; state.includeChallenges = false; state.adultConfirmed = false; render(); return; }
  if (action === 'account') { state.account.open = true; state.account.libraryOpen = false; state.focusAction = state.account.user ? 'account-library-open' : 'account-close'; render(); return; }
  if (action === 'reset-otp') { if (state.account.busy) return; state.account.otpSent = false; state.account.otp = ''; state.account.status = ''; state.account.error = ''; render(); return; }
  if (action === 'google-login') { try { await accountApi.google(); } catch { state.account.error = 'Googleログインを開始できませんでした。'; render(); } return; }
  if (action === 'account-close') { if (state.account.busy) return; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.focusAction = 'account'; render(); return; }
  if (action === 'account-settings-open') { state.account.error = ''; state.account.status = ''; state.account.settingsOpen = true; state.account.libraryOpen = false; state.account.deleteOpen = false; state.account.profileDraft = state.account.user?.displayName || ''; state.focusSelector = '[data-profile-name]'; render(); return; }
  if (action === 'account-settings') { if (state.account.busy) return; state.account.settingsOpen = true; state.account.deleteOpen = false; state.focusSelector = '[data-profile-name]'; render(); return; }
  if (action === 'account-delete-open') { if (!state.account.deletionAvailable || state.account.busy) return; state.account.error = ''; state.account.status = ''; state.account.deleteOpen = true; state.account.deleteConfirmed = false; state.focusAction = 'account-delete-cancel'; render(); return; }
  if (action === 'account-delete-cancel') { if (state.account.busy) return; state.account.deleteOpen = false; state.account.deleteConfirmed = false; state.account.error = ''; state.focusAction = 'account-delete-open'; render(); return; }
  if (action === 'account-delete-confirm') { deleteAccount(); return; }
  if (action === 'account-menu') { if (state.account.busy) return; state.account.error = ''; state.account.status = ''; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.focusAction = 'account-settings-open'; render(); return; }
  if (action === 'account-library-open') { state.account.libraryOpen = true; state.focusAction = 'account-menu'; render(); return; }
  if (action === 'account-overlay-close') { state.account.open = false; state.account.libraryOpen = false; state.focusAction = 'account'; render(); return; }
  if (action === 'logout') { const generation = ++state.account.generation; try { const privateSession = isPrivateCustomSession(state.session) || isPrivateCustomSession(state.resume) || isPrivateCustomSession(state.pendingCustomResume); if (privateSession) { clearSession(); state.session = null; state.resume = null; state.pendingCustomResume = null; if (state.screen === 'play') state.screen = 'participants'; } await accountApi.logout(); if (generation !== state.account.generation) return; state.account.user = null; state.account.favorites = new Set(); state.account.customCards = []; state.account.customCardsAvailable = false; state.account.sets = []; state.account.selectedCards = new Set(); state.account.editingSetId = null; state.account.setName = undefined; state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = ''; state.account.customDraftR18 = false; state.account.pendingSet = null; state.account.revealAdult = false; state.account.status = ''; state.account.error = ''; state.account.otpSent = false; state.account.otp = ''; state.account.open = false; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false; state.account.deleteConfirmed = false; state.account.profileRevision += 1; state.account.profileDraft = ''; state.account.deletionAvailable = false; clearAccountParticipantName(); state.feedback = null; state.roundFavorite = null; state.resume = null; render(); } catch { if (generation === state.account.generation) { state.account.error = 'ログアウトできませんでした。もう一度お試しください。'; render(); } } return; }
  if (action === 'custom-card-new') { if (state.account.busy || !state.account.customCardsAvailable) return; state.account.customEditorOpen = true; state.account.editingCardId = null; state.account.customDraft = ''; state.account.customDraftR18 = false; state.focusSelector = '[data-custom-text]'; render(); return; }
  if (action === 'custom-card-cancel') { if (state.account.busy) return; state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = ''; state.account.customDraftR18 = false; render(); return; }
  if (action === 'custom-card-edit') { if (state.account.busy) return; const id = String(event.currentTarget.dataset.cardId || ''); const card = state.account.customCards.find((item) => item.id === id); if (!card) return; state.account.customEditorOpen = true; state.account.editingCardId = id; state.account.customDraft = card.text; state.account.customDraftR18 = card.r18 === true; state.focusSelector = '[data-custom-text]'; render(); return; }
  if (action === 'custom-card-delete') { if (state.account.busy) return; const id = String(event.currentTarget.dataset.cardId || ''); const generation = state.account.generation; state.account.busy = true; state.account.error = ''; render(); try { await accountApi.deleteCard(id); if (generation !== state.account.generation) return; state.account.customCards = state.account.customCards.filter((card) => card.id !== id); state.account.selectedCards.delete(id); state.account.status = '質問カードを削除しました。'; } catch (error) { if (generation === state.account.generation) { const names = state.account.sets.filter((set) => Array.isArray(set.card_ids) && set.card_ids.includes(id)).map((set) => set.name).filter(Boolean); state.account.error = error?.code === 'CARD_IN_USE' || error?.message === 'CARD_IN_USE' ? `この質問カードは「${names.join('」「') || 'マイセット'}」で使用中です。先にセットから外してください。` : '質問カードを削除できませんでした。'; } } finally { if (generation === state.account.generation) { state.account.busy = false; render(); } } return; }
  if (action === 'set-new') { const hasSavedCard = [...state.account.favorites].some((id) => canonicalCard(id, state.account.customCards)) || state.account.customCards.length > 0; if (state.account.busy || !hasSavedCard) return; state.account.editingSetId = null; state.account.setName = ''; state.account.selectedCards = new Set(); state.account.error = ''; state.focusSelector = '[data-set-name]'; render(); return; }
  if (action === 'set-cancel') { state.account.editingSetId = null; state.account.setName = undefined; state.account.selectedCards = new Set(); render(); return; }
  if (action === 'set-edit') { if (state.account.busy) return; const set = state.account.sets.find((item) => item.id === event.currentTarget.dataset.setId); state.account.editingSetId = set?.id || null; state.account.setName = set?.name || ''; state.account.selectedCards = new Set(set?.card_ids || []); render(); return; }
  if (action === 'set-delete') { if (state.account.busy) return; const id = event.currentTarget.dataset.setId; const generation = state.account.generation; state.account.busy = true; render(); try { await accountApi.deleteSet(id); if (generation !== state.account.generation) return; state.account.sets = state.account.sets.filter((set) => set.id !== id); state.account.status = '削除しました。'; } catch { if (generation === state.account.generation) state.account.error = 'セットを削除できませんでした。'; } finally { if (generation === state.account.generation) { state.account.busy = false; render(); } } return; }
  if (action === 'remove-favorite') { if (state.account.busy) return; const id = event.currentTarget.dataset.cardId; const generation = state.account.generation; state.account.busy = true; render(); try { await accountApi.favorite({ id }, false); if (generation !== state.account.generation) return; state.account.favorites.delete(id); state.account.selectedCards.delete(id); } catch { if (generation === state.account.generation) state.account.error = 'お気に入りを更新できませんでした。'; } finally { if (generation === state.account.generation) { state.account.busy = false; render(); } } return; }
  if (action === 'set-play') { if (state.account.busy) return; const set = state.account.sets.find((item) => item.id === event.currentTarget.dataset.setId); state.account.pendingSet = null; try { playSavedSet(set); } catch (error) { state.account.error = error.message; render(); } return; }
  if (action === 'confirm-set-play') { const pending = state.account.pendingSet; if (!pending) return; state.account.pendingSet = { ...pending, consented: true }; try { playSavedSet(pending.set); } catch (error) { state.account.error = error.message; render(); } return; }
  if (action === 'favorite-card') {
    if (state.account.busy) return;
    const session = ensureSession(); const card = currentCard(session); if (!state.account.user || !card) return;
    const saved = !state.account.favorites.has(card.id); const generation = state.account.generation; state.error = ''; state.account.busy = true; render();
    try { await accountApi.favorite(cardPayload(card, session.mixed ? card.sourceDeckId : session.deckId), saved); if (generation !== state.account.generation) return; if (saved) state.account.favorites.add(card.id); else state.account.favorites.delete(card.id); }
    catch { if (state.account.generation === generation) state.error = '保存状態を更新できませんでした。'; }
    finally { if (generation === state.account.generation) { state.account.busy = false; render(); } }
    return;
  }
  if (action === 'round-like-toggle') { state.roundLikeExpanded = !state.roundLikeExpanded; render(); return; }
  if (action === 'round-favorite-toggle') { const context = state.roundFavorite; if (!context || context.saving) return; context.expanded = !context.expanded; render(); return; }
  if (action === 'round-favorite-login') {
    const context = state.roundFavorite;
    if (!context || context.saving || ![...context.selected].some((id) => !state.account.favorites.has(id)) || !state.account.enabled) return;
    state.account.open = true; state.account.libraryOpen = false; state.account.settingsOpen = false; state.account.deleteOpen = false;
    state.account.error = ''; state.account.status = ''; context.loginPending = true; state.focusSelector = '[data-account-email]'; render(); return;
  }
  if (action === 'round-favorite-save') { saveRoundFavorites(); return; }
  if (action === 'add-person') { if (state.participants.length < MAX_PARTICIPANTS) { state.participants.push(''); state.focusSelector = `input[data-index="${state.participants.length - 1}"]`; } render(); return; }
  if (action === 'remove-person') { if (state.participants.length > 2) { state.participants.pop(); state.focusSelector = `input[data-index="${state.participants.length - 1}"]`; } render(); return; }
  if (action === 'decks') { state.roundFavorite = null; state.roundLikeKey = null; state.roundLikeExpanded = false; state.feedbackBusy = false; state.feedback = null; state.screen = 'decks'; state.error = ''; state.busy = false; render(); return; }
  if (action === 'choose-deck') { const deck = decks.find((item) => item.id === event.currentTarget.dataset.deck); const adultConfirmed = state.adultConfirmed; const includeR18 = Boolean(state.themeMode !== 'mixed' && deck?.r18Available && adultConfirmed); try { state.session = state.themeMode === 'mixed' ? createMixedSession({ participants: state.participants, decks: state.selectedDeckIds.map((id) => decks.find((item) => item.id === id)), includeChallenges: state.includeChallenges }) : createSession({ participants: state.participants, deck, adultConfirmed, includeR18, includeChallenges: state.includeChallenges }); state.session.feedbackSubmitted = []; state.feedback = null; state.resume = null; trackThemeStart(state.session.deckId); saveSession(state.session); state.screen = 'play'; state.error = ''; render(); } catch (error) { state.error = error.message; render(); } return; }
  if (action === 'feedback-rating') { const feedback = feedbackState(ensureSession()); feedback.rating = feedback.rating === event.currentTarget.dataset.rating ? null : event.currentTarget.dataset.rating; feedback.error = ''; state.focusSelector = `[data-rating="${event.currentTarget.dataset.rating}"]`; render(); return; }
  if (action === 'feedback-submit') {
    if (state.feedbackBusy) return;
    const session = ensureSession(); const feedback = feedbackState(session); let payload;
    try { payload = buildFeedbackPayload(session, session.cursor, feedback.rating, feedback.text); } catch (error) { feedback.error = error.message === 'feedback-empty' ? '評価かひとことを入力してください。' : '入力内容を確認してください。'; render(); return; }
    const key = feedback.key; const capturedSessionId = session.sessionId; const capturedCursor = session.cursor; const token = ++state.feedbackRequestToken; state.feedbackBusy = true; feedback.error = ''; render();
    try {
      await submitFeedback(payload);
      if (state.feedbackRequestToken !== token) return;
      const current = state.session?.sessionId === capturedSessionId ? state.session : null;
      if (current) { current.feedbackSubmitted = [...new Set([...(current.feedbackSubmitted || []), capturedCursor])]; saveSession(current); }
      else { const saved = loadResumeForCurrentUser(); if (saved?.sessionId === capturedSessionId) { saved.feedbackSubmitted = [...new Set([...(saved.feedbackSubmitted || []), capturedCursor])]; saveSession(saved); } }
      state.feedbackBusy = false;
      if (state.session?.sessionId === capturedSessionId && feedbackKey(state.session.sessionId, state.session.cursor) === key) render(); else if (state.screen === 'participants') state.resume = loadResumeForCurrentUser();
    } catch {
      if (state.feedbackRequestToken === token && state.session?.sessionId === capturedSessionId && feedbackKey(state.session.sessionId, state.session.cursor) === key) { state.feedbackBusy = false; feedback.error = '送信できませんでした。もう一度お試しください。'; render(); }
    }
    return;
  }
  if (action === 'like') { const previous = ensureSession(); state.session = likeCurrentAnswer(previous); persist(previous); render(); return; }
  if (action === 'next-answer') { try { advanceGuarded(nextAnswer); } catch (error) { state.error = error.message; render(); } return; }
  if (action === 'previous-answer') { const previous = ensureSession(); state.session = previousAnswer(previous); persist(previous); render(); return; }
  if (action === 'pass') { try { advanceGuarded(passAnswer); } catch (error) { state.error = error.message; render(); } return; }
  if (action === 'continue') { state.roundFavorite = null; state.roundLikeKey = null; state.roundLikeExpanded = false; state.feedbackBusy = false; state.feedback = null; state.busy = true; state.error = ''; render(); try { const previous = ensureSession(); if (await canContinue(state.session)) { state.session = continueRound(state.session); persist(previous); } else state.error = '続きを始められませんでした。'; } catch (error) { state.error = error.message || '続きを始められませんでした。'; } finally { state.busy = false; render(); } return; }
  if (action === 'finish') { state.roundFavorite = null; state.roundLikeKey = null; state.roundLikeExpanded = false; state.feedbackBusy = false; state.feedback = null; state.resume = loadResumeForCurrentUser(); state.screen = 'participants'; state.session = null; state.error = ''; state.includeChallenges = false; state.adultConfirmed = false; render(); }
}

let webMcpRegistered = false;
function registerWebMcp() {
  if (webMcpRegistered || !document.modelContext?.registerTool) return;
  webMcpRegistered = true;
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  const empty = { type: 'object', additionalProperties: false, properties: {} };
  const register = (tool) => { try { return Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); } catch { return undefined; } };
  const tools = [
    { name: 'read_state', description: '現在の画面とカード進行を読む', inputSchema: empty, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); const session = state.session; return { screen: state.screen, participants: state.participants, cursor: session?.cursor ?? 0, unlockedUntil: session?.unlockedUntil ?? 0, deckId: session?.deckId ?? null, deckIds: session?.deckIds ?? [], mixed: session?.mixed === true, includeR18: session?.includeR18 ?? false, includeChallenges: session?.includeChallenges ?? false, revealed: session?.revealed ?? false, currentSpeaker: session?.revealed ? currentSpeaker(session) : null, answerIndex: session?.answerIndex ?? 0, likes: session?.likes ?? {} }; } },
    { name: 'start_session', description: '参加者とデッキを検証してカード裏から開始する', inputSchema: { type: 'object', additionalProperties: false, properties: { participants: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string' } }, deckId: { type: 'string' }, deckIds: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' } }, adultConfirmed: { type: 'boolean' }, includeR18: { type: 'boolean' }, includeChallenges: { type: 'boolean' } }, required: ['participants'] }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (payload, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); if (payload?.deckId && Array.isArray(payload?.deckIds)) throw new Error('deckIdとdeckIdsは同時に指定できません'); const ids = Array.isArray(payload?.deckIds) ? payload.deckIds : []; if (ids.length && payload?.includeR18 === true) throw new Error('ミックスではR18を選べません'); const next = ids.length ? createMixedSession({ participants: payload?.participants, decks: ids.map((id) => decks.find((item) => item.id === id)), includeChallenges: payload?.includeChallenges === true, includeR18: payload?.includeR18 === true }) : createSession({ participants: payload?.participants, deck: decks.find((item) => item.id === payload?.deckId), adultConfirmed: payload?.adultConfirmed === true, includeR18: payload?.includeR18 === true, includeChallenges: payload?.includeChallenges === true }); state.participants = next.participants; state.participantNameOrigin = null; state.participantNameAutoValue = ''; state.participantNameUserEdited = true; state.session = next; state.feedback = null; state.feedbackBusy = false; state.selectedDeckId = next.mixed ? next.deckIds[0] : next.deckId; state.selectedDeckIds = next.deckIds; state.themeMode = next.mixed ? 'mixed' : 'single'; state.includeChallenges = next.includeChallenges; state.adultConfirmed = next.adultConfirmed; state.resume = null; saveSession(next); trackThemeStart(next.deckId); state.screen = 'play'; state.error = ''; render(); return { ok: true }; } },
    { name: 'reveal_card', description: '現在のカードをめくる', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); const previous = ensureSession(); state.session = revealCard(previous); persist(previous); render(); return { ok: true, revealed: true }; } },
    { name: 'like_current_answer', description: '現在の回答者にいいねする', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); const previous = ensureSession(); state.session = likeCurrentAnswer(previous); persist(previous); render(); return { ok: true, likes: currentAnswerLikes(state.session) }; } },
    { name: 'next_answer', description: '同じ質問の次の回答者へ進む', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); advanceGuarded(nextAnswer); return { ok: true, cursor: state.session.cursor, answerIndex: state.session.answerIndex }; } },
    { name: 'pass_answer', description: '現在の回答者をパスする', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); advanceGuarded(passAnswer); return { ok: true, cursor: state.session.cursor, answerIndex: state.session.answerIndex }; } },
    { name: 'continue_round', description: '6枚区切りの続きを許可する', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); const previous = ensureSession(); state.feedback = null; state.feedbackBusy = false; if (!await canContinue(state.session)) throw new Error('続きを始められませんでした。'); state.session = continueRound(state.session); persist(previous); render(); return { ok: true, unlockedUntil: state.session.unlockedUntil }; } },
  ];
  tools.forEach(register);
}

try { const saved = loadSession(); if (saved?.customSet && saved.ownerUserId) state.pendingCustomResume = saved; else state.resume = saved; } catch { state.resume = null; state.pendingCustomResume = null; }
render();
discoverAccountConfig().then(() => { state.account.enabled = accountConfig.enabled; state.account.google = accountConfig.google; if (!state.account.enabled && state.pendingCustomResume) { clearSession(); state.pendingCustomResume = null; } if (state.account.enabled) { loadAccount(); accountApi.onAuthStateChange?.((event, session) => { setTimeout(() => { const nextUser = session?.user || null; const previousId = state.account.user?.id || null; const nextId = nextUser?.id || null; const identityChanged = Boolean(previousId && nextId && previousId !== nextId); if (event === 'SIGNED_OUT' || identityChanged) state.roundFavorite = null; const privateResume = isPrivateCustomSession(state.session) || isPrivateCustomSession(state.resume) || isPrivateCustomSession(state.pendingCustomResume); if (event === 'SIGNED_OUT' || identityChanged) clearAccountParticipantName(); if ((event === 'SIGNED_OUT' || identityChanged) && privateResume) { clearSession(); state.session = null; state.resume = null; state.pendingCustomResume = null; if (state.screen === 'play') state.screen = 'participants'; } if (previousId === nextId && event !== 'SIGNED_OUT') { if (nextId) state.account.user = normalizeAccountUser(nextUser, state.account.user); return; } state.account.generation += 1; state.account.profileRevision += 1; state.account.busy = false; state.account.user = normalizeAccountUser(nextUser); state.account.favorites = new Set(); state.account.customCards = []; state.account.customCardsAvailable = false; state.account.sets = []; state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = ''; state.account.customDraftR18 = false; state.account.selectedCards = new Set(); state.account.editingSetId = null; state.account.setName = undefined; state.account.pendingSet = null; state.account.revealAdult = false; state.account.status = ''; state.account.error = ''; const preserveRound = Boolean(state.roundFavorite?.loginPending && state.session && nextId && !previousId); if (!preserveRound) state.feedback = null; state.resume = null; if (state.account.user) { render(); loadAccount(); } else { state.account.favorites = new Set(); state.account.customCards = []; state.account.customCardsAvailable = false; state.account.customEditorOpen = false; state.account.editingCardId = null; state.account.customDraft = ''; state.account.customDraftR18 = false; state.account.sets = []; render(); } }, 0); }); } }).catch(() => {});
