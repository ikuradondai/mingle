import { decks } from './data/decks.js';

export function canonicalCard(cardId) {
  if (typeof cardId !== 'string') return null;
  for (const deck of decks) {
    const regular = deck.questions?.find((card) => card.id === cardId);
    if (regular) return { ...regular, sourceDeckId: deck.id, r18: regular.r18 === true || deck.adultOnly === true };
    const adult = deck.r18Questions?.find((card) => card.id === cardId);
    if (adult) return { ...adult, sourceDeckId: deck.id, r18: true };
  }
  return null;
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c])); }
function cardLabel(card, revealAdult) { return card.r18 && !revealAdult ? 'R18の質問' : card.text; }

export function renderLibrary(account = {}) {
  const favorites = account.favorites instanceof Set ? account.favorites : new Set(account.favorites || []);
  const selected = account.selectedCards instanceof Set ? account.selectedCards : new Set(account.selectedCards || []);
  const sets = Array.isArray(account.sets) ? account.sets : [];
  const editing = account.editingSetId ? sets.find((set) => set.id === account.editingSetId) : null;
  const editingCards = new Set(editing?.card_ids || []);
  const ids = [...new Set([...favorites, ...editingCards])];
  const reveal = account.revealAdult === true;
  const canonicalIds = ids.filter((id) => canonicalCard(id));
  const validFavoriteIds = [...favorites].filter((id) => canonicalCard(id));
  const canCreateSet = validFavoriteIds.length > 0 && account.busy !== true;
  const hasAdult = canonicalIds.some((id) => canonicalCard(id)?.r18 === true);
  const busy = account.busy === true; const validName = typeof (account.setName ?? editing?.name) === 'string' && (account.setName ?? editing?.name).trim().length > 0;
  const editor = account.editingSetId || account.setName !== undefined ? `<section class="library-editor" aria-labelledby="library-editor-title"><h2 id="library-editor-title">${editing ? 'セットを編集' : '新しいセット'}</h2><form data-form="set"><label>セット名<input data-set-name name="set-name" maxlength="40" value="${esc(account.setName ?? editing?.name ?? '')}" required /></label>${hasAdult ? `<div class="library-consent"><label><input type="checkbox" data-library-adult ${reveal ? 'checked' : ''}/> 参加者全員が18歳以上で、R18の話題に同意しています</label></div>` : ''}<p class="library-count" data-selection-count>${selected.size} / 40枚（6〜40枚）</p><div class="library-card-grid">${canonicalIds.map((id) => { const card = canonicalCard(id); return `<label class="library-card"><input type="checkbox" data-select-card data-card-id="${esc(id)}" ${selected.has(id) ? 'checked' : ''} ${busy ? 'disabled' : ''}/><span>${esc(cardLabel(card, reveal))}</span></label>`; }).join('')}</div><button type="submit" class="primary-button" ${busy || !validName || canonicalIds.filter((id) => selected.has(id)).length < 6 || canonicalIds.filter((id) => selected.has(id)).length > 40 ? 'disabled' : ''}>保存</button><button type="button" class="text-button" data-action="set-cancel" ${busy ? 'disabled' : ''}>キャンセル</button></form></section>` : '';
  return `<section class="account-library" aria-labelledby="${account.hideTitle ? 'account-dialog-title' : 'library-title'}">${account.hideTitle ? '' : '<div class="library-head"><h1 id="library-title">保存したカード</h1></div>'}<div class="library-head library-actions"><button type="button" class="secondary-button" data-action="set-new" ${canCreateSet ? '' : ' disabled'}>新しいセット</button></div>${account.error ? `<p class="form-error" role="alert">${esc(account.error)}</p>` : ''}${account.status ? `<p class="account-status" role="status">${esc(account.status)}</p>` : ''}<h2>マイセット</h2><div class="library-sets">${sets.length ? sets.map((set) => `<article class="library-set"><strong>${esc(set.name)}</strong><span>${Array.isArray(set.card_ids) ? set.card_ids.length : 0}枚</span><button type="button" data-action="set-play" data-set-id="${esc(set.id)}">遊ぶ</button><button type="button" data-action="set-edit" data-set-id="${esc(set.id)}">編集</button><button type="button" data-action="set-delete" data-set-id="${esc(set.id)}">削除</button></article>`).join('') : '<p class="account-muted">セットはまだありません。</p>'}</div>${editor}<h2>お気に入り</h2><div class="library-favorites">${ids.length ? ids.map((id) => { const card = canonicalCard(id); if (!card || !favorites.has(id)) return ''; return `<article class="library-card favorite-card"><span>${esc(cardLabel(card, reveal))}</span><button type="button" data-action="remove-favorite" data-card-id="${esc(id)}" aria-label="お気に入りから外す">★</button></article>`; }).join('') : '<p class="account-muted">保存したカードはまだありません。</p>'}</div></section>`;
}
