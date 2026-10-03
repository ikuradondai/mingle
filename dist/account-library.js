import { decks } from './data/decks.js';

function customKey(id) { return typeof id === 'string' && id.startsWith('custom:') ? id : `custom:${id}`; }
export function canonicalCard(cardId, customCards = []) {
  if (typeof cardId !== 'string') return null;
  for (const deck of decks) {
    const regular = deck.questions?.find((card) => card.id === cardId);
    if (regular) return { ...regular, sourceDeckId: deck.id, r18: regular.r18 === true || deck.adultOnly === true };
    const adult = deck.r18Questions?.find((card) => card.id === cardId);
    if (adult) return { ...adult, sourceDeckId: deck.id, r18: true };
  }
  const custom = (Array.isArray(customCards) ? customCards : []).find((card) => customKey(card?.id) === cardId);
  if (custom && typeof custom.text === 'string') return { id: cardId, text: custom.text, sourceDeckId: 'custom', r18: custom.r18 === true, custom: true };
  return null;
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c])); }
function cardLabel(card, revealAdult) { return card.r18 && !revealAdult ? 'R18の質問' : card.text; }
function customCardsOf(account) { return (Array.isArray(account.customCards) ? account.customCards : []).map((card) => ({ ...card, id: customKey(card.id) })); }

