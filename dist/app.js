import { decks } from './data/decks.js';
import { trackPage, trackThemeStart } from './analytics.js';
import { canContinue } from './access-policy.js';
import { ROUND_SIZE, createSession, currentAnswerLikes, currentCard, currentParticipantIndex, currentSpeaker, isFinished, isRoundComplete, likeCurrentAnswer, nextAnswer, passAnswer, previousAnswer, remaining, revealCard, continueRound, normalizeParticipants, MAX_NAME_LENGTH, MAX_PARTICIPANTS } from './engine.js';

const root = document.querySelector('#app');
const state = { screen: 'participants', participants: ['', ''], session: null, error: '', busy: false, lastAdvanceAt: 0, focusAction: null, focusSelector: null, selectedDeckId: 'friends', adultConfirmed: false, includeChallenges: false };

function esc(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function participantAvatar(name) { const first = Array.from(name.trim())[0]; if (first) return esc(first); return `<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="21" fill="var(--participant-bg)"/><circle cx="16" cy="19" r="2" fill="var(--participant-fg)"/><circle cx="28" cy="19" r="2" fill="var(--participant-fg)"/><path d="M15 27c2.2 3.4 11.8 3.4 14 0" fill="none" stroke="var(--participant-fg)" stroke-width="2" stroke-linecap="round"/></svg>`; }

function render() {
  root.innerHTML = state.screen === 'participants' ? participantsView() : state.screen === 'decks' ? decksView() : playView();
  root.dataset.screen = state.screen;
  if (state.screen === 'participants') {
    const badge = document.createElement('p');
    badge.className = 'alpha-badge';
    badge.textContent = 'α版';
    root.querySelector('.masthead-slot')?.after(badge);
  }
  trackPage(state.screen);
  root.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', handleAction));
  root.querySelector('form[data-form="participants"]')?.addEventListener('submit', (event) => { event.preventDefault(); submitParticipants(); });
  root.querySelectorAll('input[name="participant"]').forEach((input) => {
    input.addEventListener('input', (event) => { state.participants[Number(event.target.dataset.index)] = event.target.value; });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.nativeEvent?.isComposing) return;
      event.preventDefault();
      const fields = [...root.querySelectorAll('input[name="participant"]')];
      const index = fields.indexOf(event.currentTarget);
      if (fields[index + 1]) { fields[index + 1].focus({ preventScroll: false }); fields[index + 1].scrollIntoView({ block: 'nearest' }); }
      else event.currentTarget.form?.requestSubmit();
    });
  });
  root.querySelectorAll('[data-adult]').forEach((input) => input.addEventListener('change', (event) => { state.adultConfirmed = event.target.checked; updateAdultButton(); }));
  root.querySelector('[data-challenges]')?.addEventListener('change', (event) => { state.includeChallenges = event.target.checked; });
  root.querySelectorAll('[data-deck-select]').forEach((input) => input.addEventListener('change', (event) => { state.selectedDeckId = event.target.value; state.adultConfirmed = false; state.focusSelector = `input[data-deck-select][value="${event.target.value}"]`; state.error = ''; render(); }));
  root.querySelector('.card-back')?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); state.session = revealCard(ensureSession()); render(); } });
  updateAdultButton();
  const pendingFocusSelector = state.focusSelector;
  const focusTarget = pendingFocusSelector ? root.querySelector(pendingFocusSelector) : state.focusAction ? root.querySelector(`[data-action="${state.focusAction}"]`) : null;
  const shouldScrollToInput = Boolean(pendingFocusSelector?.includes('participant') || pendingFocusSelector?.includes('data-index'));
  state.focusSelector = null;
  state.focusAction = null;
  const focusElement = focusTarget || root.querySelector('[data-focus]');
  focusElement?.focus({ preventScroll: Boolean(focusTarget && !shouldScrollToInput) });
  if (focusTarget && shouldScrollToInput) focusTarget.scrollIntoView({ block: 'nearest' });
  registerWebMcp();
}

