const loginView = document.querySelector('#login-view');
const dashboardView = document.querySelector('#dashboard-view');
const loginForm = document.querySelector('#login-form');
const passwordInput = document.querySelector('#admin-password');
const loginMessage = document.querySelector('#login-message');
const dashboardMessage = document.querySelector('#dashboard-message');
const dataStatus = document.querySelector('#data-status');
const updatedAt = document.querySelector('#updated-at');
const trackingStarted = document.querySelector('#tracking-started');
const pageTotal = document.querySelector('#page-views-total');
const themeTotal = document.querySelector('#theme-starts-total');
const roundCompletesTotal = document.querySelector('#round-completes-total');
const roundContinuesTotal = document.querySelector('#round-continues-total');
const sessionCompletesTotal = document.querySelector('#session-completes-total');
const pagesList = document.querySelector('#pages-list');
const themesList = document.querySelector('#themes-list');
const dailyList = document.querySelector('#daily-list');
const feedbackList = document.querySelector('#feedback-list');
const feedbackCount = document.querySelector('#feedback-count');
const rangeButtons = [...document.querySelectorAll('.range-button')];
let selectedRange = 'today';
let busy = false;

function showLogin(message = '') {
  loginView.hidden = false;
  dashboardView.hidden = true;
  loginMessage.textContent = message;
  passwordInput.value = '';
  if (message) passwordInput.focus();
}

function showDashboard() { loginView.hidden = true; dashboardView.hidden = false; }

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('ja-JP') : '—';
}

function formatDateTime(value) {
  if (!value) return '更新日時: —';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '更新日時: —' : `更新日時: ${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(date)}`;
}

function setDataMessage(message = '', isError = false) {
  dashboardMessage.textContent = message;
  dataStatus.textContent = message ? (isError ? '取得エラー' : message) : '取得済み';
  dataStatus.classList.toggle('error', isError);
}

function setEmpty(element, message) {
  element.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = message;
  element.append(empty);
}

function renderMetrics(element, values, suffix) {
  element.replaceChildren();
  if (!Array.isArray(values) || values.length === 0) { setEmpty(element, 'データがありません'); return; }
  const max = Math.max(1, ...values.map((item) => Number(item?.count) || 0));
  values.forEach((item) => {
    const row = document.createElement('div'); row.className = 'metric-row';
    const label = document.createElement('span'); label.className = 'metric-label'; label.textContent = String(item?.label ?? item?.id ?? '名称未設定');
    const bar = document.createElement('span'); bar.className = 'metric-bar';
    const fill = document.createElement('span'); fill.className = 'metric-fill'; fill.style.width = `${Math.max(0, (Number(item?.count) || 0) / max * 100)}%`; bar.append(fill);
    const count = document.createElement('span'); count.className = 'metric-count'; count.textContent = `${formatNumber(Number(item?.count) || 0)} ${suffix}`;
    row.append(label, bar, count); element.append(row);
  });
}

function renderThemes(values) {
  themesList.replaceChildren();
  if (!Array.isArray(values) || values.length === 0) { setEmpty(themesList, 'データがありません'); return; }
  const table = document.createElement('div'); table.className = 'theme-metric-table';
  const header = document.createElement('div'); header.className = 'theme-metric-row theme-metric-header';
  ['テーマ', '開始', '6枚', '続行', '全40枚'].forEach((label) => { const cell = document.createElement('span'); cell.textContent = label; header.append(cell); }); table.append(header);
  values.forEach((item) => {
    const row = document.createElement('div'); row.className = 'theme-metric-row';
    const label = document.createElement('span'); label.className = 'theme-name'; label.textContent = String(item?.label ?? item?.id ?? '名称未設定'); row.append(label);
    for (const key of ['count', 'roundCompletes', 'roundContinues', 'sessionCompletes']) { const cell = document.createElement('span'); cell.className = 'theme-metric-value'; cell.textContent = formatNumber(Number(item?.[key]) || 0); row.append(cell); }
    table.append(row);
  });
  themesList.append(table);
}

function renderDaily(values) {
  dailyList.replaceChildren();
  if (!Array.isArray(values) || values.length === 0) { setEmpty(dailyList, 'データがありません'); return; }
  const table = document.createElement('div'); table.className = 'daily-metric-table';
  const header = document.createElement('div'); header.className = 'daily-metric-row daily-metric-header';
  ['日付', 'PV', '開始', '6枚', '続行', '全40枚'].forEach((label) => { const cell = document.createElement('span'); cell.textContent = label; header.append(cell); }); table.append(header);
  values.forEach((item) => {
    const row = document.createElement('div'); row.className = 'daily-metric-row';
    const valuesForRow = [item?.date, item?.pageViews, item?.themeStarts, item?.roundCompletes, item?.roundContinues, item?.sessionCompletes];
    valuesForRow.forEach((value, index) => { const cell = document.createElement('span'); cell.className = index === 0 ? 'daily-date' : 'daily-value'; cell.textContent = index === 0 ? String(value ?? '—') : formatNumber(Number(value) || 0); row.append(cell); });
    table.append(row);
  });
  dailyList.append(table);
}

function formatFeedbackDate(value) {
  if (!value) return '日時不明';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日時不明';
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(date);
}

function feedbackThemeLabel(id, labels) {
  if (id === 'mix') return 'ミックス';
  return labels.get(String(id)) || String(id || 'テーマ不明');
}

