import { accountApi, discoverAccountConfig } from './account.js';
import { decks } from './data/decks.js';
import { playableSavedSets } from './my-set.js';
import { toDataURL } from './vendor/qr.js';

const root = document.querySelector('#venue-app');
const token = new URLSearchParams(location.search).get('token');
const state = { data: null, venue: null, mySets: [], rawMySets: [], customCards: [], tab: 'home', error: '', notice: '', qr: null, stats: null, pending: '', epoch: 0, ownerId: '', ownerAgeConfirmed: false, authUserId: '', formDraft: null };
let unsubscribe = null;
let actionInFlight = false;
const fmtDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const btn = (label, action, primary = false, attrs = '') => `<button type="button" class="venue-button${primary ? ' primary' : ''}" data-action="${esc(action)}" ${attrs} ${state.pending ? 'disabled' : ''}>${esc(label)}</button>`;
const message = (error) => { const code = String(error?.code || error?.message || error || ''); return ({ UNAUTHENTICATED:'ログインが必要です。', NOT_FOUND:'対象が見つかりません。', ADULT_VENUE_REQUIRED:'R18テーマを許可してから追加または再公開してください。', AGE_CONFIRMATION_REQUIRED:'R18は、アカウント設定で18歳以上の確認をすると利用できます。', ADULT_ATTESTATION_REQUIRED:'参加者全員が18歳以上であることの確認が必要です。', SET_NOT_PLAYABLE:'6〜40枚の有効なテーマを選んでください。', VENUE_UNAVAILABLE:'店舗管理を読み込めませんでした。' }[code] || (code.includes('venue_unavailable') ? '店舗管理を読み込めませんでした。' : code.includes('not_found') ? '対象が見つかりません。' : '処理に失敗しました。')); };
function shell(content, title = 'Mingle.Cards 店舗') { root.innerHTML = `<div class="venue-brand"><img src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards"><span>${esc(title)}</span><a class="venue-service-link" href="/">サービスへ戻る</a></div>${content}`; }
function currentSets() { return (state.data?.sets || []).filter((set) => set.venueId === state.venue?.id); }
function currentTables() { return (state.data?.tables || []).filter((table) => table.venueId === state.venue?.id); }
function nav() { return `<nav class="venue-tabs" role="tablist" aria-label="店舗管理"><button type="button" role="tab" id="venue-tab-home" data-action="tab" data-tab="home" aria-controls="venue-panel" aria-selected="${state.tab === 'home'}">ホーム</button><button type="button" role="tab" id="venue-tab-themes" data-action="tab" data-tab="themes" aria-controls="venue-panel" aria-selected="${state.tab === 'themes'}">提供テーマ</button><button type="button" role="tab" id="venue-tab-qr" data-action="tab" data-tab="qr" aria-controls="venue-panel" aria-selected="${state.tab === 'qr'}">QR・印刷</button><button type="button" role="tab" id="venue-tab-usage" data-action="tab" data-tab="usage" aria-controls="venue-panel" aria-selected="${state.tab === 'usage'}">利用状況</button><button type="button" role="tab" id="venue-tab-settings" data-action="tab" data-tab="settings" aria-controls="venue-panel" aria-selected="${state.tab === 'settings'}">設定</button></nav>`; }
function settingsForm() { const v = state.venue; const d = state.formDraft?.type === 'venue' ? state.formDraft.values : {}; const value = (key, fallback = '') => esc(d[key] ?? fallback); const adult = d.adultEnabled !== undefined ? d.adultEnabled === 'on' : Boolean(v?.adultEnabled); const adultSection = !state.ownerAgeConfirmed ? `<p class="venue-muted">R18テーマを提供するには、アカウント設定で18歳以上の確認が必要です。</p>${v?.adultEnabled ? `<p class="venue-muted">年齢の確認がないため、R18テーマの許可はオフにすることだけができます。</p><label class="venue-check"><input type="checkbox" name="adultEnabled" ${adult ? 'checked' : ''}><span>R18テーマを許可する（外すとオフになります）</span></label>` : ''}` : `${v?.adultEnabled ? `<p class="venue-muted">R18テーマを提供中${v.adultAttestedAt && fmtDate(v.adultAttestedAt) ? `（${esc(fmtDate(v.adultAttestedAt))}に確認）` : ''}</p>` : ''}<label class="venue-check"><input type="checkbox" name="adultEnabled" data-adult-toggle ${adult ? 'checked' : ''}><span>R18テーマを許可する（初期オフ）</span></label>${v?.adultEnabled ? '' : `<div class="venue-attest" data-attest ${adult ? '' : 'hidden'}><label class="venue-check"><input type="checkbox" name="participantsAdultAttested" ${d.participantsAdultAttested === 'on' ? 'checked' : ''} ${adult ? 'required' : ''}><span><strong>来店する参加者全員が18歳以上であることを確認しました</strong><br><small>店舗として、R18テーマを遊ぶ参加者全員が18歳以上であることを確認する責任を負います。</small></span></label></div>`}`; return `<section class="venue-card"><h2>店舗設定</h2><form class="venue-form" data-form="venue"><label>店舗名<input name="name" required maxlength="80" value="${value('name', v?.name || '')}"></label><label>ロゴURL（任意・HTTPS）<input name="logoUrl" inputmode="url" maxlength="240" value="${value('logoUrl', v?.logoUrl || '')}"></label>${v?.logoUrl ? `<img class="venue-logo-preview" src="${esc(v.logoUrl)}" alt="${esc(v.name)}のロゴ" loading="lazy">` : ''}<label>ウェルカムメッセージ<textarea name="welcomeText" maxlength="240">${value('welcomeText', v?.welcomeText || '')}</textarea></label><label>公式サイトURL（任意・HTTPS）<input name="storeUrl" inputmode="url" maxlength="240" value="${value('storeUrl', v?.storeUrl || '')}"></label><label>終了時に案内する公式SNS/サイトURL（任意・HTTPS）<input name="endingUrl" inputmode="url" maxlength="240" value="${value('endingUrl', v?.endingUrl || '')}"></label>${adultSection}<div class="venue-actions">${btn(v ? '設定を保存' : '店舗を登録', 'save-venue', true)}</div></form></section>`; }
function themesView() { const playable = normalizeMySets(state.rawMySets, state.customCards); const draft = state.formDraft?.type === 'set' ? state.formDraft.values : {}; const standard = decks.filter((d) => (d.questions || []).length >= 6 && ((state.venue?.adultEnabled && state.ownerAgeConfirmed) || !d.adultOnly)).map((d) => `<option value="standard:${esc(d.id)}">${esc(d.title || d.name || d.id)}${d.adultOnly ? '（R18）' : ''}</option>`).join(''); const mine = playable.filter((s) => (state.venue?.adultEnabled && state.ownerAgeConfirmed) || !s.hasR18).map((s) => `<option value="my_set:${esc(s.id)}">${esc(s.name)}（${s.cardIds.length}枚）</option>`).join(''); const sets = currentSets(); return `<section class="venue-card"><h2>提供テーマを追加</h2><p class="venue-muted">標準テーマ、または完成済みのマイセットを店舗で遊べるコピーとして追加します。</p><form class="venue-form" data-form="set"><label>表示名<input name="name" required maxlength="80" placeholder="例：カウンターで乾杯" value="${esc(draft.name || '')}"></label><label>テーマ<select name="source" required>${standard}${mine}</select></label><div class="venue-actions">${btn('提供テーマに追加', 'add-set', true)}</div></form></section><section class="venue-card"><h2>現在の提供テーマ</h2><div class="venue-list">${sets.map((s) => `<div class="venue-row"><div class="venue-row-head"><strong>${esc(s.name)}</strong><small>${s.cardCount}枚${s.adultOnly ? '・R18' : ''} / ${s.active ? '公開中' : '停止中'}</small></div><div class="venue-actions">${btn(s.active ? '停止' : '再公開', s.active ? 'deactivate-set' : 'activate-set', false, `data-set-id="${esc(s.id)}"`)}</div></div>`).join('') || '<p class="venue-muted">提供テーマを追加してください。</p>'}</div></section>`; }
function qrView() { const tables = currentTables(); const draft = state.formDraft?.type === 'table' ? state.formDraft.values : {}; return `<section class="venue-card"><h2>卓上QRを発行</h2><form class="venue-form" data-form="table"><label>テーブル/エリア名<input name="label" required maxlength="60" placeholder="例：テーブルA" value="${esc(draft.label || '')}"></label><div class="venue-actions">${btn('QRを発行', 'issue-table', true)}</div></form></section><section class="venue-card"><h2>QR一覧</h2><div class="venue-list">${tables.map((t) => `<div class="venue-row" data-table-id="${esc(t.id)}"><div class="venue-row-head"><strong>${esc(t.label)}</strong><small>${t.active ? '有効' : '停止中'}</small></div>${t.active && t.url ? `<input class="venue-url" readonly value="${esc(t.url)}" aria-label="${esc(t.label)}のQRリンク">` : ''}<div class="venue-actions">${t.active && t.url ? btn('QRを表示・印刷', 'show-qr', false, `data-table-id="${esc(t.id)}"`) : ''}${t.active ? btn('停止', 'revoke-table', false, `data-table-id="${esc(t.id)}"`) : btn('再発行', 'reissue-table', false, `data-table-id="${esc(t.id)}"`)}</div></div>`).join('') || '<p class="venue-muted">まだQRがありません。</p>'}</div></section>${state.qr ? `<section class="venue-card venue-qr"><div class="venue-pop-head">${state.venue?.logoUrl ? `<img src="${esc(state.venue.logoUrl)}" alt="${esc(state.venue.name)}のロゴ">` : ''}<strong>${esc(state.venue?.name || '店舗')}</strong></div><h2>${esc(state.qr.label)}</h2><p>下のQRを読み取って、店舗のおすすめカードをお楽しみください。</p><img src="${esc(state.qr.image)}" alt="${esc(state.qr.label)}のQRコード"><p class="venue-muted venue-pop-url">${esc(state.qr.url)}</p><div class="venue-actions">${btn('印刷', 'print-qr', true)}</div></section>` : ''}`; }
function usageView() { const stats = state.stats; return `<section class="venue-card"><h2>利用状況</h2>${stats ? `<div class="venue-stats"><div><strong>${stats.totals.starts}</strong><span>開始</span></div><div><strong>${stats.totals.completedRounds}</strong><span>6枚完了</span></div></div><h3>人気テーマ</h3><ul>${stats.popularThemes.map((item) => `<li>${esc(currentSets().find((s) => s.id === item.setId)?.name || '提供テーマ')}：${item.count}</li>`).join('') || '<li>まだ利用データがありません。</li>'}</ul>` : '<p class="venue-muted">利用状況を読み込んでいます。</p>'}</section>`; }
function homeView() { const sets = currentSets(); const tables = currentTables(); return `<section class="venue-card"><h1>${esc(state.venue?.name || '店舗用スペース')}</h1><p class="venue-muted">提供テーマと卓上QRを管理します。参加者の名前や回答内容は保存しません。</p><div class="venue-stats"><div><strong>${sets.filter((s) => s.active).length}</strong><span>提供中テーマ</span></div><div><strong>${tables.filter((t) => t.active).length}</strong><span>有効なQR</span></div></div><div class="venue-actions">${btn('テーマを追加', 'tab', true, 'data-tab="themes"')}${btn('QRを発行', 'tab', false, 'data-tab="qr"')}</div></section>`; }
function manager() { const notice = state.notice || state.error ? `<section class="venue-card venue-notice" aria-live="polite">${esc(state.notice)}${state.error ? `<span class="venue-error">${esc(state.error)}</span>` : ''}</section>` : ''; if (!state.venue) { shell(`${notice}${settingsForm()}<p class="venue-muted">店舗を登録すると、テーマとQRを管理できます。</p>`); return; } let body = state.tab === 'themes' ? themesView() : state.tab === 'qr' ? qrView() : state.tab === 'usage' ? usageView() : state.tab === 'settings' ? settingsForm() : homeView(); shell(`${notice}${nav()}<div id="venue-panel" role="tabpanel" aria-labelledby="venue-tab-${esc(state.tab)}">${body}</div>`); }
function normalizeMySets(items, customCards = []) { return playableSavedSets(items, customCards).map((set) => ({ ...set, cardIds: set.card_ids })); }
async function refresh(epoch = state.epoch) { const data = await accountApi.listVenues(); if (epoch !== state.epoch) return false; state.data = data; state.venue = data.venues[0] || null; if (state.qr && !currentTables().some((table) => table.id === state.qr.tableId && table.active && table.url)) state.qr = null; return true; }
async function showQr(table, epoch = state.epoch) { if (!table?.active || !table.url) throw new Error('QRリンクを取得できませんでした。'); const image = await toDataURL(table.url, { width: 240, margin: 4 }); if (epoch !== state.epoch) return false; state.qr = { tableId: table.id, label: table.label, url: table.url, image }; state.tab = 'qr'; state.error = ''; manager(); return true; }
function clearPrivateData() { state.data = null; state.venue = null; state.mySets = []; state.rawMySets = []; state.customCards = []; state.stats = null; state.qr = null; state.ownerId = ''; state.ownerAgeConfirmed = false; state.authUserId = ''; state.pending = ''; state.formDraft = null; }
async function loadManager() { const epoch = ++state.epoch; try { await discoverAccountConfig(); if (epoch !== state.epoch) return; unsubscribe?.unsubscribe?.(); const authSubscription = accountApi.onAuthStateChange?.((event, session) => { const nextId = session?.user?.id || ''; if (nextId && state.authUserId && nextId !== state.authUserId) { state.epoch += 1; clearPrivateData(); state.error = 'アカウントが切り替わりました。再読み込みしてください。'; shell(`<section class="venue-card"><h1>店舗管理</h1><p class="venue-error">${esc(state.error)}</p></section>`); return; } if (nextId) state.authUserId = nextId; if (event === 'SIGNED_OUT') { state.epoch += 1; clearPrivateData(); state.notice = 'ログアウトしました。'; state.error = ''; shell(`<section class="venue-card"><h1>店舗管理</h1><p class="venue-muted">ログアウトしました。店舗データは表示していません。</p><a class="venue-button primary" href="/">サービスへ戻る</a></section>`); } }); unsubscribe = authSubscription?.data?.subscription || authSubscription?.subscription || authSubscription; const me = await accountApi.me(); if (epoch !== state.epoch || !me.user) throw new Error('店舗管理はログインが必要です。'); if (state.authUserId && me.user.id && state.authUserId !== me.user.id) throw new Error('アカウントが切り替わりました。再読み込みしてください。'); state.ownerId = me.user.id || ''; state.ownerAgeConfirmed = typeof me.account?.adultConfirmedAt === 'string' && me.account.adultConfirmedAt !== ''; state.authUserId = state.ownerId; state.rawMySets = Array.isArray(me.sets) ? me.sets : []; state.customCards = Array.isArray(me.customCards) ? me.customCards : []; state.mySets = normalizeMySets(state.rawMySets, state.customCards); if (!await refresh(epoch)) return; if (epoch !== state.epoch) return; if (state.tab === 'usage' && state.venue) { const stats = await accountApi.venueStats(state.venue.id); if (epoch !== state.epoch) return; state.stats = stats; } manager(); } catch (e) { if (epoch !== state.epoch) return; state.error = message(e); shell(`<section class="venue-card"><h1>店舗管理</h1><p class="venue-error">${esc(state.error)}</p><a class="venue-button primary" href="/">サービスへ戻る</a></section>`); } }
async function runAction(action, form, target) {
  const epoch = state.epoch;
  const draft = form ? Object.fromEntries(new FormData(form)) : null;
  if (form?.dataset.form === 'venue') draft.adultEnabled = form.elements.adultEnabled?.checked ? 'on' : 'off';
  if (action === 'tab') {
    state.tab = target.dataset.tab || 'home'; state.notice = ''; state.error = '';
    if (state.tab === 'usage' && state.venue) {
      const stats = await accountApi.venueStats(state.venue.id);
      if (epoch !== state.epoch) return;
      state.stats = stats;
    }
    manager(); return;
  }
  if (action === 'save-venue') {
    if (!form?.reportValidity()) return;
    const p = draft; const adultField = Boolean(form.elements.adultEnabled); const enabling = adultField && p.adultEnabled === 'on' && !state.venue?.adultEnabled;
    if (enabling && p.participantsAdultAttested !== 'on') { state.formDraft = { type: 'venue', values: p }; state.error = message('ADULT_ATTESTATION_REQUIRED'); manager(); return; }
    state.formDraft = { type: 'venue', values: p }; state.pending = action; manager();
    const payload = { name:p.name, logoUrl:p.logoUrl || null, storeUrl:p.storeUrl || null, endingUrl:p.endingUrl || null, welcomeText:p.welcomeText || '', ...(adultField ? { adultEnabled:p.adultEnabled === 'on' } : {}), ...(enabling ? { participantsAdultAttested:true } : {}) };
    if (state.venue) await accountApi.updateVenue(state.venue.id, payload); else await accountApi.createVenue(payload);
    if (epoch !== state.epoch) return;
    await refresh(epoch); if (epoch !== state.epoch) return;
    state.pending = ''; state.formDraft = null; state.error = ''; state.notice = '店舗設定を保存しました。'; manager(); return;
  }
  if (action === 'add-set') {
    if (!form?.reportValidity()) return;
    const p = draft; state.formDraft = { type: 'set', values: p }; state.pending = action; manager();
    const [sourceType, sourceId] = String(p.source).split(':');
    await accountApi.addVenueSet(state.venue.id, { name:p.name, sourceType, sourceId });
    if (epoch !== state.epoch) return;
    await refresh(epoch); if (epoch !== state.epoch) return;
    state.pending = ''; state.formDraft = null; state.error = ''; state.tab = 'themes'; state.notice = '提供テーマを追加しました。'; manager(); return;
  }
  if (action === 'issue-table') {
    if (!form?.reportValidity()) return;
    const label = draft.label; state.formDraft = { type: 'table', values: draft }; state.pending = action; manager();
    const result = await accountApi.issueVenueTable(state.venue.id, { label });
    if (epoch !== state.epoch) return;
    await refresh(epoch); if (epoch !== state.epoch) return;
    state.pending = ''; state.formDraft = null; await showQr(result.table, epoch); return;
  }
  if (action === 'show-qr') {
    const table = currentTables().find((row) => row.id === target.dataset.tableId);
    if (!table?.active || !table.url) throw new Error('QRリンクを取得できませんでした。');
    await showQr(table, epoch); return;
  }
  if (action === 'revoke-table') {
    state.pending = action; state.qr = null; manager();
    await accountApi.revokeVenueTable(target.dataset.tableId);
    if (epoch !== state.epoch) return;
    await refresh(epoch); if (epoch !== state.epoch) return;
    state.pending = ''; state.error = ''; state.notice = 'QRを停止しました。'; manager(); return;
  }
  if (action === 'reissue-table') {
    state.pending = action; state.qr = null; manager();
    const result = await accountApi.rotateVenueTable(target.dataset.tableId);
    if (epoch !== state.epoch) return;
    await refresh(epoch); if (epoch !== state.epoch) return;
    state.pending = ''; await showQr(result.table, epoch); return;
  }
  if (action === 'deactivate-set' || action === 'activate-set') {
    state.pending = action; manager();
    await accountApi.updateVenueSet(target.dataset.setId, { active: action === 'activate-set' });
    if (epoch !== state.epoch) return;
    await refresh(epoch); if (epoch !== state.epoch) return;
    state.pending = ''; state.error = ''; state.notice = action === 'activate-set' ? 'テーマを再公開しました。' : 'テーマを停止しました。'; manager(); return;
  }
  if (action === 'print-qr') window.print();
}
root.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || state.pending || actionInFlight) return;
  const action = target.dataset.action;
  const form = target.closest('form');
  const actionEpoch = state.epoch;
  actionInFlight = true;
  try { await runAction(action, form, target); }
  catch (e) {
    if (actionEpoch !== state.epoch) return;
    if (state.pending) state.pending = '';
    state.error = message(e);
    manager();
  } finally { actionInFlight = false; }
});
root.addEventListener('change', (event) => {
  const toggle = event.target?.closest?.('[data-adult-toggle]');
  if (!toggle) return;
  const box = root.querySelector('[data-attest]');
  if (!box) return;
  box.hidden = !toggle.checked;
  const attest = box.querySelector('input');
  if (attest) attest.required = toggle.checked;
});
root.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.pending) event.target.querySelector('[data-action]')?.click();
});
if (token) location.replace(`/?venue=${encodeURIComponent(token)}`); else loadManager();