function frame(content, eyebrow = 'Mingle.Cards', withHeader = true) { const quietText = state.session?.revealed && currentCard(state.session)?.kind === 'challenge' ? 'やりたくないお題はパスしてOK' : '話したくない質問はパスしてOK'; return `${withHeader ? `<header class="topbar"><button class="brand" data-action="home" aria-label="最初に戻る"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M6 7.5A3.5 3.5 0 0 1 9.5 4h9A3.5 3.5 0 0 1 22 7.5v7a3.5 3.5 0 0 1-3.5 3.5H14l-5 5v-5h-.5A3.5 3.5 0 0 1 5 14.5v-7Z" fill="currentColor"/><path d="M13 15.5A3.5 3.5 0 0 1 16.5 12h6A3.5 3.5 0 0 1 26 15.5v5a3.5 3.5 0 0 1-3.5 3.5H20l-3.5 3v-3h-.5a3.5 3.5 0 0 1-3.5-3.5v-5Z" fill="var(--coral)"/></svg></span><span>${eyebrow}</span></button><span class="quiet">${quietText}</span></header>` : ''}<section class="content">${content}</section>`; }

function participantsView() {
  const atLimit = state.participants.length >= MAX_PARTICIPANTS;
  return frame(`<div class="home-screen"><div class="masthead-slot"><img class="masthead-image" src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards。やっぱり人って面白い。" width="1493" height="1054" /><h1 class="visually-hidden" tabindex="-1" data-focus>Mingle.Cards</h1></div><form class="panel form-panel" data-form="participants"><div class="participant-list">${state.participants.map((name, index) => `<label class="name-field"><span class="name-avatar participant-color-${index}">${participantAvatar(name)}</span><input name="participant" data-index="${index}" value="${esc(name)}" maxlength="${MAX_NAME_LENGTH}" placeholder="呼び名" aria-label="${index + 1}人目の呼び名" autocomplete="off" enterkeyhint="${index === state.participants.length - 1 ? 'done' : 'next'}" /></label>`).join('')}</div><div class="inline-actions"><button type="button" class="text-button add-person" data-action="add-person" ${atLimit ? 'disabled' : ''}>＋ 参加者を追加</button>${state.participants.length > 2 ? '<button type="button" class="text-button muted" data-action="remove-person">最後の人を削除</button>' : ''}<span class="limit-note">${atLimit ? '8人まで' : ''}</span></div><p class="form-error" role="alert">${esc(state.error)}</p><button type="submit" class="primary-button">質問テーマを選ぶ</button></form><img class="home-illustration" src="/assets/friends-conversation-closeup.png" alt="会話を楽しむ人たちのイラスト" width="1611" height="976" /></div>`, 'Mingle.Cards', false);
}

function topicIcon(deck) {
const paths = { date: '<path d="m12 20-1.7-1.55C4.25 12.93 1 9.9 1 6.2A5.2 5.2 0 0 1 6.2 1c1.7 0 3.32.8 4.3 2.06A5.57 5.57 0 0 1 14.8 1 5.2 5.2 0 0 1 20 6.2c0 3.7-3.25 6.73-9.3 12.25L12 20Z"/>', couples: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>', intimacy: '<path d="M12 2c3.8 2.4 5.5 5.3 5.5 8.2A5.5 5.5 0 0 1 12 15.7a5.5 5.5 0 0 1-5.5-5.5C6.5 7.3 8.2 4.4 12 2Zm0 13.7c3.1 0 5.5 1.2 5.5 2.8S15.1 21 12 21s-5.5-1.1-5.5-2.5 2.4-2.8 5.5-2.8Z"/>', friends: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 19c.5-3 2.5-4.5 6-4.5S13.5 16 14 19M10 19c.5-3 2.5-4.5 6-4.5 2.4 0 4 .8 5 2.5"/>', founders: '<path d="M12 2 14.8 8l6.2.6-4.7 4.1 1.4 6.1-5.7-3.3-5.7 3.3 1.4-6.1-4.7-4.1L9.2 8 12 2Z"/>', team: '<path d="M4 18V7h16v11M8 7V4h8v3M2 20h20M9 12h6M9 15h6"/>', 'sports-teammates': '<circle cx="12" cy="12" r="8"/><path d="m4.8 8.3 5.1 1.4 3.1-4.3M10 9.7l2.6 4.2 5.1 1.5M12.6 13.9l-4.2 2.6"/>', 'parent-50plus': '<path d="m3 11 9-7 9 7v9H3v-9Zm5 9v-5h8v5M7 11h10"/>', 'parent-under12': '<path d="M12 3v18M3 12h18"/>', reunion: '<path d="M4 5h16v11H8l-4 4V5Z"/><path d="M8 9h8M8 12h5"/>', siblings: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 19c.5-3 2.5-5 6-5s5.5 2 6 5M10 19c.5-3 2.5-5 6-5 3.5 0 5.5 2 6 5"/>', 'new-couple': '<path d="M12 20S3 14.8 3 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 9 2.5C21 14.8 12 20 12 20Z"/>', 'moving-in': '<path d="m3 11 9-8 9 8v9H3v-9Z"/><path d="M9 20v-6h6v6M7 11h10"/>', 'first-intimacy': '<path d="M12 20S4 15.5 4 9a4 4 0 0 1 8-2 4 4 0 0 1 8 2c0 6.5-8 11-8 11Z"/><path d="M12 10v4M10 12h4"/>', 'intimacy-refresh': '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 5v5h5"/><path d="M12 8v4l3 2"/>', 'intimacy-distance': '<circle cx="8" cy="12" r="3"/><circle cx="16" cy="12" r="3"/><path d="M11 12h2M8 9V6M16 15v3"/>', 'family-reunion': '<path d="M3 10 12 3l9 7v10H3V10Z"/><path d="M8 20v-6h8v6M7 10h10"/>', 'new-colleagues': '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 20c.5-4 2.5-6 5-6s4.5 2 5 6M13 14h8M17 10v8"/>' };
  paths.omiai = '<path d="M3 10.5 12 3l9 7.5v9H3v-9Z"/><path d="M8 20v-5h8v5M7 10h10"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[deck.id] ?? paths.team}</svg>`;
}

function decksView() {
  const selected = decks.find((deck) => deck.id === state.selectedDeckId) ?? decks.find((deck) => !deck.adultOnly) ?? decks[0];
  const option = (deck) => `<label class="deck-option ${deck.id === selected.id ? 'is-selected' : ''}"><input type="radio" name="deck" value="${esc(deck.id)}" data-deck-select ${deck.id === selected.id ? 'checked' : ''} /><span class="topic-icon topic-${esc(deck.id)}">${topicIcon(deck)}</span><span class="deck-option-copy"><strong>${esc(deck.title)}</strong><small>${esc(deck.subtitle)}</small></span><span class="deck-count">40枚</span></label>`;
  const regularDecks = decks.filter((deck) => !deck.adultOnly);
  const r18Decks = decks.filter((deck) => deck.adultOnly);
  const consent = selected.r18Available || selected.adultOnly;
  const consentCopy = selected.r18Available ? 'R18を含めていい' : '参加者全員が18歳以上で、R18の話題に同意しています';
  const consentNote = selected.r18Available ? '6枚につき1問。全員が18歳以上で、話題に同意している場合に選んでください。' : '';
  const description = selected.adultOnly ? `<p class="deck-description">${esc(selected.description)}</p>` : '';
  return frame(`<div class="theme-screen"><div class="screen-brand"><button class="back-link" data-action="home" aria-label="参加者を変更する">‹</button><strong>Mingle.Cards</strong></div><div class="intro compact"><h1 tabindex="-1" data-focus>質問テーマを選ぶ</h1></div><div class="deck-list" role="radiogroup" aria-label="質問テーマ"><p class="theme-group-label">ふだんのテーマ</p>${regularDecks.map(option).join('')}<p class="theme-group-label">18歳以上のテーマ</p>${r18Decks.map(option).join('')}</div><label class="consent challenge-toggle"><input type="checkbox" data-challenges ${state.includeChallenges ? 'checked' : ''} /> <span><strong>「やってみて」を入れる</strong><small>6枚につき1枚、みんなで楽しむお題が入ります。</small></span></label>${description}${consent ? `<label class="consent selected-consent"><input type="checkbox" data-adult="${esc(selected.id)}" ${state.adultConfirmed ? 'checked' : ''} /> <span><strong>${consentCopy}</strong>${consentNote ? `<small>${consentNote}</small>` : ''}</span></label>` : ''}<p class="form-error" role="alert">${esc(state.error)}</p><button class="primary-button deck-start selected-start" data-action="choose-deck" data-deck="${esc(selected.id)}" ${selected.adultOnly && !state.adultConfirmed ? 'disabled' : ''}>このテーマで始める</button></div>`, 'Mingle.Cards', false);
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
  return frame(`<div class="play-head"><div><p class="play-deck">${esc(decks.find((deck) => deck.id === session.deckId)?.title ?? '会話カード')}</p><p class="progress-copy" aria-label="全${session.questions.length}枚中${session.cursor + 1}枚目">${roundPosition + 1} / ${roundTotal}</p></div><button class="quiet-button" data-action="decks">テーマを変える</button></div><div class="round-progress" aria-label="今回の進み具合">${segments}</div><article class="question-card active-card ${isChallenge ? 'challenge-card' : ''}" aria-live="polite">${isChallenge ? '<span class="challenge-badge">やってみて</span>' : ''}<p>${esc(card.text)}</p></article><div class="speaker-pill"><strong>${esc(currentSpeaker(session))}の番</strong><span>${session.answerIndex + 1} / ${session.participants.length}</span></div><div class="participant-strip" aria-label="参加者">${participantChips(session)}</div><div class="answer-actions" role="group" aria-label="回答操作"><button class="secondary-button" data-action="previous-answer" ${session.answerIndex === 0 || state.busy ? 'disabled' : ''}>前の人へ</button><button class="like-button" data-action="like" ${state.busy ? 'disabled' : ''}>♡ <span>${esc(currentSpeaker(session))}${isChallenge ? 'にいいね！' : 'の回答にいいね！'}</span> <strong>${currentAnswerLikes(session)}</strong></button><button class="primary-button" data-action="next-answer" ${state.busy ? 'disabled' : ''}>${session.answerIndex === session.participants.length - 1 ? '次のカードへ' : '次の人へ'}</button><button class="pass-button" data-action="pass" ${state.busy ? 'disabled' : ''}>パスする</button></div>`);
}

function backView(session) { const roundPosition = session.cursor % ROUND_SIZE; const roundTotal = Math.min(ROUND_SIZE, remaining(session) + roundPosition); return frame(`<div class="card-back" data-action="reveal" role="button" tabindex="0" aria-label="カードをめくる"><span class="round-badge">${roundPosition + 1} / ${roundTotal}</span><div class="back-brand"><span class="back-brand-mark" aria-hidden="true"><svg viewBox="0 0 56 56"><path d="M9 12A6 6 0 0 1 15 6h16a6 6 0 0 1 6 6v13a6 6 0 0 1-6 6H24L14 35v-4h-1a6 6 0 0 1-6-6V12Z" fill="currentColor"/><path d="M23 28a6 6 0 0 1 6-6h10a6 6 0 0 1 6 6v9a6 6 0 0 1-6 6h-4l-6 6v-6h-0a6 6 0 0 1-6-6v-9Z" fill="var(--coral)"/></svg></span><strong>Mingle.Cards</strong></div><h1 tabindex="-1" data-focus>タップしてめくる</h1></div>`); }

function roundView() { const session = state.session; return frame(`<div class="round-break"><span class="round-badge">${session.cursor} / 40</span><p class="kicker">ひと区切り</p><h1 tabindex="-1" data-focus>${session.cursor === 40 ? 'すべてめくりました。' : '6枚めくりました。'}</h1><p class="lead">${session.cursor === 40 ? 'このテーマのカードを全部めくりました。' : `まだ${remaining(session)}枚あります。続きを遊ぶか、今日はここまでにできます。`}</p><p class="form-error" role="alert">${esc(state.error)}</p><div class="break-actions">${session.cursor < 40 ? `<button class="primary-button" data-action="continue" ${state.busy ? 'disabled' : ''}>${state.busy ? '確認中…' : '続きを遊ぶ'}</button>` : ''}<button class="secondary-button" data-action="finish">今日はここまで</button></div><button class="back-link" data-action="decks">テーマを選び直す</button></div>`); }
function finishView() { return roundView(); }

function submitParticipants() { try { state.participants = normalizeParticipants(state.participants); state.screen = 'decks'; state.error = ''; render(); } catch (error) { state.error = error.message; const invalidIndex = state.participants.findIndex((name) => typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME_LENGTH); state.focusSelector = `input[data-index="${Math.max(0, invalidIndex)}"]`; render(); } }
function updateAdultButton() { const button = root.querySelector('.selected-start'); const selected = decks.find((deck) => deck.id === state.selectedDeckId); if (button && selected?.adultOnly) button.disabled = !state.adultConfirmed || state.busy; }
function ensureSession() { if (!state.session) throw new Error('セッションが始まっていません'); return state.session; }
function advanceGuarded(action) { ensureSession(); const now = Date.now(); if (now - state.lastAdvanceAt < 300) return false; state.lastAdvanceAt = now; state.busy = true; render(); state.session = action(state.session); state.busy = false; render(); return true; }

async function handleAction(event) {
  if (state.busy && event.currentTarget.dataset.action !== 'continue') return;
  const action = event.currentTarget.dataset.action;
  state.focusAction = action;
  if (action === 'reveal') { state.session = revealCard(ensureSession()); render(); return; }
  if (action === 'home') { state.screen = 'participants'; state.session = null; state.error = ''; state.includeChallenges = false; state.adultConfirmed = false; render(); return; }
  if (action === 'add-person') { if (state.participants.length < MAX_PARTICIPANTS) { state.participants.push(''); state.focusSelector = `input[data-index="${state.participants.length - 1}"]`; } render(); return; }
  if (action === 'remove-person') { if (state.participants.length > 2) { state.participants.pop(); state.focusSelector = `input[data-index="${state.participants.length - 1}"]`; } render(); return; }
  if (action === 'decks') { state.screen = 'decks'; state.error = ''; state.busy = false; render(); return; }
  if (action === 'choose-deck') { const deck = decks.find((item) => item.id === event.currentTarget.dataset.deck); const adultConfirmed = state.adultConfirmed; const includeR18 = Boolean(deck.r18Available && adultConfirmed); try { state.session = createSession({ participants: state.participants, deck, adultConfirmed, includeR18, includeChallenges: state.includeChallenges }); trackThemeStart(deck.id); state.screen = 'play'; state.error = ''; render(); } catch (error) { state.error = error.message; render(); } return; }
  if (action === 'like') { state.session = likeCurrentAnswer(ensureSession()); render(); return; }
  if (action === 'next-answer') { try { advanceGuarded(nextAnswer); } catch (error) { state.error = error.message; render(); } return; }
  if (action === 'previous-answer') { state.session = previousAnswer(ensureSession()); render(); return; }
  if (action === 'pass') { try { advanceGuarded(passAnswer); } catch (error) { state.error = error.message; render(); } return; }
  if (action === 'continue') { state.busy = true; state.error = ''; render(); try { ensureSession(); if (await canContinue(state.session)) state.session = continueRound(state.session); else state.error = '続きを始められませんでした。'; } catch (error) { state.error = error.message || '続きを始められませんでした。'; } finally { state.busy = false; render(); } return; }
  if (action === 'finish') { state.screen = 'decks'; state.session = null; state.error = ''; state.includeChallenges = false; state.adultConfirmed = false; render(); }
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
    { name: 'read_state', description: '現在の画面とカード進行を読む', inputSchema: empty, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); const session = state.session; return { screen: state.screen, participants: state.participants, cursor: session?.cursor ?? 0, unlockedUntil: session?.unlockedUntil ?? 0, includeR18: session?.includeR18 ?? false, includeChallenges: session?.includeChallenges ?? false, revealed: session?.revealed ?? false, currentSpeaker: session?.revealed ? currentSpeaker(session) : null, answerIndex: session?.answerIndex ?? 0, likes: session?.likes ?? {} }; } },
    { name: 'start_session', description: '参加者とデッキを検証してカード裏から開始する', inputSchema: { type: 'object', additionalProperties: false, properties: { participants: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string' } }, deckId: { type: 'string' }, adultConfirmed: { type: 'boolean' }, includeR18: { type: 'boolean' }, includeChallenges: { type: 'boolean' } }, required: ['participants', 'deckId'] }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (payload, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); const deck = decks.find((item) => item.id === payload?.deckId); const next = createSession({ participants: payload?.participants, deck, adultConfirmed: payload?.adultConfirmed === true, includeR18: payload?.includeR18 === true, includeChallenges: payload?.includeChallenges === true }); state.participants = next.participants; state.session = next; state.selectedDeckId = next.deckId; state.includeChallenges = next.includeChallenges; state.adultConfirmed = next.adultConfirmed; trackThemeStart(deck.id); state.screen = 'play'; state.error = ''; render(); return { ok: true }; } },
    { name: 'reveal_card', description: '現在のカードをめくる', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); state.session = revealCard(ensureSession()); render(); return { ok: true, revealed: true }; } },
    { name: 'like_current_answer', description: '現在の回答者にいいねする', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); state.session = likeCurrentAnswer(ensureSession()); render(); return { ok: true, likes: currentAnswerLikes(state.session) }; } },
    { name: 'next_answer', description: '同じ質問の次の回答者へ進む', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); advanceGuarded(nextAnswer); return { ok: true, cursor: state.session.cursor, answerIndex: state.session.answerIndex }; } },
    { name: 'pass_answer', description: '現在の回答者をパスする', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); advanceGuarded(passAnswer); return { ok: true, cursor: state.session.cursor, answerIndex: state.session.answerIndex }; } },
    { name: 'continue_round', description: '6枚区切りの続きを許可する', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); ensureSession(); if (!await canContinue(state.session)) throw new Error('続きを始められませんでした。'); state.session = continueRound(state.session); render(); return { ok: true, unlockedUntil: state.session.unlockedUntil }; } },
  ];
  tools.forEach(register);
}

render();