function renderFeedback(values, stats) {
  feedbackList.replaceChildren();
  const feedback = Array.isArray(values) ? values : [];
  const limit = Number(stats?.feedbackLimit) > 0 ? Number(stats.feedbackLimit) : 100;
  feedbackCount.textContent = `${formatNumber(feedback.length)}件`;
  if (feedback.length === 0) { setEmpty(feedbackList, 'この期間のフィードバックはありません'); return; }
  const themeLabels = new Map((Array.isArray(stats?.themes) ? stats.themes : []).map((theme) => [String(theme?.id), String(theme?.label ?? theme?.id ?? '')]));
  feedback.slice(0, limit).forEach((item) => {
    const card = document.createElement('article'); card.className = 'feedback-card';
    const top = document.createElement('div'); top.className = 'feedback-card-top';
    const date = document.createElement('time'); date.className = 'feedback-date'; date.dateTime = String(item?.createdAt || ''); date.textContent = formatFeedbackDate(item?.createdAt);
    const rating = document.createElement('span'); rating.className = `feedback-rating ${item?.rating === 'positive' ? 'positive' : item?.rating === 'needs_improvement' ? 'needs-improvement' : 'unrated'}`;
    rating.textContent = item?.rating === 'positive' ? 'いいね！' : item?.rating === 'needs_improvement' ? '改善余地大きい！' : '評価なし';
    top.append(date, rating); card.append(top);
    const ids = Array.isArray(item?.themeIds) && item.themeIds.length ? item.themeIds : [item?.themeId];
    const themeLine = document.createElement('p'); themeLine.className = 'feedback-themes';
    const themeNames = ids.filter(Boolean).map((id) => feedbackThemeLabel(id, themeLabels));
    const themePrefix = item?.themeId === 'mix' || ids.length > 1 ? 'テーマミックス: ' : 'テーマ: ';
    themeLine.textContent = `${themePrefix}${themeNames.join(' / ') || 'テーマ不明'}`; card.append(themeLine);
    if (item?.cursor !== undefined && item?.cursor !== null && String(item.cursor) !== '') {
      const cursor = document.createElement('span'); cursor.className = 'feedback-cursor'; cursor.textContent = `${String(item.cursor)}枚終了時`; card.append(cursor);
    }
    const text = document.createElement('p'); text.className = 'feedback-text'; text.textContent = item?.text ? String(item.text) : '（本文なし）'; card.append(text);
    feedbackList.append(card);
  });
}

function renderStats(stats) {
  const totals = stats?.totals || {};
  pageTotal.textContent = formatNumber(Number(totals.pageViews));
  themeTotal.textContent = formatNumber(Number(totals.themeStarts));
  roundCompletesTotal.textContent = formatNumber(Number(totals.roundCompletes));
  roundContinuesTotal.textContent = formatNumber(Number(totals.roundContinues));
  sessionCompletesTotal.textContent = formatNumber(Number(totals.sessionCompletes));
  updatedAt.textContent = formatDateTime(stats?.updatedAt);
  renderMetrics(pagesList, stats?.pages, 'PV');
  renderThemes(stats?.themes);
  renderDaily(stats?.daily);
  renderFeedback(stats?.feedback, stats);
  trackingStarted.textContent = stats?.trackingStartedAt ? `計測開始: ${formatDateTime(stats.trackingStartedAt).replace('更新日時: ', '')}` : '計測開始: まだありません';
}

async function api(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...(options?.headers || {}) } });
  let payload = null; try { payload = await response.json(); } catch { /* empty response */ }
  return { response, payload };
}

async function loadStats() {
  if (busy) return; busy = true; rangeButtons.forEach((button) => { button.disabled = true; }); setDataMessage('読み込み中…');
  try {
    const { response, payload } = await api(`/api/admin/stats?range=${encodeURIComponent(selectedRange)}`);
    if (response.status === 401) { showLogin('セッションの有効期限が切れました。'); return; }
    if (!response.ok) throw new Error('stats');
    renderStats(payload); setDataMessage('取得済み');
  } catch { setDataMessage('データを取得できませんでした。再度お試しください。', true); }
  finally { busy = false; rangeButtons.forEach((button) => { button.disabled = false; }); }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy) return;
  if (!passwordInput.value) { loginMessage.textContent = 'パスワードを入力してください。'; passwordInput.focus(); return; }
  busy = true; loginMessage.textContent = '確認中…';
  try {
    const { response } = await api('/api/admin/session', { method: 'POST', body: JSON.stringify({ password: passwordInput.value }) });
    if (response.ok) { passwordInput.value = ''; showDashboard(); busy = false; await loadStats(); }
    else if (response.status === 401) loginMessage.textContent = 'パスワードが正しくありません。';
    else if (response.status === 429) loginMessage.textContent = '試行回数が多すぎます。しばらく待ってください。';
    else if (response.status === 503) loginMessage.textContent = '管理画面は現在利用できません。';
    else loginMessage.textContent = 'ログインできませんでした。';
  } catch { loginMessage.textContent = '通信に失敗しました。'; }
  finally { busy = false; }
});

document.querySelector('#refresh-button').addEventListener('click', loadStats);
document.querySelector('#logout-button').addEventListener('click', async () => {
  if (busy) return;
  try {
    const { response } = await api('/api/admin/session', { method: 'DELETE' });
    if (response.ok) showLogin();
    else setDataMessage('ログアウトに失敗しました。再度お試しください。', true);
  } catch { setDataMessage('ログアウトに失敗しました。通信を確認してください。', true); }
});
rangeButtons.forEach((button) => button.addEventListener('click', () => {
  if (busy || button.disabled) return;
  selectedRange = button.dataset.range;
  rangeButtons.forEach((item) => item.classList.toggle('is-active', item === button));
  loadStats();
}));

async function init() {
  try {
    const { response } = await api('/api/admin/session');
    if (response.ok) { showDashboard(); await loadStats(); } else showLogin();
  } catch { showLogin('通信に失敗しました。'); }
}

init();
