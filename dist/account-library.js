import { decks } from './data/decks.js';
import { soloDecks } from './data/solo-decks.js';
import { isAgeConfirmed } from './theme-access.js';
import { CREATOR_PRESETS, CREATOR_PRESET_IDS, normalizeCreatorDesign } from './creator-metadata.js';

function customKey(id) { return typeof id === 'string' && id.startsWith('custom:') ? id : `custom:${id}`; }
export function canonicalCard(cardId, customCards = []) {
  if (typeof cardId !== 'string') return null;
  for (const deck of [...decks, ...soloDecks]) {
    const regular = deck.questions?.find((card) => card.id === cardId);
    if (regular) return { ...regular, sourceDeckId: deck.id, r18: regular.r18 === true || deck.adultOnly === true };
    const adult = deck.r18Questions?.find((card) => card.id === cardId);
    if (adult) return { ...adult, sourceDeckId: deck.id, r18: true };
  }
  const custom = (Array.isArray(customCards) ? customCards : []).find((card) => customKey(card?.id) === cardId);
  if (custom && typeof custom.text === 'string') return { ...custom, id: customKey(custom.id), sourceDeckId: 'custom', r18: custom.r18 === true, custom: true };
  return null;
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c])); }
function customCardsOf(account) { return (Array.isArray(account.customCards) ? account.customCards : []).map((card) => ({ ...card, id: customKey(card.id) })); }
const ADULT_HIDDEN_TEXT = 'R18の質問（年齢確認後に表示）';
function cardText(card, revealAdult, confirmed = true) { return card?.r18 ? (!confirmed ? ADULT_HIDDEN_TEXT : revealAdult ? card?.text || '' : 'R18の質問') : card?.text || ''; }
function setHasR18(row, customCards) { const ids = Array.isArray(row?.card_ids) ? row.card_ids : []; return row?.r18 === true || row?.theme_r18 === true || row?.effectiveR18 === true || ids.some((id) => canonicalCard(id, customCards)?.r18 === true); }
function itemCard(item, customCards) {
  if (!item || typeof item !== 'object') return null;
  if (item.kind === 'saved') return canonicalCard(item.cardId, customCards);
  if (item.kind === 'custom' && typeof item.text === 'string') return { ...item, text: item.text, r18: item.r18 === true, custom: true };
  if (item.kind === 'custom') return canonicalCard(item.id, customCards);
  return null;
}
function draftItems(row) { return Array.isArray(row?.items) ? row.items : []; }
function reason(account, key, fallback) { return account[key] === false ? fallback : ''; }
function button(label, action, attrs = '', className = 'secondary-button') { return `<button type="button" class="${className}" data-action="${action}" ${attrs}>${label}</button>`; }
function iconButton(label, action, attrs = '', path = 'M5 5h14v14H5z') { return `<button type="button" class="text-button creator-icon-action" data-action="${action}" ${attrs} aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg></button>`; }

