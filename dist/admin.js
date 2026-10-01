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
const pagesList = document.querySelector('#pages-list');
const themesList = document.querySelector('#themes-list');
const dailyList = document.querySelector('#daily-list');
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

function renderDaily(values) {
  dailyList.replaceChildren();
  if (!Array.isArray(values) || values.length === 0) { setEmpty(dailyList, 'データがありません'); return; }
  const max = Math.max(1, ...values.flatMap((item) => [Number(item?.pageViews) || 0, Number(item?.themeStarts) || 0]));
  values.forEach((item) => {
    const pageViews = Number(item?.pageViews) || 0; const themeStarts = Number(item?.themeStarts) || 0;
    const row = document.createElement('div'); row.className = 'daily-row';
    const date = document.createElement('span'); date.className = 'daily-date'; date.textContent = String(item?.date ?? '—');
    const bar = document.createElement('span'); bar.className = 'daily-bar';
    const pv = document.createElement('span'); pv.className = 'daily-pv'; pv.style.width = `${pageViews / max * 100}%`;
    const theme = document.createElement('span'); theme.className = 'daily-theme'; theme.style.width = `${themeStarts / max * 100}%`; bar.append(pv, theme);
    const pvValue = document.createElement('span'); pvValue.className = 'daily-value'; pvValue.textContent = `PV ${formatNumber(pageViews)}`;
    const themeValue = document.createElement('span'); themeValue.className = 'daily-value'; themeValue.textContent = `開始 ${formatNumber(themeStarts)}`;
    row.append(date, bar, pvValue, themeValue); dailyList.append(row);
  });
}

function renderStats(stats) {
  const totals = stats?.totals || {};
  pageTotal.textContent = formatNumber(Number(totals.pageViews));
  themeTotal.textContent = formatNumber(Number(totals.themeStarts));
  updatedAt.textContent = formatDateTime(stats?.updatedAt);
  renderMetrics(pagesList, stats?.pages, 'PV');
  renderMetrics(themesList, stats?.themes, '回');
  renderDaily(stats?.daily);
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
