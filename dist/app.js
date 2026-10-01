import { decks } from './data/decks.js';
import { canContinue } from './access-policy.js';
import { ROUND_SIZE, createSession, currentAnswerLikes, currentCard, currentParticipantIndex, currentSpeaker, isFinished, isRoundComplete, likeCurrentAnswer, nextAnswer, passAnswer, previousAnswer, remaining, revealCard, continueRound, normalizeParticipants, MAX_NAME_LENGTH, MAX_PARTICIPANTS } from './engine.js';

const root = document.querySelector('#app');
const state = { screen: 'participants', participants: ['', ''], session: null, error: '', busy: false, lastAdvanceAt: 0, focusAction: null, focusSelector: null, selectedDeckId: 'friends' };

function esc(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }

function render() {
  root.innerHTML = state.screen === 'participants' ? participantsView() : state.screen === 'decks' ? decksView() : playView();
  root.dataset.screen = state.screen;
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
  root.querySelectorAll('[data-adult]').forEach((input) => input.addEventListener('change', updateAdultButton));
  root.querySelectorAll('[data-deck-select]').forEach((input) => input.addEventListener('change', (event) => { state.selectedDeckId = event.target.value; state.focusSelector = `input[data-deck-select][value="${event.target.value}"]`; state.error = ''; render(); }));
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

function frame(content, eyebrow = 'となり') { return `<header class="topbar"><button class="brand" data-action="home" aria-label="最初に戻る"><span class="brand-mark">◌</span><span>${eyebrow}</span></button><span class="quiet">話したくない質問はパスしてOK</span></header><section class="content">${content}</section>`; }

function participantsView() {
  const atLimit = state.participants.length >= MAX_PARTICIPANTS;
  return frame(`<div class="intro"><p class="kicker">まずは、ここにいる人</p><h1 tabindex="-1" data-focus>となりで話す準備をしよう。</h1><p class="lead">同じ質問に、みんなで順番に答えます。</p></div><form class="panel form-panel" data-form="participants"><div class="section-label">参加者（2〜${MAX_PARTICIPANTS}人）</div><div class="participant-list">${state.participants.map((name, index) => `<label class="name-field"><span>${index + 1}人目</span><input name="participant" data-index="${index}" value="${esc(name)}" maxlength="${MAX_NAME_LENGTH}" placeholder="呼び名" autocomplete="off" enterkeyhint="${index === state.participants.length - 1 ? 'done' : 'next'}" /></label>`).join('')}</div><div class="inline-actions"><button type="button" class="text-button" data-action="add-person" ${atLimit ? 'disabled' : ''}>＋参加者を追加</button>${state.participants.length > 2 ? '<button type="button" class="text-button muted" data-action="remove-person">最後の人を削除</button>' : ''}<span class="limit-note">${atLimit ? '参加者は8人までです' : ''}</span></div><p class="form-error" role="alert">${esc(state.error)}</p><button type="submit" class="primary-button">テーマを選ぶ</button></form>`);
}

function decksView() {
  const selected = decks.find((deck) => deck.id === state.selectedDeckId) ?? decks.find((deck) => !deck.adultOnly) ?? decks[0];
  return frame(`<div class="intro compact"><p class="kicker">次に、話すテーマ</p><h1 tabindex="-1" data-focus>どんな話をめくる？</h1><p class="lead">最初は6枚。みんなの番が終わると、次のカードへ進みます。</p></div><div class="deck-list" role="radiogroup" aria-label="質問テーマ">${decks.map((deck) => `<label class="deck-option ${deck.id === selected.id ? 'is-selected' : ''}"><input type="radio" name="deck" value="${esc(deck.id)}" data-deck-select ${deck.id === selected.id ? 'checked' : ''} /><span class="deck-option-copy"><strong>${esc(deck.title)}</strong><small>${esc(deck.subtitle)}</small></span><span class="deck-count">40枚</span></label>`).join('')}</div><div class="selected-deck-detail"><strong>${esc(selected.title)}</strong><span>${esc(selected.description)}</span></div>${selected.adultOnly ? `<label class="consent selected-consent"><input type="checkbox" data-adult="${esc(selected.id)}" /> <span>参加者全員が18歳以上で、性的な話題に同意しています</span></label><p class="consent-hint">全員の確認にチェックを入れると始められます。</p>` : ''}<p class="form-error" role="alert">${esc(state.error)}</p><button class="primary-button deck-start selected-start" data-action="choose-deck" data-deck="${esc(selected.id)}" ${selected.adultOnly ? 'disabled' : ''}>このテーマで始める</button><button class="back-link" data-action="home">参加者を変更する</button>`);
}

function participantChips(session) { return session.participants.map((name, index) => `<span class="participant-chip ${index === currentParticipantIndex(session) ? 'is-current' : ''}">${esc(name)}</span>`).join(''); }

function playView() {
  const session = state.session;
  if (isFinished(session)) return finishView();
  if (isRoundComplete(session) && !session.revealed) return roundView();
  if (!session.revealed) return backView(session);
  const card = currentCard(session);
  const currentIndex = currentParticipantIndex(session);
  const progress = Math.round((session.cursor / session.questions.length) * 100);
  return frame(`<div class="play-head"><div><p class="kicker">${esc(decks.find((deck) => deck.id === session.deckId)?.title ?? '会話カード')}</p><p class="progress-copy">${session.cursor + 1} / ${session.questions.length}枚目<span> · 今回 ${session.cursor % ROUND_SIZE + 1} / ${Math.min(ROUND_SIZE, remaining(session) + session.cursor % ROUND_SIZE)}枚</span></p></div><button class="quiet-button" data-action="decks">テーマを変える</button></div><div class="participant-strip" aria-label="参加者">${participantChips(session)}</div><div class="progress"><span style="width:${progress}%"></span></div><article class="question-card active-card" aria-live="polite"><div class="card-eyebrow"><strong>${esc(currentSpeaker(session))}の番</strong><span> · 回答順 ${session.answerIndex + 1} / ${session.participants.length}</span></div><p>${esc(card.text)}</p><div class="card-note">質問カード · みんなで答えよう</div></article><div class="answer-actions" role="group" aria-label="回答操作"><button class="secondary-button" data-action="previous-answer" ${session.answerIndex === 0 || state.busy ? 'disabled' : ''}>前の人へ</button><button class="like-button" data-action="like" ${state.busy ? 'disabled' : ''}>♡ ${esc(currentSpeaker(session))}の回答にいいね！ <strong>${currentAnswerLikes(session)}</strong></button><button class="primary-button" data-action="next-answer" ${state.busy ? 'disabled' : ''}>${session.answerIndex === session.participants.length - 1 ? '次のカードへ' : '次の人へ'}</button><button class="pass-button" data-action="pass" ${state.busy ? 'disabled' : ''}>パスする</button></div>`);
}

function backView(session) { return frame(`<div class="card-back" data-action="reveal" role="button" tabindex="0" aria-label="カードをめくる"><span class="round-badge">${session.cursor + 1} / 40</span><div class="back-symbol">◌</div><h1 tabindex="-1" data-focus>タップしてめくる</h1><p>みんなで同じ質問に答えよう。</p></div>`); }

function roundView() { const session = state.session; return frame(`<div class="round-break"><span class="round-badge">${session.cursor} / 40</span><p class="kicker">ひと区切り</p><h1 tabindex="-1" data-focus>${session.cursor === 40 ? 'すべてめくりました。' : '6枚めくりました。'}</h1><p class="lead">${session.cursor === 40 ? 'このテーマのカードを全部めくりました。' : `まだ${remaining(session)}枚あります。続きを遊ぶか、今日はここまでにできます。`}</p><p class="form-error" role="alert">${esc(state.error)}</p><div class="break-actions">${session.cursor < 40 ? `<button class="primary-button" data-action="continue" ${state.busy ? 'disabled' : ''}>${state.busy ? '確認中…' : '続きを遊ぶ'}</button>` : ''}<button class="secondary-button" data-action="finish">今日はここまで</button></div><button class="back-link" data-action="decks">テーマを選び直す</button></div>`); }
function finishView() { return roundView(); }

function submitParticipants() { try { state.participants = normalizeParticipants(state.participants); state.screen = 'decks'; state.error = ''; render(); } catch (error) { state.error = error.message; const invalidIndex = state.participants.findIndex((name) => typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME_LENGTH); state.focusSelector = `input[data-index="${Math.max(0, invalidIndex)}"]`; render(); } }
function updateAdultButton() { const button = root.querySelector('.selected-start'); const selected = decks.find((deck) => deck.id === state.selectedDeckId); if (button && selected?.adultOnly) button.disabled = !root.querySelector(`[data-adult="${selected.id}"]`)?.checked || state.busy; }
function ensureSession() { if (!state.session) throw new Error('セッションが始まっていません'); return state.session; }
function advanceGuarded(action) { ensureSession(); const now = Date.now(); if (now - state.lastAdvanceAt < 300) return false; state.lastAdvanceAt = now; state.busy = true; render(); state.session = action(state.session); state.busy = false; render(); return true; }

async function handleAction(event) {
  if (state.busy && event.currentTarget.dataset.action !== 'continue') return;
  const action = event.currentTarget.dataset.action;
  state.focusAction = action;
  if (action === 'reveal') { state.session = revealCard(ensureSession()); render(); return; }
  if (action === 'home') { state.screen = 'participants'; state.session = null; state.error = ''; render(); return; }
  if (action === 'add-person') { if (state.participants.length < MAX_PARTICIPANTS) { state.participants.push(''); state.focusSelector = `input[data-index="${state.participants.length - 1}"]`; } render(); return; }
  if (action === 'remove-person') { if (state.participants.length > 2) { state.participants.pop(); state.focusSelector = `input[data-index="${state.participants.length - 1}"]`; } render(); return; }
  if (action === 'decks') { state.screen = 'decks'; state.error = ''; state.busy = false; render(); return; }
  if (action === 'choose-deck') { const deck = decks.find((item) => item.id === event.currentTarget.dataset.deck); const adultConfirmed = root.querySelector(`[data-adult="${deck.id}"]`)?.checked ?? false; try { state.session = createSession({ participants: state.participants, deck, adultConfirmed }); state.screen = 'play'; state.error = ''; render(); } catch (error) { state.error = error.message; render(); } return; }
  if (action === 'like') { state.session = likeCurrentAnswer(ensureSession()); render(); return; }
  if (action === 'next-answer') { try { advanceGuarded(nextAnswer); } catch (error) { state.error = error.message; render(); } return; }
  if (action === 'previous-answer') { state.session = previousAnswer(ensureSession()); render(); return; }
  if (action === 'pass') { try { advanceGuarded(passAnswer); } catch (error) { state.error = error.message; render(); } return; }
  if (action === 'continue') { state.busy = true; state.error = ''; render(); try { ensureSession(); if (await canContinue(state.session)) state.session = continueRound(state.session); else state.error = '続きを始められませんでした。'; } catch (error) { state.error = error.message || '続きを始められませんでした。'; } finally { state.busy = false; render(); } return; }
  if (action === 'finish') { state.screen = 'decks'; state.session = null; state.error = ''; render(); }
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
    { name: 'read_state', description: '現在の画面とカード進行を読む', inputSchema: empty, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); const session = state.session; return { screen: state.screen, participants: state.participants, cursor: session?.cursor ?? 0, unlockedUntil: session?.unlockedUntil ?? 0, revealed: session?.revealed ?? false, currentSpeaker: session?.revealed ? currentSpeaker(session) : null, answerIndex: session?.answerIndex ?? 0, likes: session?.likes ?? {} }; } },
    { name: 'start_session', description: '参加者とデッキを検証してカード裏から開始する', inputSchema: { type: 'object', additionalProperties: false, properties: { participants: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string' } }, deckId: { type: 'string' }, adultConfirmed: { type: 'boolean' } }, required: ['participants', 'deckId'] }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (payload, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); const deck = decks.find((item) => item.id === payload?.deckId); const next = createSession({ participants: payload?.participants, deck, adultConfirmed: payload?.adultConfirmed === true }); state.participants = next.participants; state.session = next; state.screen = 'play'; state.error = ''; render(); return { ok: true }; } },
    { name: 'reveal_card', description: '現在のカードをめくる', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); state.session = revealCard(ensureSession()); render(); return { ok: true, revealed: true }; } },
    { name: 'like_current_answer', description: '現在の回答者にいいねする', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); state.session = likeCurrentAnswer(ensureSession()); render(); return { ok: true, likes: currentAnswerLikes(state.session) }; } },
    { name: 'next_answer', description: '同じ質問の次の回答者へ進む', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); advanceGuarded(nextAnswer); return { ok: true, cursor: state.session.cursor, answerIndex: state.session.answerIndex }; } },
    { name: 'pass_answer', description: '現在の回答者をパスする', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); advanceGuarded(passAnswer); return { ok: true, cursor: state.session.cursor, answerIndex: state.session.answerIndex }; } },
    { name: 'continue_round', description: '6枚区切りの続きを許可する', inputSchema: empty, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async (_input, { signal } = {}) => { if (signal?.aborted) throw new Error('中止されました'); ensureSession(); if (!await canContinue(state.session)) throw new Error('続きを始められませんでした。'); state.session = continueRound(state.session); render(); return { ok: true, unlockedUntil: state.session.unlockedUntil }; } },
  ];
  tools.forEach(register);
}

render();