function renderSetRows(account, drafts, customCards, confirmed, reveal) {
  const sets = Array.isArray(account.sets) ? account.sets : [];
  const draftSources = new Set(drafts.map((row) => row.sourceSetId).filter(Boolean));
  return sets.filter((row) => !draftSources.has(row.id)).map((row) => {
    const count = Array.isArray(row.card_ids) ? row.card_ids.length : 0;
    const hasR18 = setHasR18(row, customCards);
    const locked = hasR18 && (!confirmed || !reveal);
    const soloOnly = row.audience === 'solo';
    const lockAttr = locked ? 'disabled title="年齢確認後に遊べます"' : '';
    const play = count >= 6 && count <= 40 ? button('遊ぶ', 'set-play', `data-set-id="${esc(row.id)}" ${lockAttr}`, 'primary-button') : '<span class="studio-list-note">下書き</span>';
    const publish = !locked && count >= 6 && count <= 40 ? `<a class="text-button" href="/marketplace.html?publish=${encodeURIComponent(row.id)}">公開する</a>` : '';
    const displayName = locked && hasR18 ? 'R18を含むマイセット' : (row.name || '無題のセット');
    const lockText = !confirmed ? 'R18を含む · 年齢確認後に遊べます' : 'R18を含む · 「R18を表示する」で表示できます';
    return `<article class="library-set studio-set-row"><div class="studio-set-copy"><strong>${esc(displayName)}</strong><span>${count}枚${soloOnly ? ' · ひとりで専用' : ''}${locked ? ` · ${lockText}` : ''}</span></div><div class="studio-row-actions">${play}${publish}${button(soloOnly ? '共有を管理' : '共有', 'set-share', `data-set-id="${esc(row.id)}" ${soloOnly ? '' : lockAttr}`)}${button('編集', 'studio-edit-set', `data-set-id="${esc(row.id)}" ${locked ? 'disabled title="R18を表示してから編集できます"' : ''}`)}${button('削除', 'set-delete', `data-set-id="${esc(row.id)}"`, 'text-button')}</div></article>`;
  }).join('') || '<p class="account-muted">セットはまだありません。</p>';
}
function renderDraftRows(account, drafts, customCards = [], confirmed = false, reveal = false) {
  return drafts.map((row) => { const hasR18 = row?.r18 === true || row?.theme_r18 === true || draftItems(row).some((item) => itemCard(item, customCards)?.r18 === true); const locked = hasR18 && (!confirmed || !reveal); const name = locked ? 'R18を含む下書き' : (row.name || '無題の下書き'); return `<article class="library-set studio-set-row library-draft"><div class="studio-set-copy"><strong>${esc(name)}</strong><span>${draftItems(row).length}枚 · 下書き${locked ? ' · 「R18を表示する」で表示できます' : ''}</span></div><div class="studio-row-actions">${button('編集', 'studio-edit-draft', `data-draft-id="${esc(row.id)}" ${locked ? 'disabled title="R18を表示してから編集できます"' : ''}`, 'primary-button')}${button('破棄', 'studio-delete-draft', `data-draft-id="${esc(row.id)}"`, 'text-button')}</div></article>`; }).join('') || '<p class="account-muted">下書きはまだありません。</p>';
}
function renderFavorites(account, customCards, reveal, confirmed) {
  const favorites = account.favorites instanceof Set ? account.favorites : new Set(account.favorites || []);
  const rows = [...favorites].map((id) => canonicalCard(id, customCards)).filter(Boolean).map((card) => `<article class="studio-manage-row"><span>${esc(cardText(card, reveal, confirmed))}</span>${button('外す', 'remove-favorite', `data-card-id="${esc(card.id)}"`, 'text-button')}</article>`).join('');
  return `<section class="studio-subpanel studio-manage-panel"><div class="studio-subhead"><h2>お気に入り</h2>${button('戻る', 'studio-back', '', 'text-button')}</div><p class="account-hint">お気に入りの管理はセットから独立しています。</p><div class="studio-manage-list">${rows || '<p class="account-muted">お気に入りはまだありません。</p>'}</div></section>`;
}
function renderCustomLibrary(account, customCards, reveal, confirmed) {
  const rows = customCards.map((card) => `<article class="studio-manage-row"><span>${esc(cardText(card, reveal, confirmed))}</span>${button('編集', 'custom-card-edit', `data-card-id="${esc(card.id)}" ${card.r18 === true && (!confirmed || !reveal) ? 'disabled title="R18を表示してから編集できます"' : ''}`)}${button('削除', 'custom-card-delete', `data-card-id="${esc(card.id)}"`, 'text-button')}</article>`).join('');
  return `<section class="studio-subpanel studio-manage-panel"><div class="studio-subhead"><h2>自分の質問カード</h2>${button('戻る', 'studio-back', '', 'text-button')}</div><div class="studio-manage-list">${rows || '<p class="account-muted">質問カードはまだありません。</p>'}</div>${button('質問を書く', 'custom-card-new', '', 'secondary-button')}</section>`;
}
function renderCustomEditor(account, reveal, confirmed) {
  const editing = Boolean(account.editingCardId);
  const text = account.customDraftR18 && (!reveal || !confirmed) ? '' : account.customDraft || '';
  return `<section class="studio-subpanel custom-card-editor creator-question-editor"><div class="studio-subhead"><div><span class="creator-eyebrow">質問を作る</span><h2>${editing ? '質問を編集' : '新しい質問'}</h2></div>${button('戻る', 'custom-card-cancel', '', 'text-button')}</div><div class="creator-question-editor-grid"><form id="custom-card-form" data-form="custom-card" class="studio-custom-form"><label>質問本文<textarea data-custom-text maxlength="300" rows="7" required placeholder="例：思いがけずドキッとした出来事は？">${esc(text)}</textarea></label><p class="account-hint" data-custom-count>文字数 ${Array.from(account.customDraft || '').length} / 300</p>${!confirmed ? '<p class="account-hint">R18設定は年齢確認後に利用できます。</p>' : account.r18DisplayEnabled !== true ? '<p class="account-hint">アカウント設定で「R18を表示する」をオンにすると設定できます</p>' : `<label class="library-consent"><input type="checkbox" data-custom-r18 ${account.customDraftR18 ? 'checked' : ''}/> R18の話題にする</label>`}</form><aside class="creator-live-preview"><span class="creator-eyebrow">プレビュー</span><div class="creator-preview-card" data-custom-preview style="--creator-back:url('/assets/card-families/first-meeting-back.webp')"><span>${esc(text || 'ここに質問が表示されます')}</span></div><p>入力内容をそのままカードで確認できます。</p></aside></div><div class="studio-save-footer creator-question-save"><button type="submit" form="custom-card-form" class="primary-button" ${account.busy ? 'disabled' : ''}>${account.busy ? '保存中…' : '質問を保存する'}</button></div></section>`;
}
function renderList(account, customCards, reveal, confirmed) {
  const drafts = Array.isArray(account.drafts) ? account.drafts : [];
  const aiAvailable = account.aiAvailable ?? account.aiGenerationAvailable;
  const disabledAi = aiAvailable !== true ? 'disabled title="現在AIセットを利用できません"' : '';
  const draftReason = reason(account, 'draftsAvailable', '下書き保存は現在利用できません。');
  const aiReason = aiAvailable === false ? 'AIで作る機能は現在利用できません。' : '';
  return `<div class="studio-actions studio-entry-actions">${button('テーマを作る', 'set-new', '', 'primary-button')}${button('お気に入りから', 'studio-from-favorites', '', 'secondary-button')}${button('質問を作る', 'custom-card-new', '', 'secondary-button')}${button('AIで作る', 'studio-ai', disabledAi, 'secondary-button')}</div><p class="account-hint studio-intro">質問を集めて、あなただけのテーマを作ります。</p><p class="account-hint"><a href="/marketplace.html">マーケットプレイスを見る</a> · <a href="/daily.html">1日1問</a></p>${draftReason ? `<p class="account-hint studio-reason">${draftReason}</p>` : ''}${aiReason ? `<p class="account-hint studio-reason">${aiReason}</p>` : ''}<div class="studio-tabs">${button('お気に入りを管理', 'studio-favorites', '', 'text-button')}${button('自分の質問カード', 'studio-custom-library', '', 'text-button')}</div><h2>マイセット</h2><div class="library-sets">${renderSetRows(account, drafts, customCards, confirmed, reveal)}</div><h2>下書き</h2><div class="library-sets">${renderDraftRows(account, drafts, customCards, confirmed, reveal)}</div>${account.completionAvailable === false ? `<p class="account-hint studio-reason">現在セットを保存できません。下書きは保存できます。</p>` : ''}`;
}
function renderPicker(account, customCards, reveal, confirmed) {
  const favorites = account.favorites instanceof Set ? account.favorites : new Set(account.favorites || []);
  const selected = account.selectedCards instanceof Set ? account.selectedCards : new Set(account.selectedCards || []);
  const ids = [...new Set([...favorites, ...customCards.map((card) => card.id)])].filter((id) => { const card = canonicalCard(id, customCards); return card && (card.r18 !== true || (confirmed && reveal)); });
  const rows = ids.map((id) => { const card = canonicalCard(id, customCards); return `<label class="studio-picker-row"><input type="checkbox" data-select-card data-card-id="${esc(id)}" ${selected.has(id) ? 'checked' : ''} ${account.busy ? 'disabled' : ''}/><span>${esc(cardText(card, reveal, confirmed))}</span></label>`; }).join('');
  return `<section class="studio-subpanel studio-picker"><div class="studio-subhead"><h2>${account.studioReplaceIndex != null ? '入れ替える質問' : '追加する質問'}</h2>${button('戻る', 'studio-back', '', 'text-button')}</div><p class="account-hint">お気に入りと自分の質問カードから選べます。</p><div class="studio-picker-list">${rows || '<p class="account-muted">追加できる質問がありません。質問を書くから作成できます。</p>'}</div>${button('完了', 'studio-back', '', 'primary-button')}</section>`;
}
function renderAi(account, confirmed) {
  const questions = Array.isArray(account.aiQuestions) ? account.aiQuestions : [];
  return `<section class="studio-subpanel studio-ai-panel"><div class="studio-subhead"><h2>AIで作る</h2>${button('戻る', 'studio-back', '', 'text-button')}</div><p class="account-hint">テーマから新しい質問案を作ります。生成後に確認・編集して採用できます。</p><form data-form="ai" class="studio-ai-form"><label>テーマ<input data-ai-theme value="${esc(account.aiTheme || '')}" maxlength="80" placeholder="例：最近考えていること" required /></label><label>トーン<input data-ai-tone value="${esc(account.aiTone || '')}" maxlength="40" placeholder="例：あたたかく" /></label><label>枚数<select data-ai-count><option value="6" ${account.aiCount === 6 ? 'selected' : ''}>6枚</option><option value="12" ${account.aiCount === 12 ? 'selected' : ''}>12枚</option></select></label>${confirmed && account.r18DisplayEnabled === true ? `<label class="ai-r18-toggle"><input type="checkbox" data-ai-r18 ${account.aiR18 === true ? 'checked' : ''}/> <span>R18の話題を含める</span></label>` : ''}<button type="submit" class="primary-button" ${account.busy ? 'disabled' : ''}>${account.busy ? '生成中…' : '質問案を生成'}</button></form>${questions.length ? `<div class="ai-preview"><h3>質問案を確認</h3>${questions.map((q, i) => { const hidden = q.r18 === true && (!confirmed || account.r18DisplayEnabled !== true); return `<label class="ai-card"><input type="checkbox" data-ai-select data-ai-index="${i}" ${q.selected !== false ? 'checked' : ''}/><textarea data-ai-text data-ai-index="${i}" maxlength="300">${esc(hidden ? '' : q.text || '')}</textarea>${hidden ? '<small class="account-hint">R18の質問（「R18を表示する」で表示）</small>' : ''}</label>`; }).join('')}${button('選択した案を採用', 'studio-ai-adopt', '', 'primary-button')}${button('破棄', 'studio-ai-discard', '', 'text-button')}</div>` : ''}</section>`;
}
function renderEditor(account, customCards, reveal, confirmed) {
  const items = Array.isArray(account.studioItems) ? account.studioItems : [];
  const editingSet = Array.isArray(account.sets) ? account.sets.find((set) => set.id === account.editingSetId) : null;
  const editorLockedAdult = (!confirmed || !reveal) && (editingSet?.r18 === true || editingSet?.theme_r18 === true || editingSet?.effectiveR18 === true || account.studioR18 === true || items.some((item) => itemCard(item, customCards)?.r18 === true));
  if (editorLockedAdult) return `<section class="studio-subpanel studio-editor"><div class="studio-subhead"><h2>R18セット</h2>${button('一覧へ', 'studio-back', '', 'text-button')}</div><p class="account-hint">R18を表示するまで、セット名と質問は表示しません。</p></section>`;
  const name = editorLockedAdult ? '' : (account.setName || '');
  const count = items.length;
  const childAdult = items.some((item) => itemCard(item, customCards)?.r18 === true);
  const explicitAdult = account.studioR18 === true;
  const effectiveAdult = explicitAdult || childAdult;
  const design = normalizeCreatorDesign(account.studioDesign) || { version: 1, kind: 'preset', presetId: 'first-meeting' };
  const designCards = CREATOR_PRESET_IDS.map((id) => `<button type="button" class="creator-design-swatch ${design.presetId === id ? 'is-selected' : ''}" data-action="studio-design" data-design-id="${id}" aria-label="${esc(CREATOR_PRESETS[id].label)}" aria-pressed="${design.presetId === id}" title="${esc(CREATOR_PRESETS[id].label)}"><img src="${CREATOR_PRESETS[id].back}" alt="" loading="lazy"><span>${esc(CREATOR_PRESETS[id].label)}</span></button>`).join('');
  const cards = items.map((item, index) => {
    const card = itemCard(item, customCards); const isCustom = item.kind === 'custom'; const text = cardText(card, reveal, confirmed);
    const body = isCustom && !(card?.r18 && !reveal) ? `<textarea data-studio-item-text data-item-index="${index}" maxlength="300" aria-label="${index + 1}枚目の質問">${esc(text)}</textarea>` : `<span>${esc(text)}</span>`;
    const itemAdult = card?.r18 === true;
    const adultToggle = isCustom && confirmed && reveal ? `<label class="creator-item-r18"><input type="checkbox" data-studio-item-r18 data-item-index="${index}" ${itemAdult ? 'checked' : ''}> R18</label>` : (itemAdult ? '<span class="creator-r18-badge">R18</span>' : '');
    return `<article class="studio-item-card creator-question-row"><span class="studio-item-number">${index + 1}</span><div class="studio-item-body">${body}<small>${item.origin === 'ai' ? 'AI案' : isCustom ? '自作' : 'お気に入り'}</small></div><div class="studio-item-actions">${adultToggle}${iconButton('質問を入れ替える', 'studio-replace-item', `data-item-index="${index}"`, 'M12 5v14M5 12h14')}${iconButton('質問を外す', 'studio-remove-item', `data-item-index="${index}"`, 'M6 7h12M10 11v6M14 11v6M9 4h6')}</div></article>`;
  }).join('');
  const saveDisabled = account.busy || !name.trim() || count > 40 || account.draftsAvailable === false;
  const canComplete = count >= 6 && account.completionAvailable !== false;
  const saveLabel = canComplete ? 'セットを保存' : '下書きを保存';
  const saveHint = canComplete ? '6〜40枚でセットを保存します。' : account.completionAvailable === false ? '現在セットを保存できません。下書きとして保存できます。' : '0〜5枚は下書きとして保存します。';
  const r18Control = !confirmed ? '<p class="account-hint">R18設定は年齢確認後に利用できます。</p>' : !reveal ? '<p class="account-hint">アカウント設定で「R18を表示する」をオンにすると設定できます</p>' : `<label class="creator-r18-control"><input type="checkbox" data-studio-r18 ${effectiveAdult ? 'checked' : ''} ${childAdult ? 'disabled' : ''} aria-describedby="creator-r18-help"><span><strong>R18（大人向け）</strong><small id="creator-r18-help">${childAdult ? 'R18の質問を含むため自動設定' : '手動で設定できます。初期状態はオフです。'}</small></span>${childAdult ? '<span class="creator-lock" aria-label="自動設定">🔒</span>' : ''}</label>`;
  const previewItem = items.find((item) => { const previewCard = itemCard(item, customCards); return previewCard?.text; });
  const previewCard = previewItem ? itemCard(previewItem, customCards) : null;
  return `<section class="studio-subpanel studio-editor creator-editor"><div class="studio-subhead"><div><span class="creator-eyebrow">テーマを作る</span><h2>${account.editingDraftId || account.editingSetId ? 'テーマを編集' : '新しいテーマ'}</h2></div>${button('一覧へ', 'studio-back', '', 'text-button')}</div><div class="creator-editor-grid"><div class="creator-editor-fields"><label class="studio-name-field">テーマ名<input data-set-name name="set-name" maxlength="80" value="${esc(name)}" required placeholder="例：大人の本音時間" /></label><div class="creator-field-heading"><h3>質問リスト</h3><span class="library-count" data-selection-count>${count} / 40問</span></div><div class="studio-item-list">${cards || '<p class="account-muted studio-empty">質問を追加して、あなただけのテーマを作りましょう。</p>'}</div><div class="studio-add-entry"><button type="button" class="secondary-button" data-action="studio-picker">質問を追加</button><button type="button" class="secondary-button" data-action="studio-write">質問を書く</button><button type="button" class="secondary-button" data-action="studio-ai">AIで作る</button></div>${r18Control}<div class="creator-design-field"><div class="creator-field-heading"><h3>テーマのデザイン</h3><span>8種類から選択</span></div><div class="creator-design-grid">${designCards}</div></div></div><aside class="creator-live-preview" aria-label="カードプレビュー"><span class="creator-eyebrow">プレビュー</span><div class="creator-preview-card" data-creator-preview style="--creator-back:url('${CREATOR_PRESETS[design.presetId].back}')"><span>${esc(previewCard?.text || 'ここに質問が表示されます')}</span></div><p>実際のプレイ画面と同じカードデザインです。</p></aside></div><div class="studio-save-footer"><button type="submit" class="primary-button" ${saveDisabled ? 'disabled' : ''}>${saveLabel}</button><p class="account-hint">${saveHint}</p></div></section>`;
}
export function renderLibrary(account = {}) {
  const customCards = customCardsOf(account); const confirmed = isAgeConfirmed(account); const reveal = confirmed && account.r18DisplayEnabled === true; const mode = account.studioMode || 'list';
  let content = renderList(account, customCards, reveal, confirmed);
  if (account.customEditorOpen) content = renderCustomEditor(account, reveal, confirmed);
  else if (mode === 'editor') content = renderEditor(account, customCards, reveal, confirmed);
  else if (mode === 'picker') content = renderPicker(account, customCards, reveal, confirmed);
  else if (mode === 'ai') content = renderAi(account, confirmed);
  else if (mode === 'favorites') content = renderFavorites(account, customCards, reveal, confirmed);
  else if (mode === 'custom') content = renderCustomLibrary(account, customCards, reveal, confirmed);
  if (mode === 'editor' && !account.customEditorOpen) content = content.replace('<div class="studio-item-list">', `<div class="studio-meta-fields"><label>使う場面<select data-studio-audience><option value="group" ${(account.studioAudience || 'group') === 'group' ? 'selected' : ''}>みんなで</option><option value="solo" ${account.studioAudience === 'solo' ? 'selected' : ''}>ひとりで</option><option value="both" ${account.studioAudience === 'both' ? 'selected' : ''}>どちらでも</option></select></label><label>出題順<select data-studio-order><option value="shuffle" ${(account.studioQuestionOrder || 'shuffle') === 'shuffle' ? 'selected' : ''}>シャッフル</option><option value="fixed" ${account.studioQuestionOrder === 'fixed' ? 'selected' : ''}>並び順を固定</option></select></label></div><div class="studio-item-list">`);
  const drafts = Array.isArray(account.drafts) ? account.drafts : [];
  const compactDrafts = drafts.length ? `<h2>下書き</h2><div class="library-sets">${renderDraftRows(account, drafts, customCards, confirmed, reveal)}</div>` : '';
  if (mode === 'list') content = content.replace(`<h2>下書き</h2><div class="library-sets">${renderDraftRows(account, drafts, customCards, confirmed, reveal)}</div>`, compactDrafts);
  return `<section class="account-library studio-library" aria-labelledby="${account.hideTitle ? 'account-dialog-title' : 'library-title'}">${account.hideTitle ? '' : '<div class="library-head"><h1 id="library-title">マイセット</h1></div>'}${account.error ? `<p class="form-error" role="alert">${esc(account.error)}</p>` : ''}${account.status ? `<p class="account-status" role="status">${esc(account.status)}</p>` : ''}${content}</section>`;
}