export function renderLibrary(account = {}) {
  const favorites = account.favorites instanceof Set ? account.favorites : new Set(account.favorites || []);
  const customCards = customCardsOf(account);
  const selected = account.selectedCards instanceof Set ? account.selectedCards : new Set(account.selectedCards || []);
  const sets = Array.isArray(account.sets) ? account.sets : [];
  const editing = account.editingSetId ? sets.find((set) => set.id === account.editingSetId) : null;
  const editingCards = new Set(editing?.card_ids || []);
  const ids = [...new Set([...favorites, ...customCards.map((card) => card.id), ...editingCards])];
  const reveal = account.revealAdult === true;
  const canonicalIds = ids.filter((id) => canonicalCard(id, customCards));
  const validSavedIds = canonicalIds.filter((id) => favorites.has(id) || customCards.some((card) => card.id === id));
  const validSelection = [...selected].every((id) => Boolean(canonicalCard(id, customCards)));
  const canCreateSet = validSavedIds.length > 0 && account.busy !== true;
  const hasAdult = canonicalIds.some((id) => canonicalCard(id, customCards)?.r18 === true);
  const busy = account.busy === true;
  const validName = typeof (account.setName ?? editing?.name) === 'string' && (account.setName ?? editing?.name).trim().length > 0;
  const setEditor = account.editingSetId || account.setName !== undefined ? `<section class="library-editor" aria-labelledby="library-editor-title"><h2 id="library-editor-title">${editing ? 'セットを編集' : '新しいセット'}</h2><form data-form="set"><label>セット名<input data-set-name name="set-name" maxlength="40" value="${esc(account.setName ?? editing?.name ?? '')}" required /></label>${hasAdult ? `<div class="library-consent"><label><input type="checkbox" data-library-adult ${reveal ? 'checked' : ''}/> 参加者全員が18歳以上で、R18の話題に同意しています</label></div>` : ''}<p class="library-count" data-selection-count>${selected.size} / 40枚（6〜40枚）</p><div class="library-card-grid">${canonicalIds.map((id) => { const card = canonicalCard(id, customCards); return `<label class="library-card"><input type="checkbox" data-select-card data-card-id="${esc(id)}" ${selected.has(id) ? 'checked' : ''} ${busy ? 'disabled' : ''}/><span>${esc(cardLabel(card, reveal))}</span></label>`; }).join('')}</div><button type="submit" class="primary-button" ${busy || !validName || !validSelection || selected.size < 6 || selected.size > 40 ? 'disabled' : ''}>保存</button><button type="button" class="text-button" data-action="set-cancel" ${busy ? 'disabled' : ''}>キャンセル</button></form></section>` : '';
  const customEditor = account.customEditorOpen ? `<section class="library-editor custom-card-editor" aria-labelledby="custom-card-editor-title"><h2 id="custom-card-editor-title">${account.editingCardId ? '質問カードを編集' : '質問カードを作る'}</h2><form data-form="custom-card"><label>質問<textarea data-custom-text maxlength="600" rows="4" required placeholder="${account.customDraftR18 && !reveal ? 'R18の質問' : ''}">${account.customDraftR18 && !reveal ? '' : esc(account.customDraft || '')}</textarea></label><p class="account-hint" data-custom-count>文字数 ${Array.from(account.customDraft || '').length} / 300。改行や制御文字は使えません。</p>${account.customDraftR18 ? `<label class="library-consent"><input type="checkbox" data-library-adult ${reveal ? 'checked' : ''}/> 内容を表示する</label>` : ''}<label class="library-consent"><input type="checkbox" data-custom-r18 ${account.customDraftR18 ? 'checked' : ''}/> R18の話題にする</label><button type="submit" class="primary-button" ${busy ? 'disabled' : ''}>${busy ? '保存中…' : '保存'}</button><button type="button" class="text-button" data-action="custom-card-cancel" ${busy ? 'disabled' : ''}>キャンセル</button></form></section>` : '';
  const customList = customCards.length ? customCards.map((card) => `<article class="library-card custom-card"><span>${esc(cardLabel(card, reveal))}</span><button type="button" data-action="custom-card-edit" data-card-id="${esc(card.id)}" ${busy ? 'disabled' : ''}>編集</button><button type="button" data-action="custom-card-delete" data-card-id="${esc(card.id)}" ${busy ? 'disabled' : ''}>削除</button></article>`).join('') : '<p class="account-muted">自分の質問カードはまだありません。</p>';
  return `<section class="account-library" aria-labelledby="${account.hideTitle ? 'account-dialog-title' : 'library-title'}">${account.hideTitle ? '' : '<div class="library-head"><h1 id="library-title">保存したカード</h1></div>'}<div class="library-head library-actions"><button type="button" class="secondary-button" data-action="set-new" ${canCreateSet ? '' : ' disabled'}>新しいセット</button><button type="button" class="secondary-button" data-action="custom-card-new" ${busy || account.customCardsAvailable !== true ? ' disabled' : ''}>質問カードを作る</button></div>${account.error ? `<p class="form-error" role="alert">${esc(account.error)}</p>` : ''}${account.status ? `<p class="account-status" role="status">${esc(account.status)}</p>` : ''}<h2>マイセット</h2><div class="library-sets">${sets.length ? sets.map((set) => `<article class="library-set"><strong>${esc(set.name)}</strong><span>${Array.isArray(set.card_ids) ? set.card_ids.length : 0}枚</span><button type="button" data-action="set-play" data-set-id="${esc(set.id)}">遊ぶ</button><button type="button" data-action="set-share" data-set-id="${esc(set.id)}">共有</button><button type="button" data-action="set-edit" data-set-id="${esc(set.id)}">編集</button><button type="button" data-action="set-delete" data-set-id="${esc(set.id)}">削除</button></article>`).join('') : '<p class="account-muted">セットはまだありません。</p>'}</div>${setEditor}${customEditor}<h2>お気に入り</h2><div class="library-favorites">${favorites.size ? [...favorites].map((id) => { const card = canonicalCard(id, customCards); if (!card) return ''; return `<article class="library-card favorite-card"><span>${esc(cardLabel(card, reveal))}</span><button type="button" data-action="remove-favorite" data-card-id="${esc(id)}" aria-label="お気に入りから外す">★</button></article>`; }).join('') : '<p class="account-muted">保存したカードはまだありません。</p>'}</div><h2>自分の質問カード</h2><div class="library-favorites">${customList}</div>${account.revealAdult === false && customCards.some((card) => card.r18) ? '<p class="account-hint">R18カードは同意後に内容を表示します。</p>' : ''}</section>`;
}
