import { accountApi, discoverAccountConfig } from './account.js';
import { toDataURL } from './vendor/qr.js';
import { decks } from './data/decks.js';
import { cardDesignForSession } from './card-design.js';

const app = document.querySelector('#group-room-app');
const query = new URLSearchParams(location.search);
const createDeck = query.get('create');
const createSet = query.get('set');
const includeR18 = query.get('includeR18') === '1';
const setAdult = query.get('setAdult') === '1';
const plannedParam = Number(query.get('planned'));
const plannedParticipantCount = Number.isInteger(plannedParam) && plannedParam >= 2 && plannedParam <= 8 ? plannedParam : null;
// R18 is decided from the URL flags, from the chosen deck itself, and (below) from a server 403.
const deckAdult = Boolean(createDeck && decks.find((deck) => deck.id === createDeck)?.adultOnly === true);
let r18Room = includeR18 || setAdult || deckAdult;
const roomId = query.get('room');
const invite = query.get('invite');
const hostNameDefault = query.get('hostName') || '';
const memberKey = (id) => `mingle.group.member:${id || 'pending'}`;
const joinKey = (id) => `mingle.group.join:${id || 'pending'}`;
function newSecret() { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
let displayR18 = false;
const state = { roomId, invite, memberToken: roomId ? localStorage.getItem(memberKey(roomId)) || '' : '', data: null, preview: null, error: '', host: Boolean(createDeck || createSet || query.get('host') === '1'), busy: false, adultConfirmed: false, participantsAdultAttested: false, loggedIn: false, ageConfirmedAt: null, hostName: hostNameDefault, joinName: '', lastRevision: -1, terminal: false, pollDelay: 1000, requestEpoch: 0, authUserId: null, authSubscription: null };
function setDisplayR18(value) { const qualified = state.adultConfirmed || state.data?.member?.adultConfirmed === true || state.data?.member?.adult_confirmed === true; displayR18 = value === true && qualified; render(); }
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
function shell(content) { app.innerHTML = `<div class="group-brand"><img src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards"><a class="group-back" href="/">トップへ戻る</a></div>${content}`; }
function errorView() { return state.error ? `<p class="group-error" role="alert">${esc(state.error)}</p>` : ''; }
function deckTitle(room) { return room?.adultOnly && !displayR18 ? 'R18を含むテーマ' : (room?.deckName || (room?.adultOnly ? 'R18を含むテーマ' : '')); }
function groupErrorMessage(e, fallback) {
  const code = String(e?.message || '');
  if (code === 'AGE_CONFIRMATION_REQUIRED') return 'R18は、アカウント設定で18歳以上の確認をすると利用できます。';
  if (code === 'ADULT_ATTESTATION_REQUIRED') return '参加者全員が18歳以上であることの確認が必要です。';
  if (code === 'PARTICIPANT_AGE_REQUIRED') return '18歳以上であることの確認が必要です。';
  if (code === 'FEATURE_UNAVAILABLE') return '現在利用できません。';
  return fallback;
}
function createForm() {
  if (r18Room && !state.ageConfirmedAt && !state.attestationRequired) { shell(`<section class="group-card"><h1>みんなのスマホで遊ぶ</h1><p class="group-error" role="alert">R18のルームは、ログインして18歳以上の確認をしたアカウントで作成できます。</p>${state.loggedIn ? '<p class="group-muted">トップのアカウント設定で、18歳以上の確認をしてください。</p>' : ''}<a class="secondary-button" href="/">${state.loggedIn ? 'トップのアカウント設定へ' : 'トップでログインする'}</a></section>`); return; }
  shell(`<section class="group-card"><h1>みんなのスマホで遊ぶ</h1><p class="group-muted">代表者が進行し、参加者は登録なしで参加できます。</p><form class="group-form" data-create><label>代表者の呼び名<input name="hostName" required maxlength="40" value="${esc(state.hostName)}" autocomplete="nickname"></label>${r18Room ? `<label class="group-consent"><input type="checkbox" name="participantsAdultAttested" required ${state.participantsAdultAttested ? 'checked' : ''}> <span><strong>参加者全員が18歳以上であることを確認しました</strong><small>幹事として、参加者全員が18歳以上であることを確認する責任を負います。参加者にも、それぞれの端末で18歳以上であることを確認してもらいます。</small></span></label><label class="group-consent"><input type="checkbox" name="adultConfirmed" required ${state.adultConfirmed ? 'checked' : ''}> <span>この場のR18の話題に同意します</span></label><label class="group-consent"><input type="checkbox" name="displayR18" ${displayR18 ? 'checked' : ''}> <span>R18を表示する</span></label>` : ''}<button class="primary-button" type="submit" ${state.busy?'disabled':''}>ルームを作る</button></form>${errorView()}</section>`);
}
function joinForm() {
  if (!state.preview) {
    shell(`<section class="group-card"><h1>ルームに参加できません</h1>${errorView()}<button class="secondary-button" type="button" data-retry-preview>もう一度確認する</button></section>`);
    return;
  }
  const adult = state.preview.room?.adultOnly;
  shell(`<section class="group-card"><h1>ルームに参加</h1><p class="group-status">${esc(adult && !displayR18 ? 'R18を含むテーマ' : deckTitle(state.preview.room))}・${state.preview.room?.total || ''}枚</p>${adult ? '<p class="group-muted">このルームにはR18の質問が含まれます。幹事が、参加者全員が18歳以上であることを確認して作成しました。</p>' : ''}<form class="group-form" data-join><label>参加者の呼び名<input name="name" required maxlength="40" value="${esc(state.joinName)}" autocomplete="nickname"></label>${adult ? '<label class="group-consent"><input type="checkbox" name="ageConfirmed" required> <span>私は18歳以上です</span></label><label class="group-consent"><input type="checkbox" name="adultConfirmed" required> <span>R18の話題に同意します</span></label><label class="group-consent"><input type="checkbox" name="displayR18" ' + (displayR18 ? 'checked' : '') + '> <span>R18を表示する</span></label>' : ''}<button class="primary-button" type="submit" ${state.busy?'disabled':''}>参加する</button></form><p class="group-muted">開始後は新しい参加者を追加できません。</p>${errorView()}</section>`);
}
function roomIcon(name) {
  const paths={stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',skip:'<path d="m5 5 7 7-7 7Z"/><path d="M19 5v14"/>'};
  return `<svg class="action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.stop}</svg>`;
}
function renderPlayView(room, member, card, host) {
  const speaker = room.members?.[room.speakerIndex];
  const speakerName = speaker?.name || room.speakerName || '';
  const ownTurn = Boolean(member?.id && speaker?.id === member.id);
  const loading = Boolean(room.revealed && !card);
  const revealed = Boolean(room.revealed && card);
  const art = cardDesignForSession({ mode: 'group', deckId: room.deckId, design: room.design, sharedGuest: true });
  const artStyle = `--card-art-front:url('${art.front}');--card-art-back:url('${art.back}');--card-art-accent:${art.accent}`;
  const cardLabel = loading ? 'カードを読み込んでいます…' : (revealed ? esc(card.text) : (host ? 'タップしてめくる' : '代表者がカードをめくるまでお待ちください'));
  const cardClass = `shared-question-card ${revealed ? 'is-revealed' : 'is-face-down'}${loading ? ' is-loading' : ''}`;
  const primary = loading ? '読み込み中…' : (revealed ? '次の人' : 'めくる');
  const primaryAction = revealed ? 'next' : 'reveal';
  const hostControls = host ? `<button class="room-finish-button" type="button" data-action="finish" aria-label="終了" title="終了" ${state.busy ? 'disabled' : ''}>${roomIcon('stop')}</button><button class="primary-button room-primary" type="button" data-action="${loading ? '' : primaryAction}" ${state.busy || loading ? 'disabled' : ''}>${primary}</button><button class="pass-button room-pass" type="button" aria-label="パス" title="パス" data-action="pass" ${state.busy || loading || !revealed ? 'disabled' : ''}>${roomIcon('skip')}</button>` : '<p class="group-wait">代表者の操作を待っています。</p>';
  const speakerMarkup = speakerName ? `<div class="shared-speaker"><span class="shared-speaker-avatar" aria-hidden="true">${esc(Array.from(speakerName)[0] || '')}</span><strong>${esc(speakerName)}の番</strong>${ownTurn ? '<span class="play-turn">あなたの番</span>' : ''}<span class="shared-participants">${esc(room.members?.filter((m) => m.id !== speaker?.id).map((m) => m.name).join('・'))}</span></div>` : `<div class="shared-speaker"><span class="group-wait">参加者を読み込んでいます…</span></div>`;
  return `<div class="shared-play-shell is-group room-play-shell" data-revealed="${revealed ? 'true' : 'false'}" style="${artStyle}">
    <div class="shared-play-head"><div><p class="play-deck">${esc(deckTitle(room))}</p><p class="progress-copy">${room.cursor + 1} / ${room.total}</p></div></div>
    <div class="round-progress shared-round-progress" aria-label="今回の進み具合"><i style="width:${Math.round(((room.cursor + 1) / Math.max(room.total, 1)) * 100)}%"></i></div>
    <article class="${cardClass}" ${host && !revealed && !loading ? 'data-action="reveal" tabindex="0" role="button" aria-label="カードをめくる"' : ''} aria-live="polite"><span class="shared-art-rail" aria-hidden="true"></span><span class="shared-card-copy">${cardLabel}</span><span class="shared-card-motif" aria-hidden="true">♡</span><span class="shared-bubbles" aria-hidden="true"><i></i><i></i></span></article>
    ${speakerMarkup}<div class="shared-actions room-actions">${hostControls}</div><p class="shared-pass-hint">話したくない質問はパスしてOK</p>
  </div>`;
}
function render() {
  if (state.host && !state.roomId && !state.data) { createForm(); return; }
  if (state.roomId && !state.memberToken && !state.host && (!state.data || !state.data.member)) { joinForm(); return; }
  if (!state.data) { shell(`<section class="group-card"><h1>${state.terminal ? 'ルームを表示できません' : 'ルームを読み込んでいます…'}</h1>${errorView()}</section>`); return; }
  const { room, member, card } = state.data;
  const host = state.data.host === true;
  let body;
  if (room.status === 'lobby') {
    const people = (room.members || []).map((m) => `<li>${esc(m.name)}${m.role === 'host' ? '（代表者）' : ''}</li>`).join('');
    const participation = plannedParticipantCount ? `参加状況：${room.memberCount} / ${plannedParticipantCount}人` : `参加済み：${room.memberCount}人`;
    body = `<p class="group-status">${esc(deckTitle(room))}・${room.total}枚</p><p>${participation}</p><ul class="group-members">${people || `<li>${esc(member?.name || '代表者')}</li>`}</ul>${host ? `<button class="primary-button" data-action="start" ${state.busy || room.memberCount < 2 ? 'disabled' : ''}>開始する</button><button class="secondary-button" data-action="finish">終了</button>` : '<p class="group-wait">代表者が開始するまでお待ちください。</p>'}`;
  } else if (room.status === 'ended') body = '<p class="group-status">このルームは終了しました。</p>';
  else if (room.status === 'break') body = `<p class="group-status">${room.cursor}枚終了</p><p>ここでひと休みできます。</p>${host ? '<button class="primary-button" data-action="continue">続ける</button><button class="secondary-button" data-action="finish">終了</button>' : '<p class="group-wait">代表者が続行するまでお待ちください。</p>'}`;
  else { body = renderPlayView(room, member, card, host); }
  if (room.adultOnly) body = displayR18 ? `${body}<label class="group-consent"><input type="checkbox" data-display-r18 checked> <span>R18を表示する</span></label>` : `<p class="group-muted">R18を表示するまで、テーマ名と質問を非表示にしています。</p><label class="group-consent"><input type="checkbox" data-display-r18> <span>R18を表示する</span></label>`;
  shell(`<section class="group-card"><h1>${esc(deckTitle(room))}</h1>${body}${errorView()}${host && room.status === 'lobby' ? '<div class="group-qr"><img data-qr alt="参加用QRコード"><button type="button" class="secondary-button" data-copy>参加URLをコピー</button><small>QRまたはリンクから参加してください</small></div>' : ''}</section>`);
  if (host && room.status === 'lobby') {
    const planned = plannedParticipantCount ? `&planned=${plannedParticipantCount}` : '';
    const url = `${location.origin}/group-room.html?room=${encodeURIComponent(room.id)}&invite=${encodeURIComponent(state.invite)}${planned}`;
    const qr = app.querySelector('[data-qr]');
    if (qr) toDataURL(url, { margin: 4, width: 180 }).then((value) => { if (qr.isConnected) qr.src = value; }).catch(() => {});
    app.querySelector('[data-copy]')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); state.error = '参加URLをコピーしました。'; render(); } catch { state.error = 'コピーできませんでした。'; render(); } });
  }
}
async function loadPreview() { try { state.preview = await accountApi.previewGroupRoom(state.roomId, state.invite); state.error = ''; render(); } catch (e) { state.preview = null; state.error = e.status === 410 ? 'このルームの有効期限が切れています。' : 'この参加URLは無効です。'; render(); } }
async function load() {
  const epoch = state.requestEpoch;
  try {
    const result = await accountApi.groupState(state.roomId, state.host ? '' : state.memberToken);
    if (epoch !== state.requestEpoch) return;
    if (result.room.revision < state.lastRevision) return;
    const sameRevision = result.room.revision === state.lastRevision && Boolean(state.data);
    const hadError = Boolean(state.error);
    state.error = '';
    state.terminal = result.room.status === 'ended';
    state.pollDelay = 1000;
    if (sameRevision) { if (hadError) render(); return; }
    state.lastRevision = result.room.revision;
    state.data = result; state.adultConfirmed = state.adultConfirmed || result.member?.adultConfirmed === true || result.member?.adult_confirmed === true;
    render();
  } catch (e) {
    if (epoch !== state.requestEpoch) return;
    state.error = e.status === 410 ? 'このルームの有効期限が切れました。' : e.status === 401 || e.status === 403 || e.status === 404 ? 'このルームには参加できません。' : '通信できません。';
    if ([401,403,404,410].includes(e.status)) { state.terminal = true; state.data = null; }
    else state.pollDelay = Math.min(15000, state.pollDelay * 2);
    render();
  }
}
async function create(form) { if (state.busy) return; const data = new FormData(form); state.busy = true; state.hostName = String(data.get('hostName') || '').trim(); state.adultConfirmed = data.get('adultConfirmed') === 'on'; state.participantsAdultAttested = data.get('participantsAdultAttested') === 'on'; setDisplayR18(data.get('displayR18') === 'on'); const epoch = state.requestEpoch; render(); try { const result = await accountApi.createGroupRoom(createDeck, state.hostName, createSet, includeR18, state.adultConfirmed, state.participantsAdultAttested); if (epoch !== state.requestEpoch) return; state.data = result; state.adultConfirmed = state.adultConfirmed || result.member?.adultConfirmed === true || result.member?.adult_confirmed === true; state.roomId = state.data.room.id; state.invite = state.data.inviteToken; state.memberToken = state.data.memberToken; const planned = plannedParticipantCount ? `&planned=${plannedParticipantCount}` : ''; history.replaceState({}, '', `/group-room.html?room=${encodeURIComponent(state.roomId)}&invite=${encodeURIComponent(state.invite)}&host=1${planned}`); state.data.host = true; state.error = ''; } catch (e) { if (epoch === state.requestEpoch && ['ADULT_ATTESTATION_REQUIRED', 'ADULT_CONSENT_REQUIRED'].includes(e?.message)) { r18Room = true; state.attestationRequired = true; } else if (epoch === state.requestEpoch && e?.message === 'AGE_CONFIRMATION_REQUIRED') { r18Room = true; state.ageConfirmedAt = null; state.attestationRequired = false; } if (epoch === state.requestEpoch) state.error = groupErrorMessage(e, e.status === 403 ? 'R18の同意を確認してください。' : 'ルームを作成できませんでした。'); } finally { state.busy = false; render(); schedulePoll(); } }
async function join(form) { if (state.busy) return; const data = new FormData(form); state.joinName = String(data.get('name') || ''); state.adultConfirmed = data.get('adultConfirmed') === 'on'; setDisplayR18(data.get('displayR18') === 'on'); const memberSecret = localStorage.getItem(joinKey(state.roomId)) || newSecret(); localStorage.setItem(joinKey(state.roomId), memberSecret); state.busy = true; const epoch = state.requestEpoch; try { const result = await accountApi.joinGroupRoom(state.roomId, state.invite, data.get('name'), data.get('adultConfirmed') === 'on', memberSecret, data.get('ageConfirmed') === 'on'); if (epoch !== state.requestEpoch) return; state.memberToken = result.memberToken; localStorage.setItem(memberKey(state.roomId), state.memberToken); state.data = result; state.adultConfirmed = state.adultConfirmed || result.member?.adultConfirmed === true || result.member?.adult_confirmed === true; state.host = false; state.lastRevision = result.room.revision; state.error = ''; } catch (e) { if (epoch === state.requestEpoch) state.error = groupErrorMessage(e, e.status === 403 ? 'R18の同意が必要です。' : '参加できませんでした。'); } finally { state.busy = false; render(); schedulePoll(); } }
async function act(action) { if (state.busy || !state.data?.host) return; if (action === 'finish' && !confirm('このルームを終了しますか？')) return; state.busy = true; state.requestEpoch += 1; const epoch = state.requestEpoch; render(); try { const result = await accountApi.groupAction(state.roomId, '', action, state.data.room.revision); if (epoch !== state.requestEpoch) return; state.data = result; state.data.host = true; state.lastRevision = state.data.room.revision; state.error = ''; state.terminal = state.data.room.status === 'ended'; } catch (e) { if (epoch !== state.requestEpoch) return; if (e.status === 409) { state.requestEpoch += 1; await load(); } else state.error = '操作を反映できませんでした。'; } finally { state.busy = false; render(); schedulePoll(); } }
app.addEventListener('change', (e) => { if (e.target.matches('[data-display-r18]')) setDisplayR18(e.target.checked); });
app.addEventListener('submit', (e) => { if (e.target.matches('[data-create]')) { e.preventDefault(); create(e.target); } if (e.target.matches('[data-join]')) { e.preventDefault(); join(e.target); } });
app.addEventListener('click', (e) => { if (e.target.closest('[data-retry-preview]')) { state.error = ''; loadPreview(); return; } const action = e.target.closest('[data-action]')?.dataset.action; if (action) act(action); });
app.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.shared-question-card[data-action="reveal"]')) { e.preventDefault(); act('reveal'); } });
await discoverAccountConfig();
try {
  const subscriptionResult = accountApi.onAuthStateChange?.((event, session) => {
    const nextId = session?.user?.id || null;
    if (state.authUserId && nextId !== state.authUserId) {
      state.requestEpoch += 1; state.data = null; state.preview = null; state.memberToken = ''; state.terminal = true; state.error = 'アカウントが切り替わったため、ルームを閉じました。'; render();
    }
    if (event === 'SIGNED_OUT') { state.requestEpoch += 1; state.data = null; state.memberToken = ''; state.terminal = true; state.error = 'サインアウトしました。'; render(); }
    state.authUserId = nextId;
  });
  state.authSubscription = subscriptionResult?.data?.subscription || subscriptionResult?.subscription || null;
} catch {}
if (state.host && !state.roomId) { try { const me = await accountApi.me(); state.hostName = me.user?.displayName || state.hostName; state.loggedIn = Boolean(me.user); state.ageConfirmedAt = typeof me.account?.adultConfirmedAt === 'string' && me.account.adultConfirmedAt ? me.account.adultConfirmedAt : null; } catch {} render(); }
else if (state.roomId && state.memberToken) await load();
else if (state.roomId && !state.host) await loadPreview();
else render();
let pollTimer = 0;
function schedulePoll() { clearTimeout(pollTimer); if (state.terminal || document.hidden || !navigator.onLine || state.busy || (!state.host && !state.memberToken) || !state.roomId) return; pollTimer = setTimeout(async () => { await load(); schedulePoll(); }, state.pollDelay); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (state.host || state.memberToken) load(); schedulePoll(); } else clearTimeout(pollTimer); });
window.addEventListener('online', () => { if (state.host || state.memberToken) load(); schedulePoll(); });
schedulePoll();
