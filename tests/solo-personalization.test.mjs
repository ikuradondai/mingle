import assert from 'node:assert/strict';
import test from 'node:test';
import { soloDecks } from '../dist/data/solo-decks.js';
import { SOLO_PERSONALIZED_CARDS, hasSoloQuestionPersonalization, normalizeSoloNickname, personalizeSoloQuestion, soloNicknameLabel } from '../dist/participant-rule.js';

const card = (id) => soloDecks.flatMap((deck) => deck.questions).find((question) => question.id === id);

test('solo nickname display is bounded, trimmed, and does not duplicate honorifics', () => {
  assert.equal(normalizeSoloNickname('  あかり  '), 'あかり');
  assert.equal(normalizeSoloNickname('自分'), '');
  assert.equal(normalizeSoloNickname('あなた'), '');
  assert.equal(soloNicknameLabel('あかり'), 'あかりさん');
  assert.equal(soloNicknameLabel('あかりちゃん'), 'あかりちゃん');
  assert.ok(Array.from(normalizeSoloNickname('あ'.repeat(60))).length <= 40);
  assert.equal(soloNicknameLabel('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>さん');
});

test('only exact built-in solo cards receive explicit display personalization', () => {
  const source = card('self-values-02');
  assert.ok(source);
  assert.equal(hasSoloQuestionPersonalization(source), true);
  assert.equal(personalizeSoloQuestion(source, 'あかり'), 'あかりさんの機嫌がよくなるスイッチは？');
  assert.equal(personalizeSoloQuestion({ ...source, text: `${source.text} 改変` }, 'あかり'), `${source.text} 改変`);
  assert.equal(personalizeSoloQuestion({ ...source, id: 'custom-1' }, 'あかり'), source.text);
  assert.equal(personalizeSoloQuestion({ ...source, sourceDeckId: 'custom-set' }, 'あかり'), source.text);
  assert.equal(hasSoloQuestionPersonalization({ ...source, sourceDeckId: 'custom-set' }), false);
  assert.equal(personalizeSoloQuestion(source, '自分'), source.text);
});

test('template keeps quote and future-self perspectives intact', () => {
  const future = card('self-decision-07');
  assert.equal(personalizeSoloQuestion(future, 'あかりさん'), '1年後のあかりさんなら、今のあかりさんに何て言いそう？');
  assert.match(personalizeSoloQuestion(card('self-values-07'), 'あかり'), /「こういうときは、そっとしておいて」/u);
});

test('every personalized card source matches the current solo card text exactly', () => {
  for (const [id, item] of Object.entries(SOLO_PERSONALIZED_CARDS)) {
    const found = card(id);
    assert.ok(found, `missing card: ${id}`);
    assert.equal(found.text, item.source, `${id}: source is out of sync with solo-decks.js`);
    assert.ok(hasSoloQuestionPersonalization(found), id);
    assert.notEqual(personalizeSoloQuestion(found, 'テスト'), found.text, `${id}: nickname not applied`);
  }
});
